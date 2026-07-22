-- Hair Twin — pending invites (data model only; ADR-0007 §3-4).
--
-- The DB holds the invite state so the accept flow (a later, sb_secret_
-- server action — NOT implemented here, no email sending, no Auth API) has an
-- authoritative record: which salon, which normalised email, which intended
-- role, who invited, until when, and what became of it.
--
-- Rules mirrored from membership management (20260718101000):
--   * admin may invite stylists; owner may invite admins and stylists
--   * NOBODY invites an owner — ownership moves only through the operator path
--   * invites carry NO authority by themselves; membership is created
--     server-side on acceptance (ADR-0007 §4)
--   * one live invite per (salon, email); re-invite allowed after
--     revocation/expiry
--   * the record is immutable except its one-way outcome
--     (accepted XOR revoked), same discipline as consent_records

create table public.pending_invites (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  -- Normalised at the boundary and ENFORCED here, so lookups by email are
  -- exact-match and 'A@x.com' vs 'a@x.com' cannot become two live invites.
  email text not null
    check (email = lower(btrim(email)) and position('@' in email) > 1),
  -- The enum contains 'owner'; this check is what forbids inviting one.
  role public.membership_role not null
    check (role in ('admin'::public.membership_role,
                    'stylist'::public.membership_role)),
  -- Inviter. Cascade: an inviter who leaves takes their outstanding,
  -- not-yet-accepted invitations with them (accepted ones already became
  -- memberships and are unaffected).
  invited_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  -- Set together with accepted_at by the server-side accept flow.
  accepted_profile_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,

  constraint pending_invites_expiry_after_creation
    check (expires_at > created_at),
  -- An invite has ONE outcome.
  constraint pending_invites_one_outcome
    check (accepted_at is null or revoked_at is null),
  constraint pending_invites_accepted_pair
    check (accepted_profile_id is null or accepted_at is not null)
);

-- One LIVE invite per (salon, email). Accepted/revoked rows stay as history and
-- do not block a fresh invitation.
create unique index pending_invites_live_unique
  on public.pending_invites (salon_id, email)
  where accepted_at is null and revoked_at is null;

create index on public.pending_invites (salon_id);
create index on public.pending_invites (expires_at)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------------
-- Immutability: the invitation's terms cannot be rewritten after the fact, and
-- its outcome is one-way. A trigger, so the service key is bound too.
-- ---------------------------------------------------------------------------
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
  return new;
end;
$$;

create trigger pending_invites_immutable
  before update on public.pending_invites
  for each row execute function private.enforce_invite_immutable();

-- ---------------------------------------------------------------------------
-- RLS. Invites hold third-party emails (PII): visible to salon managers only,
-- not to every member.
-- ---------------------------------------------------------------------------
grant select, insert, update on public.pending_invites to authenticated;
grant all on public.pending_invites to service_role;
-- No DELETE grant: invite history stands; outcomes are recorded, not erased.

alter table public.pending_invites enable row level security;

create policy invites_select_managers on public.pending_invites
  for select to authenticated
  using (private.has_salon_role(salon_id,
           array['owner','admin']::public.membership_role[]));

-- Who may create which invite mirrors membership creation exactly, and the
-- inviter must be the acting user (no inviting in someone else's name).
create policy invites_insert_managed on public.pending_invites
  for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and accepted_at is null
    and revoked_at is null
    and (
      (role = 'stylist'::public.membership_role
        and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]))
      or
      (role = 'admin'::public.membership_role
        and private.has_salon_role(salon_id, array['owner']::public.membership_role[]))
    )
  );

-- Managers may update (in practice: revoke — the trigger pins everything else;
-- acceptance runs server-side with the secret key, which bypasses RLS).
create policy invites_update_managers on public.pending_invites
  for update to authenticated
  using (private.has_salon_role(salon_id,
           array['owner','admin']::public.membership_role[]))
  with check (private.has_salon_role(salon_id,
           array['owner','admin']::public.membership_role[]));
