begin;
select plan(4);
set local role postgres;

select is(
  (select count(*)::int from pg_policies where schemaname='storage' and tablename='objects'
    and policyname in ('source-images-private_update','generated-assets-private_update','masks-private_update')),
  0,
  'customer media buckets expose no authenticated replacement policy'
);

insert into public.organizations(id,name) values ('a1000000-0000-0000-0000-000000000001','Hardening Org');
insert into public.salons(id,organization_id,name) values
  ('a2000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Salon A'),
  ('a2000000-0000-0000-0000-000000000002','a1000000-0000-0000-0000-000000000001','Salon B');
insert into public.consultation_sessions(id,salon_id,customer_alias) values
  ('a3000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Customer');
insert into public.source_images(id,salon_id,session_id,storage_path,mime,width,height,expires_at) values
  ('a4000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001/a3000000-0000-0000-0000-000000000001/source.png','image/png',480,640,now()+interval '1 day');
insert into public.mask_contracts(id,salon_id,session_id,source_image_id,attempt,expansion_radius,width,height,expires_at) values
  ('a5000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001',
   'a4000000-0000-0000-0000-000000000001',1,6,48,64,now()+interval '1 day');
insert into public.style_presets(id,display_name_ko,category,salon_id) values
  ('salon-b-private','Salon B Private','cut','a2000000-0000-0000-0000-000000000002'),
  ('hardening-global','Global','cut',null);

select throws_ok($$
  insert into public.generation_jobs(salon_id,session_id,source_image_id,style_id,mask_contract_id,status)
  values('a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001',
    'salon-b-private','a5000000-0000-0000-0000-000000000001','queued')
$$,'23503','style preset is not available to this salon','a job cannot bind another salon private style');

select lives_ok($$
  insert into public.generation_jobs(salon_id,session_id,source_image_id,style_id,mask_contract_id,status)
  values('a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001',
    'hardening-global','a5000000-0000-0000-0000-000000000001','queued')
$$,'a global style remains available to every salon');

select throws_ok($$
  update public.style_presets set salon_id='a2000000-0000-0000-0000-000000000002' where id='hardening-global'
$$,'23503','style preset is already used by another salon','an in-use global style cannot be rebound across tenants');

select * from finish();
rollback;
