# Hair Twin

Hair Twin is a **B2B, salon-only** AI hair-consultation product. A stylist
captures a customer's photo, generates candidate hairstyles, and reviews them
before anything reaches the customer. There is no consumer surface: the only
users are salon staff, invited by a salon owner or admin.

This repository is a monorepo. The canonical application lives under `apps/web`,
`supabase`, and `workers`; the earlier Vite/Gemini prototype has been archived
out of the tree (see [History](#history)).

## Layout

```text
apps/web/            Next.js 15 (App Router) consultation app — the product UI + API
supabase/            Postgres schema-of-record: migrations, seed, pgTAP tests, config
workers/ai-worker/   Python (FastAPI) AI worker skeleton — generation + quality gate
docs/                Architecture notes, ADRs (decisions/), privacy notes
outputs/             Research, system-design, and marketing artifacts
```

### `apps/web` — the application

Next.js 15 App Router + TypeScript + Tailwind. It drives the whole consultation
flow (consent → capture → mask contract → generation job → stylist review →
customer-visible result) behind a `HairTwinStore` interface. Today the store is
an **in-memory** implementation; a Supabase-backed store is designed but not yet
wired (no remote is connected). Provider generation runs against a deterministic
**mock** adapter — the OpenAI adapter is deliberately left unwired pending a
data-processing/consent review (ADR-0006).

```powershell
cd apps/web
npm install
npm run dev        # http://localhost:3100
```

Other scripts: `npm run test` (Vitest), `npm run typecheck`, `npm run lint`,
`npm run build`.

### `supabase` — the schema of record

The database is the source of truth for tenancy and authority: composite
`(id, salon_id)` foreign keys for tenant isolation, RLS driven by `private.*`
`SECURITY DEFINER` helpers, role-based policies, private storage buckets, and
invite/membership hardening. Authority is read from `salon_memberships` only,
never from a JWT claim (ADR-0007).

`supabase test db` needs Docker to boot the local stack. Where Docker is not
available, an **offline** pgTAP runner executes the *same* migrations and the
*same* test files against PGlite (Postgres compiled to WASM) behind a small
Supabase shim:

```powershell
cd supabase/local-verify
npm install
npm run pgtap:fetch   # one-time: vendor pgTAP
npm run test          # strict runner — fails on TAP plan mismatch / bail / diagnostics
npm run self-test     # regression-tests the runner itself
```

The runner is a stand-in for CI, not a replacement: it does not exercise
PostgREST/GoTrue/Storage. `supabase test db` runs the identical files in CI.

### `workers/ai-worker` — the AI worker

A Python/FastAPI skeleton for the generation + quality-gate pipeline (mask-aware
region maps, provider adapters, a quality gate). It mirrors the app's mock
provider so the two stay in parity. It is not yet deployed.

## Documentation

- `docs/architecture/overview.md` — system overview
- `docs/decisions/` — ADRs (mock boundary, customer-exposure policy, Supabase
  environments, upload/mask-contract, auth/invite/bootstrap)
- `docs/privacy/privacy-notes.md` — privacy-as-architecture notes and the honest
  retention split

## Status

Pre-remote. No Supabase project is connected; the app runs fully locally on the
in-memory store with the mock provider. Wiring a real Supabase store + auth +
scheduler is gated on a chosen staging environment and a green Docker Supabase
CI run.

## History

The initial prototype was a single-package Vite + Google Gemini "Magic Mirror"
try-on app at the repo root, with a later React/Vite iteration under
`hair-twin-mvp/`. Both are superseded by the `apps/web` + `supabase` + `workers`
structure and were removed from this branch during consolidation. The prototype
is preserved on the `archive/vite-gemini-prototype-20260721` branch for
reference.
