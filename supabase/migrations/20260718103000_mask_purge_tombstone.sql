-- Hair Twin — resolve the conflict between job auditability and mask retention.
--
-- THE CONFLICT: generation_jobs references mask_contracts with ON DELETE
-- RESTRICT (a job's record of WHICH masks it used must not vanish), while
-- retention demands the masks themselves be destroyed on expiry. As written,
-- the retention sweep could never delete a contract referenced by a job: the
-- privacy promise and the audit promise were pointed at each other.
--
-- RESOLUTION — tombstone. On expiry of a job-referenced contract the sweep:
--
--   * deletes the mask_assets rows and their private storage bytes
--     (the sensitive material: the customer's hairline/face geometry)
--   * KEEPS the mask_contracts row, with purged_at set — a minimal tombstone
--     holding only ids, dimensions, attempt and coverage numbers, so the job
--     can still prove which contract it generated against
--
-- Contracts referenced by no job are deleted outright, as before.
-- After purge, retry and mask loading must fail CLEARLY, never silently
-- regenerate against missing masks — enforced below and in the app.

alter table public.mask_contracts
  add column purged_at timestamptz;

comment on column public.mask_contracts.purged_at is
  'Set when retention destroyed this contract''s mask bytes. The row survives as a tombstone only because a generation job references it. One-way.';

-- ---------------------------------------------------------------------------
-- purged_at is one-way: it can be set once, never cleared or moved.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_purge_one_way()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.purged_at is not null
     and new.purged_at is distinct from old.purged_at then
    raise exception 'a purge cannot be undone or moved (contract %)', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger mask_contracts_purge_one_way
  before update on public.mask_contracts
  for each row execute function private.enforce_purge_one_way();

-- ---------------------------------------------------------------------------
-- A purged contract is a tombstone, not a live contract: no new masks may be
-- attached to it, and no job may newly bind to it. Triggers, so the service
-- key and the worker are bound too.
-- ---------------------------------------------------------------------------
create or replace function private.reject_masks_on_purged_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.mask_contracts c
    where c.id = new.mask_contract_id and c.purged_at is not null
  ) then
    raise exception
      'mask contract % has been purged by retention; its masks no longer exist',
      new.mask_contract_id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger mask_assets_reject_purged_contract
  before insert on public.mask_assets
  for each row execute function private.reject_masks_on_purged_contract();

create or replace function private.reject_jobs_on_purged_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only when the reference is being established or changed; an existing job
  -- row updating its status must keep working after its contract is purged.
  if tg_op = 'UPDATE'
     and new.mask_contract_id is not distinct from old.mask_contract_id then
    return new;
  end if;
  if exists (
    select 1 from public.mask_contracts c
    where c.id = new.mask_contract_id and c.purged_at is not null
  ) then
    raise exception
      'mask contract % has been purged by retention; a job cannot generate against it',
      new.mask_contract_id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger generation_jobs_reject_purged_contract
  before insert or update on public.generation_jobs
  for each row execute function private.reject_jobs_on_purged_contract();
