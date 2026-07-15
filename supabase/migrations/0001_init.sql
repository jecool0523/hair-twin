-- Hair Twin — initial schema (schema of record).
--
-- This migration is the authoritative data model (system-design §5). It is NOT
-- yet applied to any live project — no Supabase project has been chosen
-- (ADR-0003). The running app uses the in-memory store behind the same domain
-- contracts. Apply this once a project + environment split is decided.
--
-- Security posture (system-design §9, handoff §6):
--   * RLS enabled on every exposed table.
--   * Images/reports live in PRIVATE storage buckets, served via short-lived
--     signed URLs. No public URLs.
--   * service_role is used only by trusted server/worker code.
--   * Customers are pseudonymous by default.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table salons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Mirrors auth.users; stylist/owner/admin accounts.
create table profiles (
  id uuid primary key,                         -- = auth.users.id
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create type membership_role as enum ('owner', 'admin', 'stylist');

create table salon_memberships (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'stylist',
  created_at timestamptz not null default now(),
  unique (salon_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- Customers (pseudonymous by default)
-- ---------------------------------------------------------------------------
create table customers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  alias text not null default '익명 고객',       -- no real name required
  external_ref text,                            -- optional salon CRM key
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Consent (immutable except revocation)
-- ---------------------------------------------------------------------------
create table consent_records (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  capture_consented boolean not null,
  save_images_consented boolean not null default false,
  save_report_consented boolean not null default false,
  wording_version text not null,               -- DRAFT until legal review
  consented_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Consultation sessions + media
-- ---------------------------------------------------------------------------
create type session_stage as enum (
  'consent','capture','quality','style','generating','review','saved','discarded'
);

create table consultation_sessions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references salons(id) on delete cascade,
  stylist_id uuid references profiles(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  customer_alias text not null default '익명 고객',
  stage session_stage not null default 'consent',
  consent_id uuid references consent_records(id) on delete set null,
  selected_style_id text,
  expires_at timestamptz,                       -- set when unsaved
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table source_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references consultation_sessions(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  storage_path text not null,                   -- private bucket key
  mime text not null,
  width int not null,
  height int not null,
  saved boolean not null default false,         -- false => temporary
  expires_at timestamptz,                        -- retention (design §12)
  created_at timestamptz not null default now()
);

-- Style presets (may be salon-customizable later; global defaults seeded).
create table style_presets (
  id text primary key,
  display_name_ko text not null,
  category text not null,
  attributes jsonb not null default '{}'::jsonb, -- normalized style schema
  salon_id uuid references salons(id) on delete cascade,  -- null => global
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Generation jobs + assets + quality
-- ---------------------------------------------------------------------------
create type job_status as enum (
  'created','preflight_failed','queued','masking','generating',
  'quality_checking','needs_stylist_review','completed',
  'failed_retryable','failed_hard','expired','deleted'
);

create table generation_jobs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references consultation_sessions(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  source_image_id uuid not null references source_images(id) on delete cascade,
  style_id text not null,
  mode text not null default 'hair_inpaint',
  status job_status not null default 'created',
  candidate_count int not null default 3,
  attempts int not null default 1,
  max_attempts int not null default 3,
  provider text not null default 'mock',
  model text not null default '',
  mask_contract_version text not null default 'mask-contract-1',
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table generated_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references generation_jobs(id) on delete cascade,
  session_id uuid not null references consultation_sessions(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  storage_path text not null,                   -- private bucket key
  mime text not null default 'image/png',
  seed bigint,
  variant_label text not null default '',
  provider text not null,
  model text not null,
  stylist_verdict text,                          -- usable/needs_manual_review/regenerate
  saved boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table quality_checks (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references generated_assets(id) on delete cascade,
  status text not null,                          -- QualityStatus
  hard_fail boolean not null default false,
  customer_visible boolean not null default false,
  signals jsonb not null default '{}'::jsonb,
  soft_flags jsonb not null default '[]'::jsonb,
  hard_reasons jsonb not null default '[]'::jsonb,
  evaluated_at timestamptz not null default now()
);

create table consultation_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references consultation_sessions(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  memo text not null default '',
  feasibility text not null default '',
  estimated_price text not null default '',
  estimated_time text not null default '',
  care_notes text not null default '',
  updated_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references consultation_sessions(id) on delete cascade,
  salon_id uuid not null references salons(id) on delete cascade,
  storage_path text,                             -- private bucket key
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Append-only audit log (system-design §5, §9).
create table audit_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references consultation_sessions(id) on delete set null,
  salon_id uuid references salons(id) on delete set null,
  action text not null,
  actor_id text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Indexes
create index on salon_memberships (profile_id);
create index on consultation_sessions (salon_id);
create index on generation_jobs (session_id);
create index on generated_assets (job_id);
create index on audit_events (session_id);
create index on source_images (expires_at) where saved = false;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Helper: salons the current user is a member of.
create or replace function current_user_salon_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select salon_id from salon_memberships where profile_id = auth.uid();
$$;

alter table organizations        enable row level security;
alter table salons               enable row level security;
alter table profiles             enable row level security;
alter table salon_memberships    enable row level security;
alter table customers            enable row level security;
alter table consent_records      enable row level security;
alter table consultation_sessions enable row level security;
alter table source_images        enable row level security;
alter table style_presets        enable row level security;
alter table generation_jobs      enable row level security;
alter table generated_assets     enable row level security;
alter table quality_checks       enable row level security;
alter table consultation_notes   enable row level security;
alter table reports              enable row level security;
alter table audit_events         enable row level security;

-- Profiles: a user can read/update only their own profile row.
create policy profiles_self on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Membership: a user can see memberships for salons they belong to.
create policy memberships_read on salon_memberships
  for select using (salon_id in (select current_user_salon_ids()));

-- Salon-scoped tables: staff may read/write rows for their own salon only.
-- (Customers have no direct DB access in the MVP — no customer portal yet.)
create policy salons_member_read on salons
  for select using (id in (select current_user_salon_ids()));

create policy customers_salon on customers
  for all using (salon_id in (select current_user_salon_ids()))
  with check (salon_id in (select current_user_salon_ids()));

create policy consent_salon on consent_records
  for all using (salon_id in (select current_user_salon_ids()))
  with check (salon_id in (select current_user_salon_ids()));

create policy sessions_salon on consultation_sessions
  for all using (salon_id in (select current_user_salon_ids()))
  with check (salon_id in (select current_user_salon_ids()));

create policy source_images_salon on source_images
  for all using (salon_id in (select current_user_salon_ids()))
  with check (salon_id in (select current_user_salon_ids()));

create policy jobs_salon on generation_jobs
  for all using (salon_id in (select current_user_salon_ids()))
  with check (salon_id in (select current_user_salon_ids()));

create policy assets_salon on generated_assets
  for all using (salon_id in (select current_user_salon_ids()))
  with check (salon_id in (select current_user_salon_ids()));

create policy notes_salon on consultation_notes
  for all using (salon_id in (select current_user_salon_ids()))
  with check (salon_id in (select current_user_salon_ids()));

create policy reports_salon on reports
  for all using (salon_id in (select current_user_salon_ids()))
  with check (salon_id in (select current_user_salon_ids()));

create policy audit_salon_read on audit_events
  for select using (salon_id in (select current_user_salon_ids()));

-- quality_checks inherit access via their asset's salon.
create policy quality_salon on quality_checks
  for select using (
    asset_id in (
      select id from generated_assets
      where salon_id in (select current_user_salon_ids())
    )
  );

-- Style presets: global presets readable by all; salon presets scoped.
create policy presets_read on style_presets
  for select using (salon_id is null or salon_id in (select current_user_salon_ids()));

-- NOTE: service_role bypasses RLS by design; the server/worker use it. Client
-- code must use the anon key + authenticated user context only.
