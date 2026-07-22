# Hair Twin — Supabase

Schema of record for the consultation database. **No remote project is linked
yet** (ADR-0005): nothing here has been applied to a hosted Supabase project.

## Layout

```
config.toml                 local stack config; api.schemas = ["public"] only
migrations/
  20260715120100_schema.sql   tables, composite tenant keys, consent trigger
  20260715120200_rls.sql      private helpers, grants, role-based policies
  20260715120300_storage.sql  private buckets (incl. masks) + object policies
seed.sql                    dev-only seed (global style presets)
tests/                      pgTAP tests (run by `supabase test db`)
local-verify/               offline pgTAP runner (PGlite) for Docker-less machines
```

## Design invariants

| Invariant | Enforced by |
| --- | --- |
| A row can never reference another salon's row | composite `(id, salon_id)` FKs — holds even for `service_role` |
| Only salon members read salon data | RLS + `private.is_salon_member()` |
| Destructive/admin actions need a role | `private.has_salon_role(salon_id, roles)` |
| Consent is immutable except revocation, never deleted | `private.enforce_consent_immutable()` trigger (not just policy) |
| Revocation is one-way | same trigger |
| Unsaved media always has an expiry | `*_unsaved_must_expire` check constraints |
| No public media URLs | every bucket `public = false` |
| Object access is tenant-scoped | `<salon_id>/...` path prefix + storage policies |
| RLS helpers are unreachable from the API | they live in `private`; `config.toml` exposes only `public` |

`anon` is granted nothing in `public`: unauthenticated access fails at the
privilege level, before RLS is even consulted.

## Running the tests

### With Docker (the real thing — preferred)

```bash
supabase start
supabase test db          # runs supabase/tests/*.test.sql via pg_prove
```

### Without Docker (offline runner)

`supabase start` needs Docker. Where that is unavailable, the same migrations
and the same test files run against [PGlite](https://pglite.dev) — a real
PostgreSQL build compiled to WASM — behind `local-verify/shim.sql`, which
provides what Supabase itself would (auth/storage schemas, the
anon/authenticated/service_role roles, `auth.uid()`).

```bash
cd supabase/local-verify
npm install
npm run pgtap:fetch       # vendor pgTAP's SQL (once)
npm test
```

**Limits of the offline runner:** it exercises Postgres only — not PostgREST,
GoTrue, or the Storage API. `shim.sql` is a hand-written approximation of the
Supabase environment; if it drifts, the tests stop being meaningful. Treat a
green offline run as necessary, not sufficient: re-run `supabase test db`
against the real stack before trusting the schema in a shared environment.

## Applying this schema

Not yet. A staging project must be chosen first — see
`docs/decisions/ADR-0005-supabase-environments.md`.
