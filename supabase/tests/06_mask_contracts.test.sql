-- Mask contracts: retry coexistence, job binding, tenant integrity, retention.
--
-- These run as a PRIVILEGED role on purpose. RLS protects reads; these
-- constraints protect the data model itself, so they must hold even for the
-- server and the AI worker, which bypass RLS. RLS on mask_contracts is covered
-- separately in 07.
begin;
select plan(23);

set local role postgres;

-- Two salons, one session + source each.
insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B');
insert into public.salons (id, organization_id, name) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Salon A'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', 'Salon B');
insert into public.style_presets (id, display_name_ko, category) values
  ('layered-c-curl', '레이어드 C컬', 'perm');

insert into public.consultation_sessions (id, salon_id, customer_alias) values
  ('aaaaaaaa-2222-2222-2222-222222222222', 'aaaaaaaa-1111-1111-1111-111111111111', 'A cust'),
  ('aaaaaaaa-2222-2222-2222-999999999999', 'aaaaaaaa-1111-1111-1111-111111111111', 'A cust 2'),
  ('bbbbbbbb-2222-2222-2222-222222222222', 'bbbbbbbb-1111-1111-1111-111111111111', 'B cust');

insert into public.source_images
  (id, salon_id, session_id, storage_path, mime, width, height, expires_at)
values
  ('aaaaaaaa-3333-3333-3333-333333333333', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222', 'a/1.png', 'image/png', 480, 640, now() + interval '1 day'),
  ('aaaaaaaa-3333-3333-3333-999999999999', 'aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-999999999999', 'a/2.png', 'image/png', 480, 640, now() + interval '1 day'),
  ('bbbbbbbb-3333-3333-3333-333333333333', 'bbbbbbbb-1111-1111-1111-111111111111',
   'bbbbbbbb-2222-2222-2222-222222222222', 'b/1.png', 'image/png', 480, 640, now() + interval '1 day');

-- ---------------------------------------------------------------------------
-- 1. Retry attempts 1/2/3 coexist, each with its own full mask set.
--    This is the case the previous schema made impossible (23505).
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.mask_contracts
      (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
    values
      ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
       'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
       1, 6, 48, 64, now() + interval '1 day'),
      ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-1111-1111-1111-111111111111',
       'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
       2, 4, 48, 64, now() + interval '1 day'),
      ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-1111-1111-1111-111111111111',
       'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
       3, 2, 48, 64, now() + interval '1 day')$$,
  'retry contracts for attempts 1, 2 and 3 coexist for one source image'
);

-- Each attempt gets its own hair_edit mask. Under the old
-- (source_image_id, kind, contract_version) unique this failed on attempt 2.
select lives_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path,
       coverage, width, height, expires_at)
    values
      ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
       'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
       'hair_edit','a/m1.bin', 0.18, 48, 64, now() + interval '1 day'),
      ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-1111-1111-1111-111111111111',
       'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
       'hair_edit','a/m2.bin', 0.15, 48, 64, now() + interval '1 day'),
      ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-1111-1111-1111-111111111111',
       'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
       'hair_edit','a/m3.bin', 0.12, 48, 64, now() + interval '1 day')$$,
  'each retry attempt keeps its own hair_edit mask'
);

select is(
  (select count(*)::int from public.mask_assets
   where source_image_id = 'aaaaaaaa-3333-3333-3333-333333333333' and kind = 'hair_edit'),
  3,
  'three hair_edit masks coexist for one source image, one per attempt'
);

-- A duplicate of the same attempt is still rejected.
select throws_ok(
  $$insert into public.mask_contracts
      (salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            1, 6, 48, 64, now() + interval '1 day')$$,
  '23505',
  null,
  'a second contract for the same (source, attempt, version) is rejected'
);

-- ---------------------------------------------------------------------------
-- 7. One mask per kind PER CONTRACT.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
    values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            'hair_edit','a/dup.bin', 48, 64, now() + interval '1 day')$$,
  '23505',
  null,
  'the same mask kind cannot be stored twice in one contract'
);

-- The region map is just another kind, and belongs to exactly one contract.
select lives_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
    values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            'region_map','a/rm1.bin', 48, 64, now() + interval '1 day')$$,
  'the region map is stored as a mask kind under its contract'
);

-- ---------------------------------------------------------------------------
-- 2. A generation job references the exact contract id.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$insert into public.generation_jobs
      (id, salon_id, session_id, source_image_id, style_id, mask_contract_id, attempts)
    values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            'layered-c-curl','cccccccc-0000-0000-0000-000000000002', 2)$$,
  'a job binds to one exact mask contract id'
);

select is(
  (select mask_contract_id from public.generation_jobs
   where id = 'dddddddd-0000-0000-0000-000000000001'),
  'cccccccc-0000-0000-0000-000000000002'::uuid,
  'the job resolves to the attempt-2 contract, not merely a version string'
);

-- ---------------------------------------------------------------------------
-- 3/4/5. Cross session / source / salon contract binding is impossible.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.generation_jobs
      (salon_id, session_id, source_image_id, style_id, mask_contract_id)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-999999999999',
            'aaaaaaaa-3333-3333-3333-999999999999',
            'layered-c-curl','cccccccc-0000-0000-0000-000000000001')$$,
  '23503',
  null,
  'a job cannot use a contract belonging to another session'
);

-- Same session, but the contract was derived from a different source image.
insert into public.mask_contracts
  (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
values
  ('cccccccc-0000-0000-0000-00000000000a','aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-999999999999','aaaaaaaa-3333-3333-3333-999999999999',
   1, 6, 48, 64, now() + interval '1 day');

select throws_ok(
  $$insert into public.generation_jobs
      (salon_id, session_id, source_image_id, style_id, mask_contract_id)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-999999999999',
            'aaaaaaaa-3333-3333-3333-333333333333',
            'layered-c-curl','cccccccc-0000-0000-0000-00000000000a')$$,
  '23503',
  null,
  'a job cannot pair one source image with a contract derived from another'
);

insert into public.mask_contracts
  (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
values
  ('cccccccc-0000-0000-0000-0000000000b0','bbbbbbbb-1111-1111-1111-111111111111',
   'bbbbbbbb-2222-2222-2222-222222222222','bbbbbbbb-3333-3333-3333-333333333333',
   1, 6, 48, 64, now() + interval '1 day');

select throws_ok(
  $$insert into public.generation_jobs
      (salon_id, session_id, source_image_id, style_id, mask_contract_id)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222',
            'aaaaaaaa-3333-3333-3333-333333333333',
            'layered-c-curl','cccccccc-0000-0000-0000-0000000000b0')$$,
  '23503',
  null,
  'a salon A job cannot use a salon B contract'
);

-- ---------------------------------------------------------------------------
-- 6. A mask asset and its contract must share a salon (and session/source).
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
    values ('cccccccc-0000-0000-0000-0000000000b0','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            'face_protect','x/1.bin', 48, 64, now() + interval '1 day')$$,
  '23503',
  null,
  'a salon A mask cannot belong to a salon B contract'
);

select throws_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
    values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-999999999999','aaaaaaaa-3333-3333-3333-999999999999',
            'face_protect','x/2.bin', 48, 64, now() + interval '1 day')$$,
  '23503',
  null,
  'a mask cannot claim a session/source that disagrees with its contract'
);

-- Cross-tenant contracts are impossible at the contract level too.
select throws_ok(
  $$insert into public.mask_contracts
      (salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
    values ('bbbbbbbb-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            7, 6, 48, 64, now() + interval '1 day')$$,
  '23503',
  null,
  'a contract cannot claim salon B while pointing at salon A session/source'
);

-- ---------------------------------------------------------------------------
-- 8. Retention: unsaved contracts and masks must carry an expiry.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$insert into public.mask_contracts
      (salon_id, session_id, source_image_id, attempt, expansion_radius, width, height)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            9, 6, 48, 64)$$,
  '23514',
  null,
  'an unsaved mask contract without an expiry is rejected'
);

select lives_ok(
  $$insert into public.mask_contracts
      (salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, saved)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            8, 6, 48, 64, true)$$,
  'a saved mask contract may omit the expiry'
);

select throws_ok(
  $$insert into public.mask_assets
      (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height)
    values ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            'face_protect','a/noexp.bin', 48, 64)$$,
  '23514',
  null,
  'an unsaved mask asset without an expiry is rejected'
);

-- attempt must be a real attempt number.
select throws_ok(
  $$insert into public.mask_contracts
      (salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
    values ('aaaaaaaa-1111-1111-1111-111111111111',
            'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
            0, 6, 48, 64, now() + interval '1 day')$$,
  '23514',
  null,
  'attempt 0 is rejected (attempts are 1-based)'
);

-- Deleting a contract takes its masks with it, but a job pins it in place so
-- the record of what was generated cannot silently vanish.
select throws_ok(
  $$delete from public.mask_contracts where id = 'cccccccc-0000-0000-0000-000000000002'$$,
  '23001',
  null,
  'a contract still referenced by a job cannot be deleted out from under it'
);

-- ---------------------------------------------------------------------------
-- App/DB parity: the schema must hold a MaskContractRecord without loss.
-- Pairs with apps/web/src/lib/store/mask-contract-mapping.test.ts, which proves
-- the record <-> row mapping; this proves Postgres returns the rows intact.
-- ---------------------------------------------------------------------------

-- Derived coverage is a ratio like 0.147222222222222…; numeric(6,5) truncated it
-- to 0.14722, so the column is double precision (20260716103000).
insert into public.mask_assets
  (mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path,
   coverage, width, height, expires_at)
values
  ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-1111-1111-1111-111111111111',
   'aaaaaaaa-2222-2222-2222-222222222222','aaaaaaaa-3333-3333-3333-333333333333',
   'hair_current','a/prec.bin', 0.14722222222222223, 48, 64, now() + interval '1 day');

select is(
  (select coverage from public.mask_assets where storage_path = 'a/prec.bin'),
  0.14722222222222223::double precision,
  'a derived coverage float round-trips through the DB exactly, unrounded'
);

-- The region map is a label grid, not a ratio: null, never a fake 0.
select is(
  (select coverage from public.mask_assets
   where mask_contract_id = 'cccccccc-0000-0000-0000-000000000001'
     and kind = 'region_map'),
  null,
  'the region map carries no coverage ratio'
);

-- A contract's masks are reassembled by kind, which is what the app's
-- MaskContractRecord.maskAssetIds / .coverage maps are rebuilt from.
select is(
  (select count(distinct kind)::int from public.mask_assets
   where mask_contract_id = 'cccccccc-0000-0000-0000-000000000001'),
  3,
  'masks are addressable by kind within their contract'
);

select * from finish();
rollback;
