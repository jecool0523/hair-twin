-- Hair Twin — invite API hardening (additive; earlier migrations untouched).
--
-- Goal: make invite creation, re-invitation, and revocation DB-AUTHORITATIVE.
-- The client no longer writes pending_invites directly at all — every mutation
-- goes through a SECURITY DEFINER RPC that re-authorises the caller against the
-- membership table and fixes the security-sensitive fields itself (TTL, revoke
-- time, inviter identity, email normalisation). A crafted direct INSERT/UPDATE
-- cannot be used to smuggle a longer TTL, a back-dated revocation, or an invite
-- in someone else's name, because authenticated no longer holds those privileges.
--
-- Supersedes public.reinvite_to_salon(uuid,text,membership_role,timestamptz):
-- that function took the expiry as a CLIENT argument, which let the caller pick
-- the deadline. TTL is now server-fixed and never a parameter.

-- ===========================================================================
-- 1. Revoke every direct write on pending_invites from authenticated.
-- ===========================================================================
-- Managers keep SELECT (they read their salon's invites). All mutation is now
-- through the RPCs below. The INSERT policy and the revoked_at column grant from
-- earlier migrations become dead letters once the privileges are gone; drop the
-- write policies too so the surface reads honestly.
revoke insert on public.pending_invites from authenticated;
revoke update on public.pending_invites from authenticated;      -- drops the revoked_at column grant
revoke update (revoked_at) on public.pending_invites from authenticated;

drop policy if exists invites_insert_managed on public.pending_invites;
drop policy if exists invites_update_managers on public.pending_invites;
-- invites_select_managers stays: managers still read invites (owner/admin only).

-- ===========================================================================
-- 2. Temporal integrity: acceptance and revocation must fall within the
--    invite's own lifetime, and materialised expiry cannot precede the deadline.
--    These CHECKs also do the enforcement work for "an expired invite may only
--    be expired/re-invited, never accepted or revoked": stamping accepted_at or
--    revoked_at with now() once now() > expires_at violates the upper bound.
-- ===========================================================================
alter table public.pending_invites
  add constraint pending_invites_accepted_within_life check (
    accepted_at is null
    or (accepted_at >= created_at and accepted_at <= expires_at)
  ),
  add constraint pending_invites_revoked_within_life check (
    revoked_at is null
    or (revoked_at >= created_at and revoked_at <= expires_at)
  ),
  add constraint pending_invites_expired_after_deadline check (
    expired_at is null or expired_at >= expires_at
  );

-- ===========================================================================
-- 3. Retire the client-TTL re-invite function.
-- ===========================================================================
drop function if exists public.reinvite_to_salon(uuid, text, public.membership_role, timestamptz);

-- ===========================================================================
-- 4. create_or_reinvite_salon_invite — the ONE way to (re)send an invite.
--
--    * Re-authorises the caller from salon_memberships (never a JWT claim).
--    * Normalises the email itself (lower(btrim(...))), so a manager cannot
--      seat a differently-cased duplicate.
--    * TTL is server-fixed at 7 days from now() — NOT a parameter.
--    * inviter is auth.uid(), captured inside the function.
--    * Reaps a LAPSED live invite for the same (salon, normalised email) and
--      seats a fresh one atomically. A still-VALID live invite is left alone, so
--      the insert collides (23505): you cannot silently overwrite an outstanding
--      invitation.
--    Same role rule as before: owners may (re)invite admins and stylists,
--    admins may (re)invite stylists; owner is refused (also barred by the
--    table's own owner-invite CHECK).
-- ===========================================================================
create function public.create_or_reinvite_salon_invite(
  p_salon_id uuid,
  p_email text,
  p_role public.membership_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_email text := lower(btrim(p_email));
  v_new_id uuid;
begin
  if v_uid is null then
    raise exception 'no authenticated caller'
      using errcode = 'insufficient_privilege';
  end if;

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

  -- Reap ONLY a lapsed live invite; leave a still-valid one to collide.
  update public.pending_invites
     set expired_at = now()
   where salon_id = p_salon_id
     and email = v_email
     and accepted_at is null
     and revoked_at is null
     and expired_at is null
     and expires_at <= now();

  -- Server-fixed 7-day TTL. The deadline is ours, not the caller's.
  insert into public.pending_invites (salon_id, email, role, invited_by, expires_at)
  values (p_salon_id, v_email, p_role, v_uid, now() + interval '7 days')
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- ===========================================================================
-- 5. revoke_salon_invite — the ONE way to revoke.
--
--    * Re-authorises the caller (owner/admin of the invite's own salon).
--    * Stamps revoked_at with now() itself — the caller cannot choose the time.
--    * Refuses to revoke anything already terminal (accepted/revoked/expired),
--      and refuses a time-lapsed invite (that goes through the expire/re-invite
--      path, and the revoked_at<=expires_at CHECK would reject it anyway).
-- ===========================================================================
create function public.revoke_salon_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salon_id uuid;
  v_expires_at timestamptz;
  v_terminal boolean;
begin
  select salon_id, expires_at,
         (accepted_at is not null or revoked_at is not null or expired_at is not null)
    into v_salon_id, v_expires_at, v_terminal
    from public.pending_invites
   where id = p_invite_id;

  if not found then
    raise exception 'invite % not found', p_invite_id
      using errcode = 'no_data_found';
  end if;

  if not private.has_salon_role(v_salon_id, array['owner','admin']::public.membership_role[]) then
    raise exception 'not authorised to revoke invites for salon %', v_salon_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_terminal then
    raise exception 'invite % is already accepted, revoked, or expired', p_invite_id
      using errcode = 'restrict_violation';
  end if;

  if v_expires_at <= now() then
    raise exception 'invite % has lapsed; re-invite instead of revoking', p_invite_id
      using errcode = 'restrict_violation';
  end if;

  update public.pending_invites
     set revoked_at = now()
   where id = p_invite_id;
end;
$$;

-- ===========================================================================
-- 6. Execute ACL: default-deny, then grant to authenticated only.
--    CREATE FUNCTION grants EXECUTE to PUBLIC by default; strip that, and also
--    strip anon and service_role explicitly, before granting authenticated. The
--    RPCs are for signed-in managers; service_role and anon must not reach them.
-- ===========================================================================
revoke execute on function public.create_or_reinvite_salon_invite(uuid, text, public.membership_role) from public;
revoke execute on function public.create_or_reinvite_salon_invite(uuid, text, public.membership_role) from anon;
revoke execute on function public.create_or_reinvite_salon_invite(uuid, text, public.membership_role) from service_role;
grant  execute on function public.create_or_reinvite_salon_invite(uuid, text, public.membership_role) to authenticated;

revoke execute on function public.revoke_salon_invite(uuid) from public;
revoke execute on function public.revoke_salon_invite(uuid) from anon;
revoke execute on function public.revoke_salon_invite(uuid) from service_role;
grant  execute on function public.revoke_salon_invite(uuid) to authenticated;
