# ADR-0005: Supabase Schema Structure and Environment Selection

Date: 2026-07-15

## Status

Schema: accepted and verified locally.
Environment selection: **BLOCKED — needs a product/infra decision.**

## Context

ADR-0003 deferred Supabase entirely: the app runs on an in-memory store behind
`HairTwinStore`, and `supabase/migrations` held a first-draft schema that had
never been executed. Before any real project can be provisioned, the schema has
to be (a) actually applicable and (b) proven to enforce the privacy invariants
the product claims.

Two constraints shaped this work:

- No Supabase project has been chosen (handoff §12), and connecting an arbitrary
  one is explicitly forbidden.
- This machine has no Docker/Podman/WSL, so `supabase start` cannot run.

## Decision — schema

1. **CLI-applicable structure.** Migrations use the CLI's timestamp convention
   (`<14-digit>_name.sql`) and a `config.toml` exists, so `supabase db reset` /
   `db push` / `test db` work unchanged once a project exists. `api.schemas` is
   restricted to `public`.

2. **Composite tenant constraints.** Every salon-scoped table carries `salon_id`
   and references its parent by `(id, salon_id)`. A cross-tenant row is a
   foreign-key violation rather than a policy miss, so the guarantee holds even
   for `service_role` and superuser — i.e. for the server and the AI worker,
   which bypass RLS. RLS then only filters on the local `salon_id` column: one
   index-friendly predicate, no recursive joins.

3. **Private RLS helpers.** `private.user_salon_ids()`,
   `private.is_salon_member()`, `private.has_salon_role()` are `SECURITY
   DEFINER` with `search_path = ''`, living in a schema PostgREST does not
   expose. SECURITY DEFINER also stops the membership policy recursing into
   itself.

4. **Role-based policies.** stylist < admin < owner. Stylists run consultations;
   admins manage staff/presets and delete records; owners administer the salon.
   Deleting a customer photo stays available to *any* member — erasure is a
   privacy escape hatch, not a privilege.

5. **Consent immutability via trigger, not policy.** A policy only binds the
   roles it targets; a trigger binds everyone. Consent columns cannot be
   rewritten, consent cannot be deleted, and revocation is one-way — even with
   the service-role key. `anon` holds no privileges in `public` at all.

6. **Mask storage.** `mask_assets` (kind, contract version, coverage, expiry)
   plus a private `masks-private` bucket. Masks describe the customer's hairline
   and face region, so they are treated as sensitive as the source photo.

7. **Objects are tenant-scoped by path.** `<salon_id>/<session_id>/<file>`, with
   storage policies applying the same membership check. All buckets are private.

## Decision — verification

pgTAP tests live in `supabase/tests/` and run under `supabase test db`. Because
Docker is unavailable here, they were executed against **PGlite (real PostgreSQL
18.3 compiled to WASM)** behind `supabase/local-verify/shim.sql`, which supplies
the Supabase-provided environment (auth/storage schemas, stock roles,
`auth.uid()`).

Result: **53/53 assertions green** across tenant isolation, role policies,
consent immutability, composite integrity, storage policies, and an RLS-coverage
guard.

The suite was **mutation-tested** — the schema was deliberately broken 9 ways
(RLS disabled, consent trigger dropped, each composite FK dropped, retention
check dropped, storage policy dropped, masks bucket made public, `anon` granted
access, delete policy weakened). All 9 were detected. One coverage gap was found
and closed this way: dropping `jobs_session_same_salon` originally went
unnoticed because no test pinned the session/salon pairing.

## Consequences

Positive:

- The schema is applicable as-is once a project exists.
- Tenant isolation survives service-role code paths, not just client queries.
- Privacy invariants (consent, retention, private media) are enforced by the
  database, so an application bug cannot quietly violate them.
- The test suite is proven to fail when the protections are removed.

Tradeoffs / limits:

- The offline runner exercises Postgres only — **not** PostgREST, GoTrue, or the
  Storage API. `shim.sql` is a hand-written approximation of Supabase; drift
  makes the tests less meaningful. `supabase test db` on the real stack remains
  required before trusting this in a shared environment.
- Denormalised `salon_id` is redundant by design; the composite FKs are what
  keep it honest.
- `major_version = 15` in config.toml matches Supabase's default; the offline
  runner is on 18.3. The tests use no version-specific behaviour, but this is a
  known difference.

## BLOCKED: decisions required before applying this anywhere

1. **Which Supabase project(s)?** Staging is needed now; production later.
   Nothing may be applied until this is chosen — the schema has never touched a
   hosted project.
2. **Environment separation:** separate projects per environment (simplest,
   strongest isolation) vs. one project with branching. Affects CI and cost.
3. **Data residency.** Customer face images plus Korean PIPA: does the project
   need to be in an approved region (e.g. `ap-northeast-2`)? This is hard to
   change later and should be settled before staging is created.
4. **Who provisions and holds the keys.** `service_role` must reach only the
   server and the AI worker. Key custody and rotation need an owner.
5. **CI runner with Docker**, so `supabase test db` runs on the real stack per
   PR rather than only via the offline runner.

Until (1)-(3) are answered, the app keeps running on the in-memory store
(ADR-0003) and this schema stays unapplied.
