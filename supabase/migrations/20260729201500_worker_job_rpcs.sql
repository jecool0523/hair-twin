-- Atomic, least-privilege worker boundary. The server secret may call these
-- functions, but cannot use them to cross-link tenants or skip lifecycle steps.

create or replace function public.worker_claim_generation_job()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_payload jsonb;
begin
  select * into v_job
  from public.generation_jobs
  where status = 'queued'
  order by created_at, id
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.generation_jobs
  set status = 'masking', failure_reason = null
  where id = v_job.id;

  select jsonb_build_object(
    'job_id', v_job.id,
    'salon_id', v_job.salon_id,
    'session_id', v_job.session_id,
    'source_image_id', v_job.source_image_id,
    'source_storage_path', source.storage_path,
    'source_mime', source.mime,
    'source_width', source.width,
    'source_height', source.height,
    'mask_contract_id', contract.id,
    'mask_width', mask.width,
    'mask_height', mask.height,
    'hair_edit_mask_storage_path', mask.storage_path,
    'style_id', v_job.style_id,
    'style_attributes', preset.attributes,
    'mode', v_job.mode,
    'candidate_count', v_job.candidate_count,
    'attempts', v_job.attempts,
    'max_attempts', v_job.max_attempts
  ) into v_payload
  from public.source_images source
  join public.mask_contracts contract
    on contract.id = v_job.mask_contract_id
   and contract.salon_id = v_job.salon_id
   and contract.session_id = v_job.session_id
   and contract.source_image_id = v_job.source_image_id
   and contract.purged_at is null
  join public.mask_assets mask
    on mask.mask_contract_id = contract.id
   and mask.salon_id = v_job.salon_id
   and mask.kind = 'hair_edit'
  join public.style_presets preset on preset.id = v_job.style_id
  where source.id = v_job.source_image_id
    and source.salon_id = v_job.salon_id;

  if v_payload is null then
    update public.generation_jobs
    set status = 'failed_hard', failure_reason = 'required generation asset is missing'
    where id = v_job.id;
    return null;
  end if;
  return v_payload;
end;
$$;

create or replace function public.worker_transition_generation_job(
  p_job_id uuid,
  p_expected public.job_status,
  p_next public.job_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    (p_expected = 'masking' and p_next = 'generating') or
    (p_expected = 'generating' and p_next = 'quality_checking')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid worker lifecycle transition';
  end if;
  update public.generation_jobs set status = p_next
  where id = p_job_id and status = p_expected;
  if not found then
    raise exception using errcode = 'P0001', message = 'stale worker lifecycle transition';
  end if;
end;
$$;

create or replace function public.worker_finish_generation_job(
  p_job_id uuid,
  p_candidates jsonb
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_candidate jsonb;
  v_asset_id uuid;
  v_accepted int := 0;
  v_review int := 0;
  v_status public.job_status;
  v_prefix text;
begin
  select * into v_job from public.generation_jobs
  where id = p_job_id and status = 'quality_checking'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'job is not quality_checking';
  end if;
  if jsonb_typeof(p_candidates) <> 'array'
     or jsonb_array_length(p_candidates) < 1
     or jsonb_array_length(p_candidates) > v_job.candidate_count then
    raise exception using errcode = 'P0001', message = 'invalid candidate count';
  end if;

  v_prefix := v_job.salon_id::text || '/' || v_job.session_id::text || '/';
  for v_candidate in select value from jsonb_array_elements(p_candidates)
  loop
    if coalesce(v_candidate->>'storage_path', '') not like v_prefix || '%'
       or coalesce(v_candidate->>'mime', '') not in ('image/png', 'image/jpeg', 'image/webp')
       or coalesce(v_candidate#>>'{quality,status}', '') not in (
         'accepted','needs_stylist_review','regenerate','blocked_identity_changed',
         'blocked_non_hair_changed','blocked_low_realism','blocked_policy_or_safety'
       ) then
      raise exception using errcode = 'P0001', message = 'invalid worker candidate payload';
    end if;

    insert into public.generated_assets (
      salon_id, job_id, session_id, storage_path, mime, seed, variant_label,
      provider, model, expires_at
    ) values (
      v_job.salon_id, v_job.id, v_job.session_id, v_candidate->>'storage_path',
      v_candidate->>'mime', nullif(v_candidate->>'seed','')::bigint,
      coalesce(v_candidate->>'variant_label',''), coalesce(v_candidate->>'provider',''),
      coalesce(v_candidate->>'model',''), now() + interval '24 hours'
    ) returning id into v_asset_id;

    insert into public.quality_checks (
      salon_id, asset_id, status, hard_fail, signals, soft_flags, hard_reasons
    ) values (
      v_job.salon_id, v_asset_id,
      (v_candidate#>>'{quality,status}')::public.quality_status,
      coalesce((v_candidate#>>'{quality,hard_fail}')::boolean, true),
      coalesce(v_candidate#>'{quality,signals}', '{}'::jsonb),
      coalesce(v_candidate#>'{quality,soft_flags}', '[]'::jsonb),
      coalesce(v_candidate#>'{quality,hard_reasons}', '[]'::jsonb)
    );

    if v_candidate#>>'{quality,status}' = 'accepted'
       and coalesce((v_candidate#>>'{quality,hard_fail}')::boolean, true) = false then
      v_accepted := v_accepted + 1;
    elsif v_candidate#>>'{quality,status}' = 'needs_stylist_review'
       and coalesce((v_candidate#>>'{quality,hard_fail}')::boolean, true) = false then
      v_review := v_review + 1;
    end if;
  end loop;

  v_status := case
    when v_accepted > 0 then 'completed'::public.job_status
    when v_review > 0 then 'needs_stylist_review'::public.job_status
    when v_job.attempts < v_job.max_attempts then 'failed_retryable'::public.job_status
    else 'failed_hard'::public.job_status
  end;
  update public.generation_jobs
  set status = v_status,
      failure_reason = case when v_status in ('failed_retryable','failed_hard')
        then 'no candidate passed the quality gate' else null end
  where id = v_job.id;
  return v_status;
end;
$$;

create or replace function public.worker_fail_generation_job(
  p_job_id uuid,
  p_retryable boolean,
  p_reason text default 'generation failed'
)
returns public.job_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.job_status;
begin
  update public.generation_jobs
  set status = case when p_retryable and attempts < max_attempts
      then 'failed_retryable'::public.job_status else 'failed_hard'::public.job_status end,
      failure_reason = left(coalesce(nullif(btrim(p_reason), ''), 'generation failed'), 500)
  where id = p_job_id and status in ('masking','generating','quality_checking')
  returning status into v_status;
  if v_status is null then
    raise exception using errcode = 'P0001', message = 'job is not worker-owned';
  end if;
  return v_status;
end;
$$;

revoke all on function public.worker_claim_generation_job() from public, anon, authenticated;
revoke all on function public.worker_transition_generation_job(uuid, public.job_status, public.job_status) from public, anon, authenticated;
revoke all on function public.worker_finish_generation_job(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.worker_fail_generation_job(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.worker_claim_generation_job() to service_role;
grant execute on function public.worker_transition_generation_job(uuid, public.job_status, public.job_status) to service_role;
grant execute on function public.worker_finish_generation_job(uuid, jsonb) to service_role;
grant execute on function public.worker_fail_generation_job(uuid, boolean, text) to service_role;
