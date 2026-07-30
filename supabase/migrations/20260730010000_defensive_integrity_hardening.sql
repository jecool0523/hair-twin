-- Defensive integrity hardening discovered during final review. This migration
-- is additive so previously deployed migration history remains immutable.

-- Customer media is immutable. Replacements use a new object name and DB row.
drop policy if exists "source-images-private_update" on storage.objects;
drop policy if exists "generated-assets-private_update" on storage.objects;
drop policy if exists "masks-private_update" on storage.objects;

create or replace function private.enforce_job_style_tenant()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.style_presets preset
    where preset.id = new.style_id
      and (preset.salon_id is null or preset.salon_id = new.salon_id)
  ) then
    raise exception using errcode = '23503', message = 'style preset is not available to this salon';
  end if;
  return new;
end;
$$;

create trigger generation_jobs_style_tenant
before insert or update of style_id, salon_id on public.generation_jobs
for each row execute function private.enforce_job_style_tenant();

create or replace function private.protect_style_tenant_rebinding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.salon_id is distinct from old.salon_id and exists (
    select 1 from public.generation_jobs job
    where job.style_id = old.id and new.salon_id is not null and job.salon_id <> new.salon_id
  ) then
    raise exception using errcode = '23503', message = 'style preset is already used by another salon';
  end if;
  return new;
end;
$$;
create trigger style_presets_protect_tenant_rebinding
before update of salon_id on public.style_presets
for each row execute function private.protect_style_tenant_rebinding();

create or replace function public.accept_salon_invite(p_invite_id uuid, p_display_name text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_invite public.pending_invites%rowtype;
  v_membership_id uuid;
  v_existing_role public.membership_role;
begin
  if v_uid is null then raise exception 'no authenticated caller' using errcode='insufficient_privilege'; end if;
  select lower(btrim(u.email)) into v_email from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'authenticated user has no verified email identity' using errcode='insufficient_privilege';
  end if;
  select * into v_invite from public.pending_invites where id=p_invite_id for update;
  if not found then raise exception 'invite % not found',p_invite_id using errcode='no_data_found'; end if;
  if v_invite.accepted_profile_id=v_uid then
    select id into v_membership_id from public.salon_memberships
      where salon_id=v_invite.salon_id and profile_id=v_uid;
    if v_membership_id is null then
      raise exception 'accepted invite % has no membership',p_invite_id using errcode='integrity_constraint_violation';
    end if;
    return v_membership_id;
  end if;
  if v_invite.accepted_at is not null or v_invite.revoked_at is not null or v_invite.expired_at is not null then
    raise exception 'invite % is already terminal',p_invite_id using errcode='restrict_violation';
  end if;
  if v_invite.expires_at<=now() then raise exception 'invite % has expired',p_invite_id using errcode='restrict_violation'; end if;
  if v_email<>v_invite.email then raise exception 'authenticated email does not match invite %',p_invite_id using errcode='insufficient_privilege'; end if;
  insert into public.profiles(id,display_name)
  values(v_uid,coalesce(nullif(btrim(p_display_name),''),split_part(v_email,'@',1))) on conflict(id) do nothing;
  select id,role into v_membership_id,v_existing_role from public.salon_memberships
    where salon_id=v_invite.salon_id and profile_id=v_uid;
  if v_membership_id is not null and v_existing_role<>v_invite.role then
    raise exception 'existing membership role conflicts with invite %',p_invite_id using errcode='restrict_violation';
  end if;
  if v_membership_id is null then
    insert into public.salon_memberships(salon_id,profile_id,role)
    values(v_invite.salon_id,v_uid,v_invite.role) returning id into v_membership_id;
  end if;
  update public.pending_invites set accepted_at=now(),accepted_profile_id=v_uid where id=p_invite_id;
  insert into public.audit_events(salon_id,action,actor_id,detail)
  values(v_invite.salon_id,'invite_accepted',v_uid::text,
    jsonb_build_object('inviteId',p_invite_id,'membershipId',v_membership_id,'role',v_invite.role));
  return v_membership_id;
end;
$$;
revoke all on function public.accept_salon_invite(uuid,text) from public,anon,service_role;
grant execute on function public.accept_salon_invite(uuid,text) to authenticated;

create or replace function public.save_asset_with_consent(p_asset_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_session uuid; v_salon uuid; v_source uuid; v_kind text;
begin
  select asset.session_id,asset.salon_id,job.source_image_id,'generated'
  into v_session,v_salon,v_source,v_kind
  from public.generated_assets asset
  join public.generation_jobs job on job.id=asset.job_id
  join public.quality_checks quality on quality.asset_id=asset.id
  where asset.id=p_asset_id and asset.stylist_verdict='usable' and not quality.hard_fail
    and quality.status in ('accepted','needs_stylist_review') for update of asset;
  if v_session is null then
    select session_id,salon_id,id,'source' into v_session,v_salon,v_source,v_kind
    from public.source_images where id=p_asset_id for update;
  end if;
  if v_session is null or not private.is_salon_member(v_salon) then
    raise exception using errcode='P0001',message='savable asset not found';
  end if;
  if not exists (
    select 1 from public.consultation_sessions session
    join public.consent_records consent on consent.id=session.consent_id and consent.salon_id=session.salon_id
    where session.id=v_session and session.salon_id=v_salon and consent.save_images_consented and consent.revoked_at is null
  ) then raise exception using errcode='P0001',message='save_images consent required'; end if;
  -- Serialize consent-save against the claim query. Whichever transaction
  -- locks the source/masks first wins; save never races a remote deletion.
  perform 1 from public.source_images where id=v_source for update;
  perform 1 from public.mask_assets where source_image_id=v_source for update;
  if exists(select 1 from public.source_images where id=v_source and purge_claim_token is not null)
    or exists(select 1 from public.mask_assets where source_image_id=v_source and purge_claim_token is not null)
    or (v_kind='generated' and exists(select 1 from public.generated_assets where id=p_asset_id and purge_claim_token is not null)) then
    raise exception using errcode='P0001',message='asset retention is in progress';
  end if;
  if v_kind='generated' then
    update public.generated_assets set saved=true,expires_at=null where id=p_asset_id;
  end if;
  update public.source_images set saved=true,expires_at=null where id=v_source;
  update public.mask_contracts set saved=true,expires_at=null where source_image_id=v_source and purged_at is null;
  update public.mask_assets set saved=true,expires_at=null where source_image_id=v_source;
end;
$$;
revoke all on function public.save_asset_with_consent(uuid) from public,anon,service_role;
grant execute on function public.save_asset_with_consent(uuid) to authenticated;

create or replace function public.retention_claim_expired_objects(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token uuid:=gen_random_uuid(); v_items jsonb;
begin
  if p_limit<1 or p_limit>500 then raise exception using errcode='22023',message='retention claim limit must be between 1 and 500'; end if;
  with candidates as (
    select source.id from public.source_images source
    where not source.saved and source.expires_at<=now()
      and (source.purge_claimed_at is null or source.purge_claimed_at<now()-interval '15 minutes')
      and not exists (
        select 1 from public.generation_jobs job join public.generated_assets asset on asset.job_id=job.id
        where job.source_image_id=source.id and asset.saved
      )
    order by source.expires_at,source.id for update of source skip locked limit p_limit
  ) update public.source_images row set purge_claimed_at=now(),purge_claim_token=v_token from candidates where row.id=candidates.id;
  with candidates as (
    select id from public.mask_assets where not saved and expires_at<=now()
      and (purge_claimed_at is null or purge_claimed_at<now()-interval '15 minutes')
    order by expires_at,id for update skip locked limit p_limit
  ) update public.mask_assets row set purge_claimed_at=now(),purge_claim_token=v_token from candidates where row.id=candidates.id;
  with candidates as (
    select id from public.generated_assets where not saved and expires_at<=now()
      and (purge_claimed_at is null or purge_claimed_at<now()-interval '15 minutes')
    order by expires_at,id for update skip locked limit p_limit
  ) update public.generated_assets row set purge_claimed_at=now(),purge_claim_token=v_token from candidates where row.id=candidates.id;
  select coalesce(jsonb_agg(item order by item->>'kind',item->>'id'),'[]'::jsonb) into v_items from (
    select jsonb_build_object('kind','source','id',id,'salon_id',salon_id,'session_id',session_id,'storage_path',storage_path,'claim_token',v_token) item from public.source_images where purge_claim_token=v_token
    union all select jsonb_build_object('kind','mask','id',id,'salon_id',salon_id,'session_id',session_id,'storage_path',storage_path,'claim_token',v_token) from public.mask_assets where purge_claim_token=v_token
    union all select jsonb_build_object('kind','generated','id',id,'salon_id',salon_id,'session_id',session_id,'storage_path',storage_path,'claim_token',v_token) from public.generated_assets where purge_claim_token=v_token
  ) claimed;
  return v_items;
end;
$$;

create or replace function public.retention_finalize_object(p_kind text,p_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_salon uuid;v_session uuid;v_contract uuid;v_count int;
begin
  if p_kind='source' then
    delete from public.source_images where id=p_id and purge_claim_token=p_claim_token and not saved
      returning salon_id,session_id into v_salon,v_session;
    get diagnostics v_count=row_count;
    if v_count=1 then insert into public.audit_events(salon_id,session_id,action,actor_id,detail)
      values(v_salon,v_session,'source_expired','retention-sweep',jsonb_build_object('source_image_id',p_id)); end if;
  elsif p_kind='generated' then
    delete from public.generated_assets where id=p_id and purge_claim_token=p_claim_token and not saved
      returning salon_id,session_id into v_salon,v_session;
    get diagnostics v_count=row_count;
    if v_count=1 then insert into public.audit_events(salon_id,session_id,action,actor_id,detail)
      values(v_salon,v_session,'generated_asset_purged','retention-sweep',jsonb_build_object('generated_asset_id',p_id)); end if;
  elsif p_kind='mask' then
    delete from public.mask_assets where id=p_id and purge_claim_token=p_claim_token and not saved
      returning salon_id,session_id,mask_contract_id into v_salon,v_session,v_contract;
    get diagnostics v_count=row_count;
    if v_count=1 and not exists(select 1 from public.mask_assets where mask_contract_id=v_contract) then
      if exists(select 1 from public.generation_jobs where mask_contract_id=v_contract) then
        update public.mask_contracts set purged_at=now() where id=v_contract and purged_at is null;
        if found then insert into public.audit_events(salon_id,session_id,action,actor_id,detail)
          values(v_salon,v_session,'mask_contract_purged','retention-sweep',jsonb_build_object('mask_contract_id',v_contract)); end if;
      else delete from public.mask_contracts where id=v_contract; end if;
    end if;
  else raise exception using errcode='22023',message='unknown retention object kind'; end if;
  return coalesce(v_count,0)=1;
end;
$$;

revoke all on function public.retention_claim_expired_objects(int) from public,anon,authenticated;
revoke all on function public.retention_finalize_object(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.retention_claim_expired_objects(int) to service_role;
grant execute on function public.retention_finalize_object(text,uuid,uuid) to service_role;
