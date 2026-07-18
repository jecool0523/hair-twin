-- Hair Twin — role-aware membership management.
--
-- DEFECT (reproduced before writing this): the 20260715120200 policies gated
-- membership INSERT/UPDATE on "actor is owner or admin" but never looked at the
-- ROLE being written. Two live escalations followed:
--
--   * an admin could INSERT a membership with role 'owner'
--   * an admin could UPDATE their own row to role 'owner'
--
-- Either turns an admin into a tenant owner in one statement.
--
-- New model (ADR-0007 refined):
--   admin  -> may create/update/delete STYLIST rows only
--   owner  -> may create/update/delete ADMIN and STYLIST rows
--   nobody -> may create, promote to, demote from, or delete OWNER rows via
--             ordinary policies. Owner transfer/recovery is a separate,
--             service-key operator path (deliberately NOT implemented here);
--             the last-owner trigger below still binds even that path.
--
-- Authority derives ONLY from salon_memberships via the private.* helpers.
-- No policy consults user_metadata or JWT claims (asserted in pgTAP 08).

-- ---------------------------------------------------------------------------
-- Replace the role-blind policies.
-- ---------------------------------------------------------------------------
drop policy memberships_insert_admin on public.salon_memberships;
drop policy memberships_update_admin on public.salon_memberships;
drop policy memberships_delete_owner on public.salon_memberships;

-- INSERT: the role being granted decides who may grant it. 'owner' matches no
-- branch, so no ordinary policy can create an owner.
create policy memberships_insert_managed on public.salon_memberships
  for insert to authenticated
  with check (
    (role = 'stylist'::public.membership_role
      and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]))
    or
    (role = 'admin'::public.membership_role
      and private.has_salon_role(salon_id, array['owner']::public.membership_role[]))
  );

-- UPDATE: USING gates on the row's CURRENT role (who may touch it), WITH CHECK
-- on the NEW role (what it may become). Owner rows match neither, so they are
-- invisible to UPDATE: no promotion to owner, no demotion of an owner, and an
-- admin's own 'admin' row is out of their reach — self-promotion dies here.
create policy memberships_update_managed on public.salon_memberships
  for update to authenticated
  using (
    (role = 'stylist'::public.membership_role
      and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]))
    or
    (role = 'admin'::public.membership_role
      and private.has_salon_role(salon_id, array['owner']::public.membership_role[]))
  )
  with check (
    (role = 'stylist'::public.membership_role
      and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]))
    or
    (role = 'admin'::public.membership_role
      and private.has_salon_role(salon_id, array['owner']::public.membership_role[]))
  );

-- DELETE: same shape. Owner rows cannot be deleted by any ordinary policy.
create policy memberships_delete_managed on public.salon_memberships
  for delete to authenticated
  using (
    (role = 'stylist'::public.membership_role
      and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]))
    or
    (role = 'admin'::public.membership_role
      and private.has_salon_role(salon_id, array['owner']::public.membership_role[]))
  );

-- ---------------------------------------------------------------------------
-- Last-owner protection — a TRIGGER, because policies only bind the roles they
-- target. The service key bypasses RLS; it must still be unable to leave a
-- salon ownerless by accident. (Same reasoning as the consent trigger.)
--
-- The operator path for owner transfer works WITH this trigger, not around it:
-- service key inserts a second owner, then demotes/removes the first.
-- ---------------------------------------------------------------------------
create or replace function private.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only removals/demotions of owner rows are of interest.
  if old.role <> 'owner' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE'
     and new.role = 'owner'
     and new.salon_id = old.salon_id then
    return new; -- still an owner of the same salon; nothing lost
  end if;

  -- If the salon itself is being deleted, its memberships cascade with it;
  -- protecting the last owner of a salon that no longer exists would make
  -- salons undeletable.
  if not exists (select 1 from public.salons s where s.id = old.salon_id) then
    return coalesce(new, old);
  end if;

  if not exists (
    select 1 from public.salon_memberships m
    where m.salon_id = old.salon_id
      and m.role = 'owner'
      and m.id <> old.id
  ) then
    raise exception
      'cannot remove or demote the last owner of salon % (transfer ownership first)',
      old.salon_id
      using errcode = 'restrict_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger salon_memberships_protect_last_owner
  before update or delete on public.salon_memberships
  for each row execute function private.protect_last_owner();
