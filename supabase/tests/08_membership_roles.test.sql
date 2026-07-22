-- Membership management: admins manage stylists, owners manage admins+stylists,
-- nobody touches owner rows through ordinary policies, and the last owner of a
-- salon cannot be removed even by privileged code.
--
-- Pins the two reproduced escalations: admin INSERTing an owner membership,
-- and admin UPDATEing their own row to owner.
begin;
select plan(26);

set local role postgres;

insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'owner.a@example.com'),
  ('11111111-0000-0000-0000-000000000002', 'admin.m@example.com'),
  ('11111111-0000-0000-0000-000000000003', 'admin.m2@example.com'),
  ('11111111-0000-0000-0000-000000000004', 'stylist.s@example.com'),
  ('11111111-0000-0000-0000-000000000005', 'pawn.p1@example.com'),
  ('11111111-0000-0000-0000-000000000006', 'pawn.p2@example.com'),
  ('11111111-0000-0000-0000-000000000007', 'owner.o3@example.com'),
  ('11111111-0000-0000-0000-000000000008', 'owner.c@example.com');
insert into public.profiles (id, display_name)
select id, email from auth.users;

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A'),
  ('cccccccc-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon C');

insert into public.salon_memberships (salon_id, profile_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000001', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000002', 'admin'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000003', 'admin'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000004', 'stylist'),
  ('cccccccc-1111-1111-1111-111111111111', '11111111-0000-0000-0000-000000000008', 'owner');

-- ---------------------------------------------------------------------------
-- Acting as ADMIN M.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- 1/2: the reproduced escalation — an admin minting an owner (or a peer admin).
select throws_ok(
  $$insert into public.salon_memberships (salon_id, profile_id, role)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            '11111111-0000-0000-0000-000000000005', 'owner')$$,
  '42501', null,
  'an admin cannot insert an owner membership'
);
select throws_ok(
  $$insert into public.salon_memberships (salon_id, profile_id, role)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            '11111111-0000-0000-0000-000000000005', 'admin')$$,
  '42501', null,
  'an admin cannot insert another admin'
);

-- 3: an admin may add a stylist.
select lives_ok(
  $$insert into public.salon_memberships (salon_id, profile_id, role)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            '11111111-0000-0000-0000-000000000005', 'stylist')$$,
  'an admin can add a stylist'
);

-- 4/5: the reproduced self-promotion. The admin's own row has role=admin, so
-- UPDATE's USING hides it from them: zero rows change, silently.
select lives_ok(
  $$update public.salon_memberships set role = 'owner'
    where profile_id = '11111111-0000-0000-0000-000000000002'$$,
  'admin self-promotion raises no error...'
);
select is(
  (select role from public.salon_memberships
   where profile_id = '11111111-0000-0000-0000-000000000002'),
  'admin'::public.membership_role,
  '...and the admin is still an admin'
);

-- 6: promoting a stylist to admin needs owner authority (WITH CHECK).
select throws_ok(
  $$update public.salon_memberships set role = 'admin'
    where profile_id = '11111111-0000-0000-0000-000000000005'$$,
  '42501', null,
  'an admin cannot promote a stylist to admin'
);

-- 7/8: a peer admin''s row is out of an admin''s reach.
select lives_ok(
  $$update public.salon_memberships set role = 'stylist'
    where profile_id = '11111111-0000-0000-0000-000000000003'$$,
  'admin demoting a peer admin raises no error...'
);
select is(
  (select role from public.salon_memberships
   where profile_id = '11111111-0000-0000-0000-000000000003'),
  'admin'::public.membership_role,
  '...and the peer admin is untouched'
);

-- 9/10: the owner row is invisible to an admin''s DELETE.
select lives_ok(
  $$delete from public.salon_memberships
    where profile_id = '11111111-0000-0000-0000-000000000001'$$,
  'admin deleting the owner raises no error...'
);
select is(
  (select count(*)::int from public.salon_memberships
   where salon_id = 'aaaaaaaa-1111-1111-1111-111111111111' and role = 'owner'),
  1,
  '...and the owner membership survives'
);

-- 11/12: an admin may remove a stylist.
select lives_ok(
  $$delete from public.salon_memberships
    where profile_id = '11111111-0000-0000-0000-000000000005'$$,
  'an admin can remove a stylist'
);
select is(
  (select count(*)::int from public.salon_memberships
   where profile_id = '11111111-0000-0000-0000-000000000005'),
  0,
  'the stylist membership is gone'
);

-- ---------------------------------------------------------------------------
-- Acting as OWNER O.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"11111111-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 13/14/15: owners manage admins and stylists both ways.
select lives_ok(
  $$insert into public.salon_memberships (salon_id, profile_id, role)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            '11111111-0000-0000-0000-000000000005', 'admin')$$,
  'an owner can add an admin'
);
select lives_ok(
  $$update public.salon_memberships set role = 'stylist'
    where profile_id = '11111111-0000-0000-0000-000000000005'$$,
  'an owner can demote an admin to stylist'
);
select lives_ok(
  $$update public.salon_memberships set role = 'admin'
    where profile_id = '11111111-0000-0000-0000-000000000005'$$,
  'an owner can promote a stylist to admin'
);

-- 16/17: not even an owner mints or promotes to owner through policies.
select throws_ok(
  $$insert into public.salon_memberships (salon_id, profile_id, role)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            '11111111-0000-0000-0000-000000000006', 'owner')$$,
  '42501', null,
  'an owner cannot insert a second owner via ordinary policy'
);
select throws_ok(
  $$update public.salon_memberships set role = 'owner'
    where profile_id = '11111111-0000-0000-0000-000000000005'$$,
  '42501', null,
  'an owner cannot promote an admin to owner via ordinary policy'
);

-- 18/19: an owner cannot delete their own owner row through policy.
select lives_ok(
  $$delete from public.salon_memberships
    where profile_id = '11111111-0000-0000-0000-000000000001'$$,
  'owner deleting their own owner row raises no error...'
);
select is(
  (select count(*)::int from public.salon_memberships
   where salon_id = 'aaaaaaaa-1111-1111-1111-111111111111' and role = 'owner'),
  1,
  '...and the owner membership survives'
);

-- ---------------------------------------------------------------------------
-- Last-owner trigger — exercised as postgres, which BYPASSES RLS. This is the
-- guarantee the operator/service path is also bound by.
-- ---------------------------------------------------------------------------
set local role postgres;

-- 20/21: the sole owner can be neither demoted nor deleted.
select throws_ok(
  $$update public.salon_memberships set role = 'admin'
    where profile_id = '11111111-0000-0000-0000-000000000001'$$,
  '23001', null,
  'demoting the last owner is blocked even for privileged code'
);
select throws_ok(
  $$delete from public.salon_memberships
    where profile_id = '11111111-0000-0000-0000-000000000001'$$,
  '23001', null,
  'deleting the last owner is blocked even for privileged code'
);

-- 22/23: the operator transfer path works WITH the trigger: add a second
-- owner first, then the original may step down.
select lives_ok(
  $$insert into public.salon_memberships (salon_id, profile_id, role)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            '11111111-0000-0000-0000-000000000007', 'owner')$$,
  'the service path can seat a second owner'
);
select lives_ok(
  $$update public.salon_memberships set role = 'admin'
    where profile_id = '11111111-0000-0000-0000-000000000001'$$,
  'with a second owner seated, the first may be demoted'
);

-- 24/25: deleting a whole salon still works — cascade removal of its sole
-- owner is the salon dying, not the salon losing its owner.
select lives_ok(
  $$delete from public.salons where id = 'cccccccc-1111-1111-1111-111111111111'$$,
  'a salon with a sole owner can still be deleted (cascade)'
);
select is(
  (select count(*)::int from public.salon_memberships
   where salon_id = 'cccccccc-1111-1111-1111-111111111111'),
  0,
  'its memberships cascaded away'
);

-- 26: authority never comes from JWT claims or user_metadata, in ANY policy.
select is_empty(
  $$select p.polname::text
    from pg_policy p
    where pg_get_expr(p.polqual, p.polrelid) ilike any (array['%jwt%','%user_metadata%','%app_metadata%'])
       or pg_get_expr(p.polwithcheck, p.polrelid) ilike any (array['%jwt%','%user_metadata%','%app_metadata%'])$$,
  'no RLS policy consults JWT claims or user metadata for authority'
);

select * from finish();
rollback;
