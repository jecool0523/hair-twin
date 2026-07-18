-- Retention tombstones: purging destroys mask rows/bytes but keeps a
-- job-referenced contract as an inert record; nothing may generate against it
-- afterwards, and the purge itself is one-way. All privileged-path (postgres):
-- these guards must bind the sweep and the worker, not just browsers.
begin;
select plan(13);

set local role postgres;

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A');
insert into public.style_presets (id, display_name_ko, category) values
  ('layered-c-curl', '레이어드 C컬', 'perm');
insert into public.consultation_sessions (id, salon_id, customer_alias) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'A');
insert into public.source_images
  (id, salon_id, session_id, storage_path, mime, width, height, expires_at)
values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'a/1.png', 'image/png', 480, 640,
   now() + interval '1 day');

-- C1: job-referenced (will be tombstoned). C2: unreferenced (will be deleted).
insert into public.mask_contracts
  (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
   1, 6, 48, 64, now() + interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
   2, 4, 48, 64, now() + interval '1 day');

insert into public.mask_assets
  (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
   'hair_edit', 'a/c1-he.bin', 48, 64, now() + interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
   'hair_edit', 'a/c2-he.bin', 48, 64, now() + interval '1 day');

insert into public.generation_jobs
  (id, salon_id, session_id, source_image_id, style_id, mask_contract_id)
values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
   'layered-c-curl', 'cccccccc-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- 1-4: the sweep's tombstone move — masks die, the contract row survives with
-- purged_at, and the job's reference stays intact.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$
    delete from public.mask_assets
      where mask_contract_id = 'cccccccc-0000-0000-0000-000000000001';
    update public.mask_contracts set purged_at = now()
      where id = 'cccccccc-0000-0000-0000-000000000001';
  $$,
  'the sweep can destroy mask rows and tombstone the contract'
);
select is(
  (select count(*)::int from public.mask_assets
   where mask_contract_id = 'cccccccc-0000-0000-0000-000000000001'),
  0,
  'the purged contract has no mask rows left'
);
select isnt(
  (select purged_at from public.mask_contracts
   where id = 'cccccccc-0000-0000-0000-000000000001'),
  null,
  'the tombstone records when it was purged'
);
select is(
  (select mask_contract_id from public.generation_jobs
   where id = 'dddddddd-0000-0000-0000-000000000001'),
  'cccccccc-0000-0000-0000-000000000001'::uuid,
  'the job still proves which contract it generated against'
);

-- ---------------------------------------------------------------------------
-- 5-7: a tombstone is inert — no new masks, no new jobs; but the EXISTING job
-- may still finish its lifecycle.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
            'face_protect', 'a/late.bin', 48, 64, now() + interval '1 day')$$,
  '23001', null,
  'no new mask can attach to a purged contract'
);
select throws_ok(
  $$insert into public.generation_jobs
      (salon_id, session_id, source_image_id, style_id, mask_contract_id)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
            'layered-c-curl', 'cccccccc-0000-0000-0000-000000000001')$$,
  '23001', null,
  'no new job can bind to a purged contract'
);
select lives_ok(
  $$update public.generation_jobs set status = 'failed_hard'
    where id = 'dddddddd-0000-0000-0000-000000000001'$$,
  'the existing job can still move through its lifecycle'
);

-- ---------------------------------------------------------------------------
-- 8-9: a purge is one-way.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$update public.mask_contracts set purged_at = null
    where id = 'cccccccc-0000-0000-0000-000000000001'$$,
  '23001', null,
  'a purge cannot be undone'
);
select throws_ok(
  $$update public.mask_contracts set purged_at = now() + interval '1 day'
    where id = 'cccccccc-0000-0000-0000-000000000001'$$,
  '23001', null,
  'a purge timestamp cannot be moved'
);

-- ---------------------------------------------------------------------------
-- 10: the tombstone stays pinned while the job exists (auditability wins).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$delete from public.mask_contracts
    where id = 'cccccccc-0000-0000-0000-000000000001'$$,
  '23001', null,
  'a job-referenced tombstone cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- 11-12: contracts nobody references are deleted outright, masks and all.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$delete from public.mask_contracts
    where id = 'cccccccc-0000-0000-0000-000000000002'$$,
  'an unreferenced expired contract is deleted outright'
);
select is(
  (select count(*)::int from public.mask_assets
   where mask_contract_id = 'cccccccc-0000-0000-0000-000000000002'),
  0,
  'its masks cascaded away with it'
);

-- ---------------------------------------------------------------------------
-- 13: an existing job cannot be re-pointed AT a purged contract.
-- ---------------------------------------------------------------------------
insert into public.mask_contracts
  (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
values
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
   3, 2, 48, 64, now() + interval '1 day');
insert into public.generation_jobs
  (id, salon_id, session_id, source_image_id, style_id, mask_contract_id)
values
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-3333-3333-3333-333333333333',
   'layered-c-curl', 'cccccccc-0000-0000-0000-000000000003');

select throws_ok(
  $$update public.generation_jobs
    set mask_contract_id = 'cccccccc-0000-0000-0000-000000000001'
    where id = 'dddddddd-0000-0000-0000-000000000002'$$,
  '23001', null,
  'a job cannot be re-pointed at a purged contract'
);

select * from finish();
rollback;
