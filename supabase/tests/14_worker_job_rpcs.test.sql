begin;
select plan(16);
set local role postgres;

insert into public.organizations (id, name) values
  ('f0000000-0000-0000-0000-000000000001', 'Worker Org');
insert into public.salons (id, organization_id, name) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'Worker Salon');
insert into public.style_presets (id, display_name_ko, category) values
  ('worker-style', 'Worker Style', 'cut') on conflict (id) do nothing;
insert into public.consultation_sessions (id, salon_id, customer_alias) values
  ('f2000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001', 'Worker Customer');
insert into public.source_images
  (id, salon_id, session_id, storage_path, mime, width, height, expires_at)
values
  ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'f2000000-0000-0000-0000-000000000001',
   'f1000000-0000-0000-0000-000000000001/f2000000-0000-0000-0000-000000000001/source.png',
   'image/png', 480, 640, now() + interval '1 day');
insert into public.mask_contracts
  (id, salon_id, session_id, source_image_id, attempt, expansion_radius, width, height, expires_at)
values
  ('f4000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'f2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001',
   1, 6, 48, 64, now() + interval '1 day');
insert into public.mask_assets
  (id, mask_contract_id, salon_id, session_id, source_image_id, kind, storage_path, width, height, expires_at)
values
  ('f5000000-0000-0000-0000-000000000001', 'f4000000-0000-0000-0000-000000000001',
   'f1000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-000000000001', 'hair_edit',
   'f1000000-0000-0000-0000-000000000001/f2000000-0000-0000-0000-000000000001/mask.png',
   48, 64, now() + interval '1 day');
insert into public.generation_jobs
  (id, salon_id, session_id, source_image_id, style_id, mask_contract_id, status)
values
  ('f6000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001',
   'f2000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001',
   'worker-style', 'f4000000-0000-0000-0000-000000000001', 'queued');

select is(
  (select count(*)::int from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name like 'worker_%'
     and grantee in ('PUBLIC','anon','authenticated')),
  0,
  'worker RPCs have no browser-facing execute grants'
);
select is(
  (select count(distinct routine_name)::int from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name like 'worker_%'
     and grantee = 'service_role'),
  4,
  'all worker RPCs are explicitly granted to service_role'
);

set local role service_role;
select is(
  (public.worker_claim_generation_job()->>'job_id')::uuid,
  'f6000000-0000-0000-0000-000000000001'::uuid,
  'claim returns the queued job'
);
select is(
  (select status from public.generation_jobs where id = 'f6000000-0000-0000-0000-000000000001'),
  'masking'::public.job_status,
  'claim atomically moves the job to masking'
);
select is(public.worker_claim_generation_job(), null, 'a claimed job cannot be claimed twice');
select throws_ok(
  $$select public.worker_transition_generation_job(
    'f6000000-0000-0000-0000-000000000001', 'masking', 'quality_checking')$$,
  'P0001', 'invalid worker lifecycle transition',
  'the worker cannot skip lifecycle states'
);
select lives_ok(
  $$select public.worker_transition_generation_job(
    'f6000000-0000-0000-0000-000000000001', 'masking', 'generating')$$,
  'masking transitions to generating'
);
select lives_ok(
  $$select public.worker_transition_generation_job(
    'f6000000-0000-0000-0000-000000000001', 'generating', 'quality_checking')$$,
  'generating transitions to quality_checking'
);
select throws_ok(
  $$select public.worker_finish_generation_job(
    'f6000000-0000-0000-0000-000000000001',
    '[{"storage_path":"other-salon/result.png","mime":"image/png","quality":{"status":"accepted","hard_fail":false}}]'::jsonb)$$,
  'P0001', 'invalid worker candidate payload',
  'finish rejects a result path outside the job tenant and session'
);
select is(
  (select count(*)::int from public.generated_assets where job_id = 'f6000000-0000-0000-0000-000000000001'),
  0,
  'a rejected finish inserts no asset rows'
);
select is(
  public.worker_finish_generation_job(
    'f6000000-0000-0000-0000-000000000001',
    '[{"storage_path":"f1000000-0000-0000-0000-000000000001/f2000000-0000-0000-0000-000000000001/result.png","mime":"image/png","seed":1010,"variant_label":"A","provider":"fixture","model":"fixture-1","quality":{"status":"accepted","hard_fail":false,"signals":{"face_count":1},"soft_flags":[],"hard_reasons":[]}}]'::jsonb),
  'completed'::public.job_status,
  'a valid accepted result completes the job'
);
select is(
  (select count(*)::int from public.generated_assets where job_id = 'f6000000-0000-0000-0000-000000000001'),
  1,
  'finish persists exactly one generated asset'
);
select is(
  (select count(*)::int from public.quality_checks q join public.generated_assets a on a.id = q.asset_id
   where a.job_id = 'f6000000-0000-0000-0000-000000000001'),
  1,
  'finish persists the matching quality check'
);
select throws_ok(
  $$select public.worker_finish_generation_job('f6000000-0000-0000-0000-000000000001', '[]'::jsonb)$$,
  'P0001', 'job is not quality_checking',
  'terminal completion is idempotency-safe and cannot be repeated'
);

set local role anon;
select throws_ok(
  $$select public.worker_claim_generation_job()$$,
  '42501', null,
  'anon cannot claim worker jobs'
);
set local role authenticated;
select throws_ok(
  $$select public.worker_claim_generation_job()$$,
  '42501', null,
  'authenticated browser users cannot claim worker jobs'
);

select * from finish();
rollback;
