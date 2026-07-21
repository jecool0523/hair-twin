-- Hair Twin — hardening pass on invites and memberships (additive; the earlier
-- migrations are left untouched, this only ADDs and REPLACES).
--
-- Reproduced defects (both against Postgres before this migration):
--
--   A. pending_invites: the live-unique index keyed on (accepted_at IS NULL AND
--      revoked_at IS NULL). Time-expiry (expires_at in the past) was NOT part of
--      "live", so an invite that had lapsed but was never accepted or revoked
--      still occupied the slot, and re-inviting the same email failed with
--      23505. A lapsed invite could never be re-sent.
--
--   B. salon_memberships: only `role` was ever meant to change, but nothing
--      stopped id/salon_id/profile_id/created_at from being rewritten. A
--      membership row could be re-pointed to a DIFFERENT profile or a DIFFERENT
--      salon — silently moving access — even for service_role.

-- ===========================================================================
-- A. pending_invites: explicit expiry as a terminal state
-- ===========================================================================

-- Materialised terminal state. Postgres partial indexes cannot reference now(),
-- so "expired" must be a stored fact, not a computed one. `expires_at` remains
-- the immutable DEADLINE; `expired_at` records when the deadline was actually
-- reaped (by the reinvite/cleanup function below, or a future scheduler).
alter table public.pending_invites
  add column expired_at timestamptz;

-- accepted / revoked / expired are now MUTUALLY EXCLUSIVE terminal outcomes:
-- an invite ends exactly one way.
alter table public.pending_invites
  drop constraint pending_invites_one_outcome;

alter table public.pending_invites
  add constraint pending_invites_one_outcome check (
    (case when accepted_at is null then 0 else 1 end)
    + (case when revoked_at is null then 0 else 1 end)
    + (case when expired_at is null then 0 else 1 end)
    <= 1
  );

-- accepted_at and accepted_profile_id are all-or-nothing (was one-directional:
-- it allowed accepted_at set with a null profile).
alter table public.pending_invites
  drop constraint pending_invites_accepted_pair;

alter table public.pending_invites
  add constraint pending_invites_accepted_pair check (
    (accepted_at is null) = (accepted_profile_id is null)
  );

-- "Live" now excludes expired too. One live invite per (salon, email); a lapsed,
-- revoked, or accepted invite frees the slot.
drop index public.pending_invites_live_unique;

create unique index pending_invites_live_unique
  on public.pending_invites (salon_id, email)
  where accepted_at is null and revoked_at is null and expired_at is null;

-- The stale-scan index likewise only cares about still-live rows.
drop index if exists public.pending_invites_expires_at_idx;
create index pending_invites_live_expiry_idx
  on public.pending_invites (expires_at)
  where accepted_at is null and revoked_at is null and expired_at is null;

-- Immutability, extended: expired_at is one-way, like accepted/revoked.
create or replace function private.enforce_invite_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.salon_id    is distinct from old.salon_id
     or new.email      is distinct from old.email
     or new.role       is distinct from old.role
     or new.invited_by is distinct from old.invited_by
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
  then
    raise exception 'invite terms are immutable (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;
  if old.accepted_at is not null
     and (new.accepted_at is distinct from old.accepted_at
          or new.accepted_profile_id is distinct from old.accepted_profile_id)
  then
    raise exception 'an accepted invite cannot be rewritten (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;
  if old.revoked_at is not null
     and new.revoked_at is distinct from old.revoked_at
  then
    raise exception 'a revocation cannot be undone or moved (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;
  if old.expired_at is not null
     and new.expired_at is distinct from old.expired_at
  then
    raise exception 'an expiry cannot be undone or moved (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- Managers may REVOKE, and nothing else. Replace the table-level UPDATE grant
-- with a column-level grant on revoked_at only, so a manager physically cannot
-- write accepted_at / accepted_profile_id / expired_at (permission denied, 42501)
-- regardless of policy. Acceptance and expiry are service-role operations.
revoke update on public.pending_invites from authenticated;
grant update (revoked_at) on public.pending_invites to authenticated;

-- The RLS update policy stays (manager-scoped); the column grant is the second
-- lock. Together: a manager can set revoked_at on their salon's invites, period.

-- Atomic "reap the lapsed invite and re-invite" as ONE operation. SECURITY
-- DEFINER (so it can write columns managers cannot), and therefore it
-- re-authorises the caller itself against salon_memberships — never trusting a
-- JWT claim. Same role rule as inserting an invite: admins may (re)invite
-- stylists, owners may (re)invite admins and stylists; owner is forbidden by the
-- table's own check.
create or replace function public.reinvite_to_salon(
  p_salon_id uuid,
  p_email text,
  p_role public.membership_role,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_new_id uuid;
begin
  -- Authorisation, from the membership table only.
  if p_role = 'stylist' then
    if not private.has_salon_role(p_salon_id, array['owner','admin']::public.membership_role[]) then
      raise exception 'not authorised to invite a stylist to salon %', p_salon_id
        using errcode = 'insufficient_privilege';
    end if;
  elsif p_role = 'admin' then
    if not private.has_salon_role(p_salon_id, array['owner']::public.membership_role[]) then
      raise exception 'not authorised to invite an admin to salon %', p_salon_id
        using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'invites may only grant admin or stylist, not %', p_role
      using errcode = 'check_violation';
  end if;

  -- Reap ONLY a lapsed live invite for this (salon, email). A still-valid live
  -- invite is left alone, so the insert below collides (23505) — you cannot
  -- silently overwrite an outstanding invitation.
  update public.pending_invites
     set expired_at = now()
   where salon_id = p_salon_id
     and email = p_email
     and accepted_at is null
     and revoked_at is null
     and expired_at is null
     and expires_at <= now();

  insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
  values (p_salon_id, p_email, p_role, v_uid, p_expires_at)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function
  public.reinvite_to_salon(uuid, text, public.membership_role, timestamptz)
  to authenticated;

-- ===========================================================================
-- B. salon_memberships: only `role` may change
-- ===========================================================================
create or replace function private.enforce_membership_identity_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.id         is distinct from old.id
     or new.salon_id   is distinct from old.salon_id
     or new.profile_id is distinct from old.profile_id
     or new.created_at is distinct from old.created_at
  then
    raise exception
      'a membership row is immutable except its role; reassigning id/salon/profile/created_at is forbidden (id=%)',
      old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

-- BEFORE the last-owner trigger fires (alphabetical order among BEFORE triggers:
-- "identity" < "protect"), so an attempt to re-point a row is rejected outright
-- rather than interacting with owner-count logic.
create trigger salon_memberships_identity_immutable
  before update on public.salon_memberships
  for each row execute function private.enforce_membership_identity_immutable();
