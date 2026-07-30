begin;
select plan(22);
set local role postgres;

insert into public.organizations (id, name) values ('e0000000-0000-0000-0000-000000000001', 'Retention Org');
insert into public.salons (id, organization_id, name) values
  ('e1000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Retention Salon');
insert into public.style_presets (id, display_name_ko, category) values
  ('retention-style', 'Retention Style', 'cut') on conflict (id) do nothing;
insert into public.consultation_sessions (id, salon_id, customer_alias) values
  ('e2000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'Retention Customer');
insert into public.source_images
  (id, salon_id, session_id, storage_path, mime, width, height, expires_at)
values
  ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'e2000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000001/e2000000-0000-0000-0000-000000000001/source.png',
   'image/png', 480, 640, now() - interval '1 hour');
insert into public.mask_contracts
  (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
values
  ('e4000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001',
   1, 6, 48, 64, now() - interval '1 hour');
insert into public.mask_assets
  (id, mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
values
  ('e5000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
   'e3000000-0000-0000-0000-000000000001', 'hair_edit',
   'e1000000-0000-0000-0000-000000000001/e2000000-0000-0000-0000-000000000001/mask.png',
   48, 64, now() - interval '1 hour');
insert into public.generation_jobs
  (id, salon_id, session_id, source_image_id, style_id, mask_contract_id, status)
values
  ('e6000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'e2000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001',
   'retention-style', 'e4000000-0000-0000-0000-000000000001', 'completed');
insert into public.generated_assets
  (id, salon_id, job_id, session_id, storage_path, mime, provider, model, expires_at)
values
  ('e7000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'e6000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000001/e2000000-0000-0000-0000-000000000001/result.png',
   'image/png', 'fixture', 'fixture-1', now() - interval '1 hour');
insert into public.quality_checks (salon_id, asset_id, status, hard_fail)
values ('e1000000-0000-0000-0000-000000000001', 'e7000000-0000-0000-0000-000000000001', 'accepted', false);

select is(
  (select count(*)::int from information_schema.routine_privileges
   where routine_schema='public' and routine_name like 'retention_%'
     and grantee in ('PUBLIC','anon','authenticated')),
  0, 'retention RPCs have no browser execute grants');
select is(
  (select count(distinct routine_name)::int from information_schema.routine_privileges
   where routine_schema='public' and routine_name like 'retention_%' and grantee='service_role'),
  3, 'all retention RPCs are explicitly granted to service_role');

set local role service_role;
select is(jsonb_array_length(public.retention_claim_expired_objects(100)), 3, 'claim leases all three expired Storage objects');
select is(
  (select count(distinct purge_claim_token)::int from (
    select purge_claim_token from public.source_images where id='e3000000-0000-0000-0000-000000000001'
    union all select purge_claim_token from public.mask_assets where id='e5000000-0000-0000-0000-000000000001'
    union all select purge_claim_token from public.generated_assets where id='e7000000-0000-0000-0000-000000000001'
  ) tokens),
  1, 'one claim call uses one opaque lease token');
select throws_ok(
  $$update public.source_images set purge_claimed_at=null where id='e3000000-0000-0000-0000-000000000001'$$,
  '42501', 'retention claim fields are server-managed',
  'even service_role cannot tamper with claim fields directly');
select isnt((select purge_claim_token from public.source_images where id='e3000000-0000-0000-0000-000000000001'), null, 'source remains claimed after rejected tampering');

select ok(public.retention_finalize_object(
  'mask','e5000000-0000-0000-0000-000000000001',
  (select purge_claim_token from public.mask_assets where id='e5000000-0000-0000-0000-000000000001')),
  'mask finalizes only with its claim token');
select is((select count(*)::int from public.mask_assets where id='e5000000-0000-0000-0000-000000000001'),0,'mask metadata is deleted after remote deletion');
select isnt((select purged_at from public.mask_contracts where id='e4000000-0000-0000-0000-000000000001'),null,'job-referenced contract becomes a tombstone');
select is((select count(*)::int from public.audit_events where action='mask_contract_purged' and session_id='e2000000-0000-0000-0000-000000000001'),1,'mask purge is audited once');

select ok(public.retention_finalize_object(
  'generated','e7000000-0000-0000-0000-000000000001',
  (select purge_claim_token from public.generated_assets where id='e7000000-0000-0000-0000-000000000001')),
  'generated result finalizes with its claim token');
select is((select count(*)::int from public.generated_assets where id='e7000000-0000-0000-0000-000000000001'),0,'generated metadata is deleted');
select is((select count(*)::int from public.quality_checks where asset_id='e7000000-0000-0000-0000-000000000001'),0,'quality row cascades with generated metadata');
select is((select count(*)::int from public.audit_events where action='generated_asset_purged' and session_id='e2000000-0000-0000-0000-000000000001'),1,'generated deletion is audited');

select ok(public.retention_release_object(
  'source','e3000000-0000-0000-0000-000000000001',
  (select purge_claim_token from public.source_images where id='e3000000-0000-0000-0000-000000000001')),
  'failed remote source deletion releases the lease');
select is((select purge_claim_token from public.source_images where id='e3000000-0000-0000-0000-000000000001'),null,'released source is unclaimed');
select is(jsonb_array_length(public.retention_claim_expired_objects(100)),1,'released source is immediately retryable');
select ok(public.retention_finalize_object(
  'source','e3000000-0000-0000-0000-000000000001',
  (select purge_claim_token from public.source_images where id='e3000000-0000-0000-0000-000000000001')),
  'retried source finalizes after remote deletion');
select is((select count(*)::int from public.source_images where id='e3000000-0000-0000-0000-000000000001'),0,'source metadata is deleted');
select is((select count(*)::int from public.generation_jobs where id='e6000000-0000-0000-0000-000000000001'),0,'source deletion cascades the expired job graph');
select is((select count(*)::int from public.audit_events where action='source_expired' and session_id='e2000000-0000-0000-0000-000000000001'),1,'source deletion is audited');
select is(public.retention_finalize_object('source','e3000000-0000-0000-0000-000000000001',gen_random_uuid()),false,'stale finalize is harmless');

select * from finish();
rollback;
