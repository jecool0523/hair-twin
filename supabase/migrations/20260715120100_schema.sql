-- Hair Twin — core schema.
--
-- Design rules encoded here:
--   * Every salon-scoped table carries `salon_id` denormalised, and references
--     its parent by a COMPOSITE key (id, salon_id). That makes a cross-tenant
--     row structurally impossible: you cannot attach salon A's job to salon B's
--     session, because the composite FK would not resolve. RLS then only has to
--     filter on the local `salon_id` column — no recursive joins.
--   * Consent rows are immutable except revocation (enforced by trigger, not
--     just policy).
--   * Media (source images, generated assets, masks, reports) live in PRIVATE
--     storage buckets; the DB only stores paths.
--
-- Not applied to any remote project — see docs/decisions/ADR-0005.

-- ---------------------------------------------------------------------------
-- private: helper functions used by RLS. Never exposed via PostgREST
-- (config.toml api.schemas = ["public"]).
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.salons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now(),
  -- Composite target so salon-scoped children can pin their org too.
  constraint salons_id_organization_key unique (id, organization_id)
);

-- Mirrors auth.users. A profile is a person who can log in.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create type public.membership_role as enum ('owner', 'admin', 'stylist');

create table public.salon_memberships (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.membership_role not null default 'stylist',
  created_at timestamptz not null default now(),
  unique (salon_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Customers (pseudonymous by default — a salon must not need a real name)
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  alias text not null default '익명 고객' check (length(btrim(alias)) > 0),
  external_ref text,
  created_at timestamptz not null default now(),
  constraint customers_id_salon_key unique (id, salon_id)
);

-- ---------------------------------------------------------------------------
-- Consent — immutable except revocation (see trigger below)
-- ---------------------------------------------------------------------------
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  customer_id uuid,
  capture_consented boolean not null,
  save_images_consented boolean not null default false,
  save_report_consented boolean not null default false,
  -- DRAFT wording pending Korean PIPA legal review; the version pins exactly
  -- which text the customer saw.
  wording_version text not null check (length(btrim(wording_version)) > 0),
  consented_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  -- Capture consent is the precondition for everything else.
  constraint consent_capture_required check (capture_consented),
  -- Revocation reason only makes sense alongside a revocation.
  constraint consent_revoked_reason_needs_revoked_at
    check (revoked_reason is null or revoked_at is not null),
  constraint consent_id_salon_key unique (id, salon_id),
  -- Composite FK: a consent row can only point at a customer in the SAME salon.
  constraint consent_customer_same_salon
    foreign key (customer_id, salon_id)
    references public.customers(id, salon_id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Consultation sessions
-- ---------------------------------------------------------------------------
create type public.session_stage as enum (
  'consent','capture','quality','style','generating','review','saved','discarded'
);

create table public.consultation_sessions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  stylist_id uuid references public.profiles(id) on delete set null,
  customer_id uuid,
  customer_alias text not null default '익명 고객',
  stage public.session_stage not null default 'consent',
  consent_id uuid,
  selected_style_id text,
  -- Unsaved consultations expire (retention). NULL == retained after save.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_id_salon_key unique (id, salon_id),
  constraint sessions_customer_same_salon
    foreign key (customer_id, salon_id)
    references public.customers(id, salon_id) on delete set null,
  constraint sessions_consent_same_salon
    foreign key (consent_id, salon_id)
    references public.consent_records(id, salon_id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Source images (bytes live in the private bucket; DB holds the path)
-- ---------------------------------------------------------------------------
create table public.source_images (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  session_id uuid not null,
  storage_path text not null unique,
  mime text not null check (mime in ('image/png','image/jpeg','image/webp')),
  width int not null check (width > 0),
  height int not null check (height > 0),
  saved boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint source_images_id_salon_key unique (id, salon_id),
  constraint source_images_session_same_salon
    foreign key (session_id, salon_id)
    references public.consultation_sessions(id, salon_id) on delete cascade,
  -- Retention invariant: anything not explicitly saved MUST carry an expiry.
  constraint source_images_unsaved_must_expire
    check (saved or expires_at is not null)
);

-- ---------------------------------------------------------------------------
-- Mask assets (ai-generation-design §6). One row per mask per source image.
-- ---------------------------------------------------------------------------
create type public.mask_kind as enum (
  'region_map',
  'hair_current',
  'hair_expansion',
  'face_protect',
  'body_clothing_protect',
  'background_protect',
  'uncertain_boundary',
  'hair_edit'
);

create table public.mask_assets (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  session_id uuid not null,
  source_image_id uuid not null,
  kind public.mask_kind not null,
  storage_path text not null unique,
  contract_version text not null default 'mask-contract-1',
  -- Coverage ratio of this mask (0..1), used by QC + debugging.
  coverage numeric(6,5) check (coverage is null or (coverage >= 0 and coverage <= 1)),
  width int not null check (width > 0),
  height int not null check (height > 0),
  saved boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mask_assets_id_salon_key unique (id, salon_id),
  constraint mask_assets_session_same_salon
    foreign key (session_id, salon_id)
    references public.consultation_sessions(id, salon_id) on delete cascade,
  constraint mask_assets_source_same_salon
    foreign key (source_image_id, salon_id)
    references public.source_images(id, salon_id) on delete cascade,
  -- A source image has at most one mask of each kind per contract version.
  constraint mask_assets_unique_kind
    unique (source_image_id, kind, contract_version),
  constraint mask_assets_unsaved_must_expire
    check (saved or expires_at is not null)
);

-- ---------------------------------------------------------------------------
-- Style presets. salon_id NULL == global preset shipped with the product.
-- ---------------------------------------------------------------------------
create table public.style_presets (
  id text primary key check (length(btrim(id)) > 0),
  display_name_ko text not null,
  category text not null check (category in ('cut','perm','color')),
  attributes jsonb not null default '{}'::jsonb,
  salon_id uuid references public.salons(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Generation jobs + assets + quality
-- ---------------------------------------------------------------------------
create type public.job_status as enum (
  'created','preflight_failed','queued','masking','generating',
  'quality_checking','needs_stylist_review','completed',
  'failed_retryable','failed_hard','expired','deleted'
);

create type public.generation_mode as enum (
  'hair_inpaint','color_transfer','reference_style','turnaround_reference'
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  session_id uuid not null,
  source_image_id uuid not null,
  style_id text not null references public.style_presets(id) on delete restrict,
  mode public.generation_mode not null default 'hair_inpaint',
  status public.job_status not null default 'created',
  candidate_count int not null default 3 check (candidate_count between 1 and 4),
  attempts int not null default 1 check (attempts >= 1),
  max_attempts int not null default 3 check (max_attempts >= 1),
  provider text not null default 'mock',
  model text not null default '',
  mask_contract_version text not null default 'mask-contract-1',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_attempts_within_max check (attempts <= max_attempts),
  constraint jobs_id_salon_key unique (id, salon_id),
  constraint jobs_session_same_salon
    foreign key (session_id, salon_id)
    references public.consultation_sessions(id, salon_id) on delete cascade,
  constraint jobs_source_same_salon
    foreign key (source_image_id, salon_id)
    references public.source_images(id, salon_id) on delete cascade
);

create type public.stylist_verdict as enum (
  'usable','needs_manual_review','regenerate'
);

create table public.generated_assets (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  job_id uuid not null,
  session_id uuid not null,
  storage_path text not null unique,
  mime text not null default 'image/png',
  seed bigint,
  variant_label text not null default '',
  provider text not null,
  model text not null,
  -- NOTE: customer exposure is NOT stored (ADR-0004). It is derived at read
  -- time from quality status + hard_fail + stylist_verdict.
  stylist_verdict public.stylist_verdict,
  saved boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint generated_assets_id_salon_key unique (id, salon_id),
  constraint generated_assets_job_same_salon
    foreign key (job_id, salon_id)
    references public.generation_jobs(id, salon_id) on delete cascade,
  constraint generated_assets_session_same_salon
    foreign key (session_id, salon_id)
    references public.consultation_sessions(id, salon_id) on delete cascade,
  constraint generated_assets_unsaved_must_expire
    check (saved or expires_at is not null)
);

create type public.quality_status as enum (
  'accepted','needs_stylist_review','regenerate',
  'blocked_identity_changed','blocked_non_hair_changed',
  'blocked_low_realism','blocked_policy_or_safety'
);

create table public.quality_checks (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  asset_id uuid not null,
  status public.quality_status not null,
  hard_fail boolean not null default false,
  signals jsonb not null default '{}'::jsonb,
  soft_flags jsonb not null default '[]'::jsonb,
  hard_reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now(),
  constraint quality_checks_asset_same_salon
    foreign key (asset_id, salon_id)
    references public.generated_assets(id, salon_id) on delete cascade,
  -- One verdict per asset.
  constraint quality_checks_asset_unique unique (asset_id)
);

create table public.consultation_notes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  session_id uuid not null,
  memo text not null default '',
  feasibility text not null default '' check (feasibility in ('','easy','moderate','hard')),
  estimated_price text not null default '',
  estimated_time text not null default '',
  care_notes text not null default '',
  updated_at timestamptz not null default now(),
  constraint notes_session_unique unique (session_id),
  constraint notes_session_same_salon
    foreign key (session_id, salon_id)
    references public.consultation_sessions(id, salon_id) on delete cascade
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  session_id uuid not null,
  storage_path text unique,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint reports_session_same_salon
    foreign key (session_id, salon_id)
    references public.consultation_sessions(id, salon_id) on delete cascade
);

-- Append-only audit log.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  session_id uuid,
  action text not null check (length(btrim(action)) > 0),
  actor_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_session_same_salon
    foreign key (session_id, salon_id)
    references public.consultation_sessions(id, salon_id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Indexes (FK columns + retention sweeps)
-- ---------------------------------------------------------------------------
create index on public.salons (organization_id);
create index on public.salon_memberships (profile_id);
create index on public.salon_memberships (salon_id);
create index on public.customers (salon_id);
create index on public.consent_records (salon_id);
create index on public.consultation_sessions (salon_id, updated_at desc);
create index on public.source_images (session_id);
create index on public.mask_assets (source_image_id);
create index on public.mask_assets (session_id);
create index on public.generation_jobs (session_id);
create index on public.generation_jobs (salon_id, status);
create index on public.generated_assets (job_id);
create index on public.generated_assets (session_id);
create index on public.quality_checks (asset_id);
create index on public.audit_events (salon_id, created_at desc);
create index on public.audit_events (session_id);
-- Retention sweeps look for unsaved, expired media.
create index on public.source_images (expires_at) where not saved;
create index on public.mask_assets (expires_at) where not saved;
create index on public.generated_assets (expires_at) where not saved;

-- ---------------------------------------------------------------------------
-- Consent immutability (system-design §5: immutable except revocation)
-- ---------------------------------------------------------------------------
create or replace function private.enforce_consent_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'consent_records are immutable and cannot be deleted (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;

  -- Only revocation metadata may change.
  if new.id is distinct from old.id
     or new.salon_id is distinct from old.salon_id
     or new.customer_id is distinct from old.customer_id
     or new.capture_consented is distinct from old.capture_consented
     or new.save_images_consented is distinct from old.save_images_consented
     or new.save_report_consented is distinct from old.save_report_consented
     or new.wording_version is distinct from old.wording_version
     or new.consented_at is distinct from old.consented_at
  then
    raise exception 'consent_records are immutable except revocation (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;

  -- Revocation is one-way: NULL -> timestamp. It cannot be undone or rewritten.
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'consent revocation cannot be changed once set (id=%)', old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger consent_records_immutable
  before update or delete on public.consent_records
  for each row execute function private.enforce_consent_immutable();

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger consultation_sessions_touch
  before update on public.consultation_sessions
  for each row execute function private.touch_updated_at();

create trigger generation_jobs_touch
  before update on public.generation_jobs
  for each row execute function private.touch_updated_at();
