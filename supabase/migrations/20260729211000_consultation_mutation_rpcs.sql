-- Browser mutations that affect generation integrity are RPC-only.
create or replace function private.block_direct_generation_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode='42501', message='generation mutation requires an approved RPC';
  end if;
  return new;
end;
$$;

create trigger generation_jobs_rpc_only before update on public.generation_jobs
  for each row execute function private.block_direct_generation_mutation();
create trigger generated_assets_rpc_only before update on public.generated_assets
  for each row execute function private.block_direct_generation_mutation();

create or replace function public.set_generated_asset_verdict(
  p_asset_id uuid,
  p_verdict public.stylist_verdict
)
returns void language plpgsql security definer set search_path='' as $$
declare v_salon uuid; v_status public.quality_status; v_hard boolean;
begin
  select asset.salon_id, quality.status, quality.hard_fail
  into v_salon, v_status, v_hard
  from public.generated_assets asset join public.quality_checks quality on quality.asset_id=asset.id
  where asset.id=p_asset_id for update of asset;
  if v_salon is null or not private.is_salon_member(v_salon) then
    raise exception using errcode='P0001', message='generated asset not found';
  end if;
  if p_verdict='usable' and (v_hard or v_status not in ('accepted','needs_stylist_review')) then
    raise exception using errcode='P0001', message='quality-blocked asset cannot be approved';
  end if;
  update public.generated_assets set stylist_verdict=p_verdict where id=p_asset_id;
end;
$$;

create or replace function public.retry_generation_job(p_job_id uuid, p_mask_contract_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_job public.generation_jobs%rowtype; v_contract public.mask_contracts%rowtype;
begin
  select * into v_job from public.generation_jobs where id=p_job_id for update;
  if not found or not private.is_salon_member(v_job.salon_id) then
    raise exception using errcode='P0001', message='generation job not found';
  end if;
  if v_job.status <> 'failed_retryable' or v_job.attempts >= v_job.max_attempts then
    raise exception using errcode='P0001', message='generation job cannot be retried';
  end if;
  select * into v_contract from public.mask_contracts
  where id=p_mask_contract_id and salon_id=v_job.salon_id and session_id=v_job.session_id
    and source_image_id=v_job.source_image_id and purged_at is null
    and attempt=v_job.attempts+1;
  if not found then raise exception using errcode='P0001', message='retry mask contract is invalid'; end if;
  update public.generation_jobs set status='queued', attempts=attempts+1,
    mask_contract_id=v_contract.id, mask_contract_version=v_contract.version,
    failure_reason=null where id=v_job.id;
end;
$$;

create or replace function public.save_asset_with_consent(p_asset_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_session uuid; v_salon uuid; v_source uuid; v_kind text;
begin
  select asset.session_id,asset.salon_id,job.source_image_id,'generated'
  into v_session,v_salon,v_source,v_kind
  from public.generated_assets asset join public.generation_jobs job on job.id=asset.job_id
  join public.quality_checks quality on quality.asset_id=asset.id
  where asset.id=p_asset_id and asset.stylist_verdict='usable' and not quality.hard_fail
    and quality.status in ('accepted','needs_stylist_review');
  if v_session is null then
    select session_id,salon_id,id,'source' into v_session,v_salon,v_source,v_kind
    from public.source_images where id=p_asset_id;
  end if;
  if v_session is null or not private.is_salon_member(v_salon) then
    raise exception using errcode='P0001', message='savable asset not found';
  end if;
  if not exists (
    select 1 from public.consultation_sessions session
    join public.consent_records consent on consent.id=session.consent_id and consent.salon_id=session.salon_id
    where session.id=v_session and session.salon_id=v_salon
      and consent.save_images_consented and consent.revoked_at is null
  ) then raise exception using errcode='P0001', message='save_images consent required'; end if;

  if v_kind='generated' then
    update public.generated_assets set saved=true,expires_at=null where id=p_asset_id;
  else
    update public.source_images set saved=true,expires_at=null where id=v_source;
    update public.mask_contracts set saved=true,expires_at=null
      where source_image_id=v_source and purged_at is null;
    update public.mask_assets set saved=true,expires_at=null where source_image_id=v_source;
  end if;
end;
$$;

create or replace function public.expire_unsaved_asset(p_asset_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_salon uuid; v_saved boolean;
begin
  select salon_id,saved into v_salon,v_saved from public.generated_assets where id=p_asset_id for update;
  if v_salon is null then
    select salon_id,saved into v_salon,v_saved from public.source_images where id=p_asset_id for update;
  end if;
  if v_salon is null or not private.is_salon_member(v_salon) then
    raise exception using errcode='P0001', message='asset not found';
  end if;
  if v_saved then
    raise exception using errcode='P0001', message='saved asset cannot be expired';
  end if;
  update public.generated_assets set expires_at=now()-interval '1 second' where id=p_asset_id;
  update public.source_images set expires_at=now()-interval '1 second' where id=p_asset_id;
end;
$$;

revoke all on function public.set_generated_asset_verdict(uuid,public.stylist_verdict) from public,anon,service_role;
revoke all on function public.retry_generation_job(uuid,uuid) from public,anon,service_role;
revoke all on function public.save_asset_with_consent(uuid) from public,anon,service_role;
revoke all on function public.expire_unsaved_asset(uuid) from public,anon,service_role;
grant execute on function public.set_generated_asset_verdict(uuid,public.stylist_verdict) to authenticated;
grant execute on function public.retry_generation_job(uuid,uuid) to authenticated;
grant execute on function public.save_asset_with_consent(uuid) to authenticated;
grant execute on function public.expire_unsaved_asset(uuid) to authenticated;
