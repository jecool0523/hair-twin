-- Hair Twin — RLS helpers, grants, and role-based policies.
--
-- Model:
--   * Helpers live in `private` (SECURITY DEFINER, locked search_path, not
--     exposed via PostgREST). They read membership without recursing into RLS.
--   * Every salon-scoped table filters on its OWN `salon_id` column. The
--     composite FKs in the schema migration guarantee that column agrees with
--     the parent row, so this single predicate is sufficient AND tamper-proof.
--   * Roles: stylist < admin < owner.
--       stylist — runs consultations for their salon
--       admin   — stylist + manage staff/presets/customers, delete records
--       owner   — admin + manage the salon/org itself
--   * Customers have no database access (no customer portal in the MVP).
--   * service_role bypasses RLS by design and is used only by trusted
--     server/worker code.

-- ---------------------------------------------------------------------------
-- Helpers (private schema)
-- ---------------------------------------------------------------------------

-- Salons the current user belongs to. SECURITY DEFINER so it can read
-- salon_memberships without the membership policy recursing back into itself.
create or replace function private.user_salon_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.salon_id
  from public.salon_memberships m
  where m.profile_id = (select auth.uid());
$$;

-- Is the current user a member of this salon (any role)?
create or replace function private.is_salon_member(p_salon_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.salon_memberships m
    where m.salon_id = p_salon_id
      and m.profile_id = (select auth.uid())
  );
$$;

-- Does the current user hold any of these roles in this salon?
create or replace function private.has_salon_role(
  p_salon_id uuid,
  p_roles public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.salon_memberships m
    where m.salon_id = p_salon_id
      and m.profile_id = (select auth.uid())
      and m.role = any(p_roles)
  );
$$;

-- Organizations the current user owns (via an owner membership in any of its
-- salons). Used to scope org/salon administration.
create or replace function private.user_owned_organization_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct s.organization_id
  from public.salon_memberships m
  join public.salons s on s.id = m.salon_id
  where m.profile_id = (select auth.uid())
    and m.role = 'owner';
$$;

-- Policies are evaluated as the querying role, so it needs EXECUTE. The schema
-- is still unreachable over the API (config.toml api.schemas = ["public"]).
grant execute on function private.user_salon_ids() to authenticated;
grant execute on function private.is_salon_member(uuid) to authenticated;
grant execute on function private.has_salon_role(uuid, public.membership_role[]) to authenticated;
grant execute on function private.user_owned_organization_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Grants. RLS decides *which rows*; grants decide *which verbs*.
-- anon gets nothing: there is no public surface on customer data.
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on
  public.customers,
  public.consultation_sessions,
  public.source_images,
  public.mask_assets,
  public.generation_jobs,
  public.generated_assets,
  public.quality_checks,
  public.consultation_notes,
  public.reports
to authenticated;

-- Consent is insert + revoke-only; never deletable (trigger also enforces).
grant select, insert, update on public.consent_records to authenticated;
-- Audit is append-only from the client's perspective.
grant select, insert on public.audit_events to authenticated;
grant select, insert, update, delete on public.salon_memberships to authenticated;
grant select, insert, update, delete on public.style_presets to authenticated;
grant select, update on public.salons to authenticated;
grant select on public.organizations to authenticated;
grant select, insert, update on public.profiles to authenticated;

grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS on every exposed table (system-design §5).
-- ---------------------------------------------------------------------------
alter table public.organizations         enable row level security;
alter table public.salons                enable row level security;
alter table public.profiles              enable row level security;
alter table public.salon_memberships     enable row level security;
alter table public.customers             enable row level security;
alter table public.consent_records       enable row level security;
alter table public.consultation_sessions enable row level security;
alter table public.source_images         enable row level security;
alter table public.mask_assets           enable row level security;
alter table public.style_presets         enable row level security;
alter table public.generation_jobs       enable row level security;
alter table public.generated_assets      enable row level security;
alter table public.quality_checks        enable row level security;
alter table public.consultation_notes    enable row level security;
alter table public.reports               enable row level security;
alter table public.audit_events          enable row level security;

-- ---------------------------------------------------------------------------
-- Profiles: you can only see/edit yourself.
-- ---------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Organizations / salons
-- ---------------------------------------------------------------------------
create policy organizations_select_member on public.organizations
  for select to authenticated
  using (
    id in (select s.organization_id
           from public.salons s
           where s.id in (select private.user_salon_ids()))
  );

create policy salons_select_member on public.salons
  for select to authenticated
  using (id in (select private.user_salon_ids()));

-- Only an owner may rename/reconfigure the salon.
create policy salons_update_owner on public.salons
  for update to authenticated
  using (private.has_salon_role(id, array['owner']::public.membership_role[]))
  with check (private.has_salon_role(id, array['owner']::public.membership_role[]));

-- ---------------------------------------------------------------------------
-- Memberships: members can see the roster; owner/admin manage it.
-- ---------------------------------------------------------------------------
create policy memberships_select_member on public.salon_memberships
  for select to authenticated
  using (salon_id in (select private.user_salon_ids()));

create policy memberships_insert_admin on public.salon_memberships
  for insert to authenticated
  with check (private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]));

create policy memberships_update_admin on public.salon_memberships
  for update to authenticated
  using (private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]))
  with check (private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]));

create policy memberships_delete_owner on public.salon_memberships
  for delete to authenticated
  using (private.has_salon_role(salon_id, array['owner']::public.membership_role[]));

-- ---------------------------------------------------------------------------
-- Salon-scoped consultation data.
-- Read/write for any member; deletion is an admin/owner action.
-- ---------------------------------------------------------------------------
create policy customers_select_member on public.customers
  for select to authenticated using (private.is_salon_member(salon_id));
create policy customers_insert_member on public.customers
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy customers_update_member on public.customers
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
create policy customers_delete_admin on public.customers
  for delete to authenticated
  using (private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]));

create policy sessions_select_member on public.consultation_sessions
  for select to authenticated using (private.is_salon_member(salon_id));
create policy sessions_insert_member on public.consultation_sessions
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy sessions_update_member on public.consultation_sessions
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
create policy sessions_delete_admin on public.consultation_sessions
  for delete to authenticated
  using (private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]));

create policy source_images_select_member on public.source_images
  for select to authenticated using (private.is_salon_member(salon_id));
create policy source_images_insert_member on public.source_images
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy source_images_update_member on public.source_images
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
-- Deleting a customer's photo must always be possible for any member: it is the
-- privacy escape hatch, not an administrative privilege.
create policy source_images_delete_member on public.source_images
  for delete to authenticated using (private.is_salon_member(salon_id));

create policy mask_assets_select_member on public.mask_assets
  for select to authenticated using (private.is_salon_member(salon_id));
create policy mask_assets_insert_member on public.mask_assets
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy mask_assets_update_member on public.mask_assets
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
create policy mask_assets_delete_member on public.mask_assets
  for delete to authenticated using (private.is_salon_member(salon_id));

create policy jobs_select_member on public.generation_jobs
  for select to authenticated using (private.is_salon_member(salon_id));
create policy jobs_insert_member on public.generation_jobs
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy jobs_update_member on public.generation_jobs
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
create policy jobs_delete_admin on public.generation_jobs
  for delete to authenticated
  using (private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]));

create policy assets_select_member on public.generated_assets
  for select to authenticated using (private.is_salon_member(salon_id));
create policy assets_insert_member on public.generated_assets
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy assets_update_member on public.generated_assets
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
create policy assets_delete_member on public.generated_assets
  for delete to authenticated using (private.is_salon_member(salon_id));

-- Quality verdicts are produced by the worker (service_role). Members read
-- them; nobody edits a QC result by hand.
create policy quality_select_member on public.quality_checks
  for select to authenticated using (private.is_salon_member(salon_id));

create policy notes_select_member on public.consultation_notes
  for select to authenticated using (private.is_salon_member(salon_id));
create policy notes_insert_member on public.consultation_notes
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy notes_update_member on public.consultation_notes
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
create policy notes_delete_admin on public.consultation_notes
  for delete to authenticated
  using (private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]));

create policy reports_select_member on public.reports
  for select to authenticated using (private.is_salon_member(salon_id));
create policy reports_insert_member on public.reports
  for insert to authenticated with check (private.is_salon_member(salon_id));
create policy reports_update_member on public.reports
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));
create policy reports_delete_admin on public.reports
  for delete to authenticated
  using (private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[]));

-- ---------------------------------------------------------------------------
-- Consent: insert by members; revoke-only update; never delete.
-- The trigger enforces column-level immutability regardless of policy.
-- ---------------------------------------------------------------------------
create policy consent_select_member on public.consent_records
  for select to authenticated using (private.is_salon_member(salon_id));

create policy consent_insert_member on public.consent_records
  for insert to authenticated with check (private.is_salon_member(salon_id));

-- Update exists only so a customer's revocation can be recorded.
create policy consent_revoke_member on public.consent_records
  for update to authenticated
  using (private.is_salon_member(salon_id))
  with check (private.is_salon_member(salon_id));

-- Intentionally NO delete policy, and no DELETE grant: consent history stands.

-- ---------------------------------------------------------------------------
-- Audit: append-only. Members can write and read their salon's trail;
-- nothing can rewrite or erase it (no update/delete policy or grant).
-- ---------------------------------------------------------------------------
create policy audit_select_member on public.audit_events
  for select to authenticated using (private.is_salon_member(salon_id));

create policy audit_insert_member on public.audit_events
  for insert to authenticated with check (private.is_salon_member(salon_id));

-- ---------------------------------------------------------------------------
-- Style presets: global presets are readable by everyone signed in; salon
-- presets are scoped and managed by owner/admin.
-- ---------------------------------------------------------------------------
create policy presets_select on public.style_presets
  for select to authenticated
  using (salon_id is null or private.is_salon_member(salon_id));

create policy presets_insert_admin on public.style_presets
  for insert to authenticated
  with check (
    salon_id is not null
    and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[])
  );

create policy presets_update_admin on public.style_presets
  for update to authenticated
  using (
    salon_id is not null
    and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[])
  )
  with check (
    salon_id is not null
    and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[])
  );

create policy presets_delete_admin on public.style_presets
  for delete to authenticated
  using (
    salon_id is not null
    and private.has_salon_role(salon_id, array['owner','admin']::public.membership_role[])
  );
