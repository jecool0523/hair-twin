-- Storage object policies (salon-prefixed paths) + private helper hygiene.
begin;
select plan(11);

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

-- Objects owned by each salon, keyed by the <salon_id>/... path convention.
insert into storage.objects (bucket_id, name) values
  ('source-images-private', 'aaaaaaaa-1111-1111-1111-111111111111/sess-a/photo.png'),
  ('source-images-private', 'bbbbbbbb-1111-1111-1111-111111111111/sess-b/photo.png'),
  ('masks-private',         'aaaaaaaa-1111-1111-1111-111111111111/sess-a/hair_edit.png'),
  ('masks-private',         'bbbbbbbb-1111-1111-1111-111111111111/sess-b/hair_edit.png');

-- ---------------------------------------------------------------------------
-- Every bucket is private. A public bucket would hand out permanent URLs to
-- customer faces.
-- ---------------------------------------------------------------------------
select is_empty(
  'select id from storage.buckets where public',
  'no storage bucket is public'
);
select bag_has(
  'select id::text from storage.buckets',
  $$values ('source-images-private'),('generated-assets-private'),('masks-private'),
           ('reports-private'),('style-reference-assets')$$,
  'all expected private buckets exist, including masks-private'
);

-- ---------------------------------------------------------------------------
-- Object access follows salon membership via the path prefix.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

select results_eq(
  $$select name from storage.objects
    where bucket_id = 'source-images-private'$$,
  array['aaaaaaaa-1111-1111-1111-111111111111/sess-a/photo.png'],
  'stylist A can read only salon A source images'
);
select results_eq(
  $$select name from storage.objects where bucket_id = 'masks-private'$$,
  array['aaaaaaaa-1111-1111-1111-111111111111/sess-a/hair_edit.png'],
  'stylist A can read only salon A masks'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('source-images-private','bbbbbbbb-1111-1111-1111-111111111111/x.png')$$,
  '42501',
  null,
  'stylist A cannot upload into salon B''s prefix'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('masks-private','not-a-uuid/x.png')$$,
  '42501',
  null,
  'an object path that is not <salon_id>/... is rejected'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('source-images-private','aaaaaaaa-1111-1111-1111-111111111111/sess-a/new.png')$$,
  'stylist A can upload into their own salon prefix'
);
-- Erasure must stay available to any member (privacy escape hatch).
select lives_ok(
  $$delete from storage.objects
    where name = 'aaaaaaaa-1111-1111-1111-111111111111/sess-a/new.png'$$,
  'stylist A can delete their own salon''s object'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select results_eq(
  $$select name from storage.objects where bucket_id = 'masks-private'$$,
  array['bbbbbbbb-1111-1111-1111-111111111111/sess-b/hair_edit.png'],
  'stylist B sees only salon B masks'
);

-- anon can read no objects at all.
set local role anon;
select is_empty(
  'select name from storage.objects',
  'anon can read no storage objects'
);

-- ---------------------------------------------------------------------------
-- Helper hygiene: RLS helpers live in `private`, never in the API-exposed
-- `public` schema (config.toml exposes only public over PostgREST).
-- ---------------------------------------------------------------------------
set local role postgres;
select is_empty(
  $$select p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('user_salon_ids','is_salon_member','has_salon_role',
                        'user_owned_organization_ids','storage_salon_id',
                        'enforce_consent_immutable','touch_updated_at')$$,
  'no RLS helper leaks into the API-exposed public schema'
);

select * from finish();
rollback;
