-- RLS: tenant isolation and anonymous access.
-- Runs under `supabase test db` (pg_prove) and under the offline PGlite runner.
begin;
select plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures: two salons in two orgs, with staff in each.
-- ---------------------------------------------------------------------------
set local role postgres;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner.a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'stylist.a@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'stylist.b@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'nobody@example.com');

insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner A'),
  ('22222222-2222-2222-2222-222222222222', 'Stylist A'),
  ('33333333-3333-3333-3333-333333333333', 'Stylist B'),
  ('44444444-4444-4444-4444-444444444444', 'No Salon');

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');

insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'Salon B');

insert into public.salon_memberships (salon_id, profile_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaaaaaa-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'stylist'),
  ('bbbbbbbb-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'stylist');

insert into public.consultation_sessions (id, salon_id, customer_alias) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'A customer'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111', 'B customer');

-- ---------------------------------------------------------------------------
-- anon sees nothing at all. Note this is refused at the PRIVILEGE level (anon
-- is granted nothing on these tables), which is stricter than an RLS filter:
-- anon cannot even run the query, let alone get rows back.
-- ---------------------------------------------------------------------------
set local role anon;
select throws_ok(
  'select id from public.consultation_sessions',
  '42501',
  null,
  'anon cannot read any consultation session'
);
select throws_ok(
  'select id from public.customers',
  '42501',
  null,
  'anon cannot read customers'
);
select throws_ok(
  $$insert into public.consultation_sessions (salon_id, customer_alias)
    values ('aaaaaaaa-1111-1111-1111-111111111111','x')$$,
  '42501',
  null,
  'anon cannot insert a consultation session'
);

-- ---------------------------------------------------------------------------
-- Stylist A: sees salon A only.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select results_eq(
  'select customer_alias from public.consultation_sessions',
  array['A customer'],
  'stylist A sees only salon A sessions'
);
select is_empty(
  $$select id from public.consultation_sessions
    where salon_id = 'bbbbbbbb-1111-1111-1111-111111111111'$$,
  'stylist A cannot read salon B sessions even when asking for them by id'
);
select results_eq(
  'select name from public.salons',
  array['Salon A'],
  'stylist A sees only their own salon'
);
select results_eq(
  'select name from public.organizations',
  array['Org A'],
  'stylist A sees only their own organization'
);

-- Cross-tenant write is refused (WITH CHECK), not silently accepted.
select throws_ok(
  $$insert into public.consultation_sessions (salon_id, customer_alias)
    values ('bbbbbbbb-1111-1111-1111-111111111111','smuggled')$$,
  '42501',
  null,
  'stylist A cannot insert a session into salon B'
);

-- Updating another tenant's row affects nothing (the row is invisible).
select lives_ok(
  $$update public.consultation_sessions set customer_alias = 'hacked'
    where id = 'bbbbbbbb-2222-2222-2222-222222222222'$$,
  'stylist A updating a salon B session raises no error...'
);
select is(
  (select count(*)::int from public.consultation_sessions where customer_alias = 'hacked'),
  0,
  '...and changes zero rows'
);

-- Stylist cannot delete a session (admin/owner only). RLS makes the row
-- invisible to DELETE rather than raising, so assert the row SURVIVES — an
-- error-based assertion here would pass for the wrong reason.
select lives_ok(
  $$delete from public.consultation_sessions
    where id = 'aaaaaaaa-2222-2222-2222-222222222222'$$,
  'stylist deleting a session raises no error...'
);
select is(
  (select count(*)::int from public.consultation_sessions
   where id = 'aaaaaaaa-2222-2222-2222-222222222222'),
  1,
  '...and the session is still there (stylist cannot delete)'
);

-- ---------------------------------------------------------------------------
-- Stylist B: mirror image.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select results_eq(
  'select customer_alias from public.consultation_sessions',
  array['B customer'],
  'stylist B sees only salon B sessions'
);

-- ---------------------------------------------------------------------------
-- A signed-in user with no membership sees nothing.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is_empty(
  'select id from public.consultation_sessions',
  'a user with no salon membership sees no sessions'
);
select is_empty(
  'select id from public.salons',
  'a user with no salon membership sees no salons'
);

-- ---------------------------------------------------------------------------
-- Owner A: can delete, and can administer the salon.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select lives_ok(
  $$update public.salons set name = 'Salon A renamed'
    where id = 'aaaaaaaa-1111-1111-1111-111111111111'$$,
  'owner can rename their salon'
);
select lives_ok(
  $$delete from public.consultation_sessions
    where id = 'aaaaaaaa-2222-2222-2222-222222222222'$$,
  'owner can delete a consultation session'
);

-- ---------------------------------------------------------------------------
-- service_role bypasses RLS (used by the server and the AI worker).
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select count(*)::int from public.consultation_sessions),
  1,
  'service_role sees across tenants (salon B session remains)'
);

select * from finish();
rollback;
