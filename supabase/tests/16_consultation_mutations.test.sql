begin;
select plan(25);
set local role postgres;

insert into auth.users(id,email) values ('d0000000-0000-0000-0000-000000000001','stylist@worker.test');
insert into public.profiles(id,display_name) values ('d0000000-0000-0000-0000-000000000001','Stylist');
insert into public.organizations(id,name) values ('d1000000-0000-0000-0000-000000000001','Mutation Org');
insert into public.salons(id,organization_id,name) values
  ('d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','Mutation Salon');
insert into public.salon_memberships(salon_id,profile_id,role) values
  ('d2000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','stylist');
insert into public.style_presets(id,display_name_ko,category) values
  ('mutation-style','Mutation Style','cut') on conflict(id) do nothing;
insert into public.consultation_sessions(id,salon_id,stylist_id,customer_alias) values
  ('d3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-000000000001','Customer');
insert into public.source_images(id,salon_id,session_id,storage_path,mime,width,height,expires_at) values
  ('d4000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001',
   'd3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001/d3000000-0000-0000-0000-000000000001/source.png','image/png',480,640,now()+interval '1 day');
insert into public.mask_contracts(id,salon_id,session_id,source_image_id,attempt,expansion_radius,width,height,expires_at) values
  ('d5000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001',
   'd3000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001',1,6,48,64,now()+interval '1 day'),
  ('d5000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000001',
   'd3000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001',2,4,48,64,now()+interval '1 day');
insert into public.mask_assets(mask_contract_id,salon_id,session_id,source_image_id,kind,storage_path,width,height,expires_at) values
  ('d5000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','hair_edit','d2000000-0000-0000-0000-000000000001/d3000000-0000-0000-0000-000000000001/mask1.png',48,64,now()+interval '1 day'),
  ('d5000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001','hair_edit','d2000000-0000-0000-0000-000000000001/d3000000-0000-0000-0000-000000000001/mask2.png',48,64,now()+interval '1 day');
insert into public.generation_jobs(id,salon_id,session_id,source_image_id,style_id,mask_contract_id,status) values
  ('d6000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001',
   'd3000000-0000-0000-0000-000000000001','d4000000-0000-0000-0000-000000000001',
   'mutation-style','d5000000-0000-0000-0000-000000000001','failed_retryable');
insert into public.generated_assets(id,salon_id,job_id,session_id,storage_path,mime,provider,model,expires_at) values
  ('d7000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001/d3000000-0000-0000-0000-000000000001/accepted.png','image/png','fixture','v1',now()+interval '1 day'),
  ('d7000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000001','d6000000-0000-0000-0000-000000000001','d3000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001/d3000000-0000-0000-0000-000000000001/blocked.png','image/png','fixture','v1',now()+interval '1 day');
insert into public.quality_checks(salon_id,asset_id,status,hard_fail) values
  ('d2000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000001','accepted',false),
  ('d2000000-0000-0000-0000-000000000001','d7000000-0000-0000-0000-000000000002','blocked_identity_changed',true);

select is((select count(*)::int from information_schema.routine_privileges where routine_schema='public' and routine_name in ('set_generated_asset_verdict','retry_generation_job','save_asset_with_consent','expire_unsaved_asset') and grantee in ('PUBLIC','anon','service_role')),0,'mutation RPCs exclude public, anon, and service_role');
select is((select count(distinct routine_name)::int from information_schema.routine_privileges where routine_schema='public' and routine_name in ('set_generated_asset_verdict','retry_generation_job','save_asset_with_consent','expire_unsaved_asset') and grantee='authenticated'),4,'authenticated receives exactly the approved mutation RPCs');

set local role service_role;
select throws_ok($$update public.generation_jobs set status='completed' where id='d6000000-0000-0000-0000-000000000001'$$,'42501','generation mutation requires an approved RPC','service_role cannot bypass job lifecycle');
select throws_ok($$update public.generated_assets set saved=true,expires_at=null where id='d7000000-0000-0000-0000-000000000001'$$,'42501','generation mutation requires an approved RPC','service_role cannot bypass save rules');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.set_generated_asset_verdict('d7000000-0000-0000-0000-000000000002','usable')$$,'P0001','quality-blocked asset cannot be approved','hard-failed candidate cannot be approved');
select lives_ok($$select public.set_generated_asset_verdict('d7000000-0000-0000-0000-000000000002','regenerate')$$,'blocked candidate can be marked regenerate');
select lives_ok($$select public.set_generated_asset_verdict('d7000000-0000-0000-0000-000000000001','usable')$$,'accepted candidate can be explicitly approved');
select is((select stylist_verdict from public.generated_assets where id='d7000000-0000-0000-0000-000000000001'),'usable'::public.stylist_verdict,'approved verdict is stored');
select lives_ok($$select public.expire_unsaved_asset('d7000000-0000-0000-0000-000000000002')$$,'member can expire an unsaved generated asset');
select ok((select expires_at < now() from public.generated_assets where id='d7000000-0000-0000-0000-000000000002'),'expiry RPC makes the asset retention-eligible');
select throws_ok($$select public.save_asset_with_consent('d7000000-0000-0000-0000-000000000001')$$,'P0001','save_images consent required','saving is blocked without consent');

set local role postgres;
insert into public.consent_records(id,salon_id,capture_consented,save_images_consented,wording_version) values
  ('d8000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000001',true,true,'test-v1');
update public.consultation_sessions set consent_id='d8000000-0000-0000-0000-000000000001' where id='d3000000-0000-0000-0000-000000000001';
update public.source_images set purge_claimed_at=now(),purge_claim_token='d9000000-0000-0000-0000-000000000001'
  where id='d4000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.save_asset_with_consent('d7000000-0000-0000-0000-000000000001')$$,'P0001','asset retention is in progress','save cannot race an active retention claim');
set local role postgres;
update public.source_images set purge_claimed_at=null,purge_claim_token=null where id='d4000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$select public.save_asset_with_consent('d7000000-0000-0000-0000-000000000001')$$,'approved result saves with explicit consent');
select ok((select saved from public.generated_assets where id='d7000000-0000-0000-0000-000000000001'),'generated result is marked saved');
select ok((select saved from public.source_images where id='d4000000-0000-0000-0000-000000000001'),'saving a result preserves its source before retention can cascade it');
select is((select count(*)::int from public.mask_assets where source_image_id='d4000000-0000-0000-0000-000000000001' and saved),2,'saving a result preserves its masks in the same transaction');
select lives_ok($$select public.save_asset_with_consent('d4000000-0000-0000-0000-000000000001')$$,'source saves with explicit consent');
select ok((select saved from public.source_images where id='d4000000-0000-0000-0000-000000000001'),'source is marked saved');
select throws_ok($$select public.expire_unsaved_asset('d4000000-0000-0000-0000-000000000001')$$,'P0001','saved asset cannot be expired','saved source cannot be discarded');
select is((select count(*)::int from public.mask_contracts where source_image_id='d4000000-0000-0000-0000-000000000001' and saved),2,'all active source contracts are saved together');
select is((select count(*)::int from public.mask_assets where source_image_id='d4000000-0000-0000-0000-000000000001' and saved),2,'all active source mask bytes are saved together');
select throws_ok($$select public.retry_generation_job('d6000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000001')$$,'P0001','retry mask contract is invalid','retry cannot reuse the previous-attempt contract');
select lives_ok($$select public.retry_generation_job('d6000000-0000-0000-0000-000000000001','d5000000-0000-0000-0000-000000000002')$$,'retry accepts only the next-attempt contract');
select is((select status from public.generation_jobs where id='d6000000-0000-0000-0000-000000000001'),'queued'::public.job_status,'retry atomically requeues the job');
select is((select attempts from public.generation_jobs where id='d6000000-0000-0000-0000-000000000001'),2,'retry atomically increments attempts');

select * from finish();
rollback;
