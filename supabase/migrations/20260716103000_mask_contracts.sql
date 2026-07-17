-- Hair Twin — first-class mask contracts.
--
-- WHY THIS MIGRATION EXISTS
--
-- The app (apps/web/src/lib/services/masks.ts) treats a mask contract as an
-- entity: the server derives a full mask set from the real region map, persists
-- it, and a generation job binds to one contract BY ID. A retry derives a NEW
-- contract version (tighter expansion radius) from the same region map and
-- leaves the previous one intact for auditability.
--
-- The 20260715120100 schema could not represent that:
--
--   1. There was no mask_contracts table at all — only loose mask_assets and a
--      `mask_contract_version` string.
--   2. `mask_assets_unique_kind (source_image_id, kind, contract_version)` made
--      retry outright IMPOSSIBLE. Attempt 2 re-derives the same kinds, for the
--      same source, at the same contract version, so inserting its hair_edit
--      mask fails with 23505. Verified against Postgres before writing this.
--   3. generation_jobs had no mask_contract_id, so nothing pinned a job to the
--      exact masks it generated against; a version string cannot identify which
--      of three attempts was used.
--
-- The prior migration is left untouched (it is the applied-order record, even
-- though nothing has been applied remotely yet); everything here is additive or
-- an explicit ALTER so the change history is legible.
--
-- DATA SAFETY: mask_assets/generation_jobs have never been populated in any
-- environment (no project is linked — ADR-0005), so the NOT NULL columns below
-- are added directly. A local dev DB holding rows should `supabase db reset`
-- rather than be migrated; the migration will fail loudly instead of inventing
-- a contract for orphan rows, which is the correct outcome.
--
-- Still not applied to any remote project.

-- ---------------------------------------------------------------------------
-- mask_contracts — one row per derived mask set (one per generation attempt)
-- ---------------------------------------------------------------------------
create table public.mask_contracts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  session_id uuid not null,
  source_image_id uuid not null,
  -- Snapshot of the derivation contract (MASK_CONTRACT_VERSION in the app).
  version text not null default 'mask-contract-1'
    check (length(btrim(version)) > 0),
  -- Which generation attempt produced this version. Attempt 1 is the capture;
  -- 2..n are retries. Multiple attempts coexist for the same source.
  attempt int not null default 1 check (attempt >= 1),
  -- Plausible-growth ring in grid cells. Retries shrink this.
  expansion_radius int not null check (expansion_radius >= 0 and expansion_radius <= 64),
  -- Mask grid resolution. NOTE: this is the segmentation grid, NOT the source
  -- image resolution — see docs/decisions/ADR-0006.
  width int not null check (width > 0),
  height int not null check (height > 0),
  saved boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),

  -- Composite targets so children can pin salon/session/source in one FK.
  constraint mask_contracts_id_salon_key unique (id, salon_id),
  -- The 4-column key is what lets generation_jobs and mask_assets prove, at the
  -- DB level, that a contract belongs to exactly their salon+session+source.
  constraint mask_contracts_identity_key
    unique (id, salon_id, session_id, source_image_id),

  constraint mask_contracts_session_same_salon
    foreign key (session_id, salon_id)
    references public.consultation_sessions(id, salon_id) on delete cascade,
  constraint mask_contracts_source_same_salon
    foreign key (source_image_id, salon_id)
    references public.source_images(id, salon_id) on delete cascade,

  -- Retention: a contract nobody consented to save must carry an expiry.
  -- Masks describe the customer's hairline and face region.
  constraint mask_contracts_unsaved_must_expire
    check (saved or expires_at is not null),

  -- One contract per (source, attempt, version). Retries bump `attempt`, so
  -- attempts 1/2/3 coexist while a duplicate of the same attempt cannot.
  constraint mask_contracts_attempt_unique
    unique (source_image_id, attempt, version)
);

create index on public.mask_contracts (salon_id);
create index on public.mask_contracts (session_id);
create index on public.mask_contracts (source_image_id, attempt desc);
create index on public.mask_contracts (expires_at) where not saved;

-- ---------------------------------------------------------------------------
-- mask_assets — every mask (and the region map) belongs to exactly ONE contract
-- ---------------------------------------------------------------------------

-- Coverage stays NORMALISED onto the mask rows rather than duplicated as a jsonb
-- blob on the contract: each mask already knows its own ratio, and one number in
-- one place cannot drift from itself. The app's
-- MaskContractRecord.coverage (Record<MaskName, number>) is reassembled from
-- these rows — see supabase/tests/06 and the parity test in apps/web.
--
-- numeric(6,5) rounded the app's float64 ratios (a 48x64 grid yields values like
-- 0.147222222…, which numeric(6,5) truncates to 0.14722), so a contract could
-- not round-trip losslessly. Coverage is a derived ratio, not money: use the
-- same binary float the app computes in, and the value survives exactly.
alter table public.mask_assets
  alter column coverage type double precision;

alter table public.mask_assets
  add constraint mask_assets_coverage_ratio
  check (coverage is null or (coverage >= 0 and coverage <= 1));

-- `contract_version` was a second source of truth for something the contract
-- now owns. Drop it rather than let the two drift.
alter table public.mask_assets
  drop constraint mask_assets_unique_kind;

alter table public.mask_assets
  drop column contract_version;

alter table public.mask_assets
  add column mask_contract_id uuid not null;

-- Ownership + tenant integrity in one constraint: the referenced contract must
-- share this asset's salon AND session AND source image. A mask can therefore
-- never be attached to a contract from another tenant, session, or photo.
alter table public.mask_assets
  add constraint mask_assets_contract_identity
  foreign key (mask_contract_id, salon_id, session_id, source_image_id)
  references public.mask_contracts(id, salon_id, session_id, source_image_id)
  on delete cascade;

-- A contract holds at most one mask of each kind (including region_map).
-- Scoped to the CONTRACT, not the source image, which is what allows attempts
-- 1/2/3 to each hold their own hair_edit mask.
alter table public.mask_assets
  add constraint mask_assets_unique_kind_per_contract
  unique (mask_contract_id, kind);

create index on public.mask_assets (mask_contract_id);

-- ---------------------------------------------------------------------------
-- generation_jobs — bind to the exact contract, by id
-- ---------------------------------------------------------------------------
alter table public.generation_jobs
  add column mask_contract_id uuid not null;

-- The authoritative reference. The 4-column FK makes the app's runtime checks
-- (loadMaskContractForJob) redundant at the DB level: a job physically cannot
-- point at a contract from another salon, session, or source image.
alter table public.generation_jobs
  add constraint jobs_mask_contract_identity
  foreign key (mask_contract_id, salon_id, session_id, source_image_id)
  references public.mask_contracts(id, salon_id, session_id, source_image_id)
  on delete restrict;

create index on public.generation_jobs (mask_contract_id);

-- `mask_contract_version` stays, but only as an audit snapshot of what the
-- contract said when the job ran. It is NOT how the job identifies its masks —
-- mask_contract_id is. Keeping it lets an auditor read a job row without
-- joining, and lets us notice drift.
comment on column public.generation_jobs.mask_contract_version is
  'Audit snapshot of mask_contracts.version at job time. NOT an identifier: mask_contract_id is the authoritative reference to the masks used.';

comment on column public.mask_contracts.width is
  'Mask GRID resolution (segmentation output), not the source image resolution. Provider-ready masks must be resized to the source — see ADR-0006.';

-- ---------------------------------------------------------------------------
-- RLS — same model as every other salon-scoped table
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.mask_contracts to authenticated;
grant all on public.mask_contracts to service_role;

alter table public.mask_contracts enable row level security;

create policy mask_contracts_select_member on public.mask_contracts
  for select to authenticated using (private.is_salon_member(salon_id));
create policy mask_contracts_insert_member on public.mask_contracts
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy mask_contracts_update_member on public.mask_contracts
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
-- Erasure stays available to any member: deleting a customer's masks is a
-- privacy escape hatch, not an administrative privilege (same rule as photos).
create policy mask_contracts_delete_member on public.mask_contracts
  for delete to authenticated using (private.is_salon_member(salon_id));
