-- Retry-safe remote retention: claim metadata, delete Storage through its API,
-- then finalize rows with an unguessable claim token.
alter table public.source_images add column purge_claimed_at timestamptz, add column purge_claim_token uuid;
alter table public.mask_assets add column purge_claimed_at timestamptz, add column purge_claim_token uuid;
alter table public.generated_assets add column purge_claimed_at timestamptz, add column purge_claim_token uuid;

create index source_images_retention_claim on public.source_images (expires_at)
  where not saved and expires_at is not null;
create index mask_assets_retention_claim on public.mask_assets (expires_at)
  where not saved and expires_at is not null;
create index generated_assets_retention_claim on public.generated_assets (expires_at)
  where not saved and expires_at is not null;

create or replace function private.protect_retention_claim_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'postgres' and (
    new.purge_claimed_at is distinct from old.purge_claimed_at or
    new.purge_claim_token is distinct from old.purge_claim_token
  ) then
    raise exception using errcode = '42501', message = 'retention claim fields are server-managed';
  end if;
  return new;
end;
$$;

create trigger source_images_protect_retention_claim before update on public.source_images
  for each row execute function private.protect_retention_claim_fields();
create trigger mask_assets_protect_retention_claim before update on public.mask_assets
  for each row execute function private.protect_retention_claim_fields();
create trigger generated_assets_protect_retention_claim before update on public.generated_assets
  for each row execute function private.protect_retention_claim_fields();

create or replace function public.retention_claim_expired_objects(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_token uuid := gen_random_uuid();
  v_items jsonb;
begin
  if p_limit < 1 or p_limit > 500 then
    raise exception using errcode = '22023', message = 'retention claim limit must be between 1 and 500';
  end if;

  with candidates as (
    select id from public.source_images
    where not saved and expires_at <= now()
      and (purge_claimed_at is null or purge_claimed_at < now() - interval '15 minutes')
    order by expires_at, id for update skip locked limit p_limit
  )
  update public.source_images row set purge_claimed_at = now(), purge_claim_token = v_token
  from candidates where row.id = candidates.id;

  with candidates as (
    select id from public.mask_assets
    where not saved and expires_at <= now()
      and (purge_claimed_at is null or purge_claimed_at < now() - interval '15 minutes')
    order by expires_at, id for update skip locked limit p_limit
  )
  update public.mask_assets row set purge_claimed_at = now(), purge_claim_token = v_token
  from candidates where row.id = candidates.id;

  with candidates as (
    select id from public.generated_assets
    where not saved and expires_at <= now()
      and (purge_claimed_at is null or purge_claimed_at < now() - interval '15 minutes')
    order by expires_at, id for update skip locked limit p_limit
  )
  update public.generated_assets row set purge_claimed_at = now(), purge_claim_token = v_token
  from candidates where row.id = candidates.id;

  select coalesce(jsonb_agg(item order by item->>'kind', item->>'id'), '[]'::jsonb)
  into v_items from (
    select jsonb_build_object('kind','source','id',id,'storage_path',storage_path,'claim_token',v_token) item
      from public.source_images where purge_claim_token = v_token
    union all
    select jsonb_build_object('kind','mask','id',id,'storage_path',storage_path,'claim_token',v_token)
      from public.mask_assets where purge_claim_token = v_token
    union all
    select jsonb_build_object('kind','generated','id',id,'storage_path',storage_path,'claim_token',v_token)
      from public.generated_assets where purge_claim_token = v_token
  ) claimed;
  return v_items;
end;
$$;

create or replace function public.retention_release_object(p_kind text, p_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  if p_kind = 'source' then
    update public.source_images set purge_claimed_at = null, purge_claim_token = null
      where id = p_id and purge_claim_token = p_claim_token;
  elsif p_kind = 'mask' then
    update public.mask_assets set purge_claimed_at = null, purge_claim_token = null
      where id = p_id and purge_claim_token = p_claim_token;
  elsif p_kind = 'generated' then
    update public.generated_assets set purge_claimed_at = null, purge_claim_token = null
      where id = p_id and purge_claim_token = p_claim_token;
  else
    raise exception using errcode = '22023', message = 'unknown retention object kind';
  end if;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.retention_finalize_object(p_kind text, p_id uuid, p_claim_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_salon uuid; v_session uuid; v_contract uuid; v_count int;
begin
  if p_kind = 'source' then
    delete from public.source_images where id = p_id and purge_claim_token = p_claim_token
      returning salon_id, session_id into v_salon, v_session;
    get diagnostics v_count = row_count;
    if v_count = 1 then
      insert into public.audit_events(salon_id, session_id, action, actor_id, detail)
      values (v_salon, v_session, 'source_expired', 'retention-sweep', jsonb_build_object('source_image_id',p_id));
    end if;
  elsif p_kind = 'generated' then
    delete from public.generated_assets where id = p_id and purge_claim_token = p_claim_token
      returning salon_id, session_id into v_salon, v_session;
    get diagnostics v_count = row_count;
    if v_count = 1 then
      insert into public.audit_events(salon_id, session_id, action, actor_id, detail)
      values (v_salon, v_session, 'generated_asset_purged', 'retention-sweep', jsonb_build_object('generated_asset_id',p_id));
    end if;
  elsif p_kind = 'mask' then
    delete from public.mask_assets where id = p_id and purge_claim_token = p_claim_token
      returning salon_id, session_id, mask_contract_id into v_salon, v_session, v_contract;
    get diagnostics v_count = row_count;
    if v_count = 1 and not exists (select 1 from public.mask_assets where mask_contract_id = v_contract) then
      if exists (select 1 from public.generation_jobs where mask_contract_id = v_contract) then
        update public.mask_contracts set purged_at = now() where id = v_contract and purged_at is null;
        if found then
          insert into public.audit_events(salon_id, session_id, action, actor_id, detail)
          values (v_salon, v_session, 'mask_contract_purged', 'retention-sweep', jsonb_build_object('mask_contract_id',v_contract));
        end if;
      else
        delete from public.mask_contracts where id = v_contract;
      end if;
    end if;
  else
    raise exception using errcode = '22023', message = 'unknown retention object kind';
  end if;
  return coalesce(v_count, 0) = 1;
end;
$$;

revoke all on function public.retention_claim_expired_objects(int) from public, anon, authenticated;
revoke all on function public.retention_release_object(text,uuid,uuid) from public, anon, authenticated;
revoke all on function public.retention_finalize_object(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.retention_claim_expired_objects(int) to service_role;
grant execute on function public.retention_release_object(text,uuid,uuid) to service_role;
grant execute on function public.retention_finalize_object(text,uuid,uuid) to service_role;
