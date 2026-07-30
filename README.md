# Hair Twin

Hair Twin is a B2B, salon-only AI hair-consultation product. Invited salon
staff capture a customer photo, generate hairstyle candidates, review safety
and quality, and explicitly approve anything shown or saved.

## Repository

```text
apps/web/            Next.js 15 App Router product UI and API
supabase/            Postgres migrations, RLS, private Storage, seed, pgTAP
workers/ai-worker/   Python generation and quality-gate worker
docs/                Architecture, decisions, privacy, and operations
outputs/             Research, design, and marketing artifacts
```

The web app supports two explicit modes:

- `HAIR_TWIN_STORE=memory`: offline development and deterministic tests.
- `HAIR_TWIN_STORE=supabase`: real Auth, membership authority, RLS,
  PostgREST, private Storage, queued generation, and scheduled retention.

`memory` is accepted only by the development server and test/build tooling.
Production requests fail closed unless `HAIR_TWIN_STORE=supabase` is set.

Production generation is processed by the Python worker through
service-role-only lifecycle RPCs. Its OpenAI Images adapter performs real
multipart image editing with a source-sized alpha mask, but remains fail-closed
unless external-AI and overseas-transfer gates are both enabled. Unmeasured
outputs are hard-blocked until real CV scoring is deployed.

## Local development

```powershell
cd apps/web
npm install
npm run dev
```

The app listens on `http://localhost:3100`. Useful checks are `npm test`,
`npm run typecheck`, `npm run lint`, and `npm run build`.

For offline database verification:

```powershell
cd supabase/local-verify
npm install
npm run pgtap:fetch
npm run self-test
npm test
```

The PGlite runner executes the same migrations and pgTAP files as the local
Supabase CI job. The authoritative CI job additionally boots Postgres,
PostgREST, GoTrue, and Storage, resets from an empty database, and runs Auth,
RLS, private-object, and full HTTP journey tests.

Run the production-shaped worker with the Supabase and provider environment
variables described in `apps/web/.env.example`:

```powershell
cd workers/ai-worker
$env:HAIR_TWIN_PROVIDER='mock'           # local/CI only
$env:HAIR_TWIN_ALLOW_MOCK='true'         # explicit local opt-in
python -m app.main
```

## Security and privacy boundaries

- No public signup; membership comes only from an accepted salon invite.
- Roles are read from `salon_memberships`, never writable user metadata.
- Source, mask, and generated buckets are private and tenant-prefixed.
- Capture and save require separate immutable consent records.
- Expired objects use claim/delete/finalize retention RPCs and audit events.
- Customer visibility always requires an explicit stylist `usable` verdict.
- Provider and secret keys remain server/worker-only.
- Browser mutations are same-origin, session creation is POST-only, and auth
  redirects are restricted to canonical internal paths.
- Provider/mask payloads and dimensions are bounded before decoding or image
  allocation; worker Storage paths must match the claimed tenant and session.

## Deployment status

The production-shaped path is implemented and locally verified. No hosted
Supabase or Vercel target is connected from this repository. Launch still
requires reviewed environment secrets, approved Korean consent and retention
wording, provider-transfer legal approval, real CV scoring, invite delivery,
and staging deployment verification.

The superseded Vite/Gemini prototype is preserved on
`archive/vite-gemini-prototype-20260721`.
