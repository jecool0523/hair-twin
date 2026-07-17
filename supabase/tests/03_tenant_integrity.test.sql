-- Composite tenant constraints: a cross-tenant row must be impossible to write
-- even with service_role / superuser, i.e. even when RLS is not in play.
-- RLS protects reads; these constraints protect the data model itself.
begin;
select plan(10);

set local role postgres;

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'Salon B');

insert into public.style_presets (id, display_name_ko, category) values
  ('layered-c-curl', '레이어드 C컬', 'perm');

insert into public.customers (id, salon_id, alias) values
  ('aaaaaaaa-9999-9999-9999-999999999999', 'aaaaaaaa-1111-1111-1111-111111111111', 'A cust');

insert into public.consultation_sessions (id, salon_id, customer_alias) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'A customer'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111', 'B customer');

insert into public.source_images
  (id, salon_id, session_id, storage_path, mime, width, height, expires_at)
values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222',
   'aaaaaaaa-1111-1111-1111-111111111111/s/a.png', 'image/png', 600, 800, now() + interval '1 day');

-- A real salon A mask contract. Jobs and masks must reference one (20260716103000),
-- so the cross-tenant assertions below now exercise the contract FK for real.
insert into public.mask_contracts
  (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
values
  ('cccccccc-aaaa-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
   1, 6, 48, 64, now() + interval '1 day');

-- ---------------------------------------------------------------------------
-- Cross-tenant parent references are structurally rejected.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.source_images
      (salon_id, session_id, storage_path, mime, width, height, expires_at)
    values ('bbbbbbbb-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222',
            'x/y/z.png','image/png',10,10, now() + interval '1 day')$$,
  '23503',
  null,
  'a source image cannot claim salon B while pointing at a salon A session'
);

select throws_ok(
  $$insert into public.generation_jobs
      (salon_id, session_id, source_image_id, style_id, mask_contract_id)
    values ('bbbbbbbb-1111-1111-1111-111111111111',
            'bbbbbbbb-2222-2222-2222-222222222222',
            'aaaaaaaa-3333-3333-3333-333333333333',
            'layered-c-curl','cccccccc-aaaa-0000-0000-000000000001')$$,
  '23503',
  null,
  'a job cannot pair salon B session with salon A source image'
);

-- The mirror case: consistent salon+source, but somebody else's session. This
-- is what pins jobs_session_same_salon specifically — without it the FK could
-- be dropped and every other assertion here would still pass.
select throws_ok(
  $$insert into public.generation_jobs
      (salon_id, session_id, source_image_id, style_id, mask_contract_id)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'bbbbbbbb-2222-2222-2222-222222222222',
            'aaaaaaaa-3333-3333-3333-333333333333',
            'layered-c-curl','cccccccc-aaaa-0000-0000-000000000001')$$,
  '23503',
  null,
  'a salon A job cannot attach to a salon B session'
);

select throws_ok(
  $$insert into public.consultation_sessions (salon_id, customer_alias, customer_id)
    values ('bbbbbbbb-1111-1111-1111-111111111111', 'x',
            'aaaaaaaa-9999-9999-9999-999999999999')$$,
  '23503',
  null,
  'a salon B session cannot reference a salon A customer'
);

select throws_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
    values ('cccccccc-aaaa-0000-0000-000000000001',
            'bbbbbbbb-1111-1111-1111-111111111111',
            'bbbbbbbb-2222-2222-2222-222222222222',
            'aaaaaaaa-3333-3333-3333-333333333333',
            'hair_edit', 'b/m.png', 10, 10, now() + interval '1 day')$$,
  '23503',
  null,
  'a mask cannot bind a salon B session to a salon A source image'
);

-- Moving a parent to another tenant is refused while children reference it.
select throws_ok(
  $$update public.consultation_sessions
    set salon_id = 'bbbbbbbb-1111-1111-1111-111111111111'
    where id = 'aaaaaaaa-2222-2222-2222-222222222222'$$,
  '23503',
  null,
  'a session cannot be moved to another salon while its media references it'
);

-- ---------------------------------------------------------------------------
-- Same-tenant writes still work (the constraints are not just blanket denies).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.generation_jobs
      (id, salon_id, session_id, source_image_id, style_id, mask_contract_id)
    values ('aaaaaaaa-4444-4444-4444-444444444444',
            'aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222',
            'aaaaaaaa-3333-3333-3333-333333333333',
            'layered-c-curl','cccccccc-aaaa-0000-0000-000000000001')$$,
  'a job within one salon is accepted'
);

select lives_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
    values ('cccccccc-aaaa-0000-0000-000000000001',
            'aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222',
            'aaaaaaaa-3333-3333-3333-333333333333',
            'hair_edit', 'a/m.png', 600, 800, now() + interval '1 day')$$,
  'a mask within one salon is accepted'
);

-- ---------------------------------------------------------------------------
-- Retention invariant: unsaved media must always carry an expiry.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.source_images
      (salon_id, session_id, storage_path, mime, width, height)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222',
            'a/no-expiry.png','image/png',10,10)$$,
  '23514',
  null,
  'an unsaved source image without an expiry is rejected'
);

select lives_ok(
  $$insert into public.source_images
      (salon_id, session_id, storage_path, mime, width, height, saved)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222',
            'a/saved.png','image/png',10,10, true)$$,
  'a saved source image may omit the expiry'
);

select * from finish();
rollback;
