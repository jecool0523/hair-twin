-- RLS on mask_contracts: masks describe the customer's hairline and face
-- region, so they are as tenant-scoped as the photo itself.
begin;
select plan(9);

set local role postgres;

insert into auth.users (id, email) values
  ('22222222-2222-2222-2222-222222222222', 'stylist.a@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'stylist.b@example.com');
insert into public.profiles (id, display_name) values
  ('22222222-2222-2222-2222-222222222222', 'Stylist A'),
  ('33333333-3333-3333-3333-333333333333', 'Stylist B');
insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'Salon B');
insert into public.salon_memberships (salon_id, profile_id, role) values
  ('aaaaaaaa-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'stylist'),
  ('bbbbbbbb-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'stylist');

insert into public.consultation_sessions (id, salon_id, customer_alias) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'A'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111', 'B');
insert into public.source_images
  (id, salon_id, session_id, storage_path, mime, width, height, expires_at)
values
  ('aaaaaaaa-3333-3333-3333-333333333333','aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222','a/1.png','image/png',480,640, now()+interval '1 day'),
  ('bbbbbbbb-3333-3333-3333-333333333333','bbbbbbbb-1111-1111-1111-111111111111',
   'bbbbbbbb-2222-2222-2222-222222222222','b/1.png','image/png',480,640, now()+interval '1 day');

insert into public.mask_contracts
  (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
values
  ('cccccccc-000a-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
   1, 6, 48, 64, now()+interval '1 day'),
  ('cccccccc-000b-0000-0000-000000000001','bbbbbbbb-1111-1111-1111-111111111111',
   'bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-3333-3333-3333-333333333333',
   1, 6, 48, 64, now()+interval '1 day');

insert into public.mask_assets
  (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, coverage, width, height, expires_at)
values
  ('cccccccc-000a-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
   'hair_edit','a/m.bin', 0.18, 48, 64, now()+interval '1 day'),
  ('cccccccc-000b-0000-0000-000000000001','bbbbbbbb-1111-1111-1111-111111111111',
   'bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-3333-3333-3333-333333333333',
   'hair_edit','b/m.bin', 0.20, 48, 64, now()+interval '1 day');

-- ---------------------------------------------------------------------------
-- RLS is on, and it is scoped by membership.
-- ---------------------------------------------------------------------------
select ok(
  (select relrowsecurity from pg_class where oid = 'public.mask_contracts'::regclass),
  'row level security is enabled on mask_contracts'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select results_eq(
  'select attempt from public.mask_contracts',
  array[1],
  'stylist A sees only salon A mask contracts'
);
select is(
  (select count(*)::int from public.mask_contracts
   where salon_id = 'bbbbbbbb-1111-1111-1111-111111111111'),
  0,
  'stylist A cannot read salon B contracts even when asking by salon id'
);
select is_empty(
  $$select id from public.mask_contracts
    where id = 'cccccccc-000b-0000-0000-000000000001'$$,
  'stylist A cannot read a salon B contract by its id'
);
select is(
  (select count(*)::int from public.mask_assets
   where salon_id = 'bbbbbbbb-1111-1111-1111-111111111111'),
  0,
  'stylist A cannot read salon B mask assets'
);

-- Writing into another tenant is refused by WITH CHECK.
select throws_ok(
  $$insert into public.mask_contracts
      (salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
    values ('bbbbbbbb-1111-1111-1111-111111111111',
            'bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-3333-3333-3333-333333333333',
            2, 4, 48, 64, now()+interval '1 day')$$,
  '42501',
  null,
  'stylist A cannot insert a contract into salon B'
);

-- Updating an invisible row changes nothing (RLS filters, it does not raise).
select lives_ok(
  $$update public.mask_contracts set expansion_radius = 99
    where id = 'cccccccc-000b-0000-0000-000000000001'$$,
  'stylist A updating a salon B contract raises no error...'
);
select is(
  (select count(*)::int from public.mask_contracts where expansion_radius = 99),
  0,
  '...and modifies zero rows'
);

-- Stylist B sees the mirror image.
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select results_eq(
  'select storage_path from public.mask_assets',
  array['b/m.bin'],
  'stylist B sees only salon B mask assets'
);

select * from finish();
rollback;
