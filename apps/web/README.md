# Hair Twin — Web App

Next.js (App Router) salon hair-consultation console. First screen is the live
consultation flow, not a marketing page.

## Run locally

```bash
cd apps/web
npm install
cp .env.example .env.local   # defaults are fine (mock provider, in-memory store)
npm run dev                  # http://localhost:3100
```

No secrets or infrastructure required: the app defaults to the Mock provider and
an in-memory store (see `docs/decisions/ADR-0003`).

## Scripts

- `npm run dev` — dev server on port 3100
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — Next ESLint
- `npm run test` — Vitest (unit + integration)
- `npm run build` — production build

## Provider boundary

Real AI generation runs only in the Python worker. It requires an explicit
provider, model, quality, size, privacy-transfer gates, and a positive call
budget. No model is selected by default and secret values must remain in the
approved staging secret store. See `docs/operations/staging-runbook.md`.
