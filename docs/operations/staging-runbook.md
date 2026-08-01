# Hair Twin staging connection runbook

This runbook prepares an isolated staging deployment. It must create new
resources and must not reuse or modify an existing GitHub repository, Supabase
project, Vercel project, or Railway project. Until creation succeeds, the
repository remains unlinked. Production is out of scope.

## Approved staging targets

The 2026-08-01 staging policy selected the first available names below. Report
them immediately before creation and record the identifiers returned by each
service, but never record a secret value.

| Decision | Required value |
| --- | --- |
| GitHub | private `jecool0523/hair-twin`; local remote `hair-twin-demo`; default branch `main` |
| Supabase | new `hair-twin-staging`; Seoul `ap-northeast-2`; project ref assigned on creation |
| Web | authenticated personal Vercel scope; new `hair-twin-staging`; `apps/web`; Preview |
| Worker | new Railway project `hair-twin-staging`; persistent service `hair-twin-ai-worker-staging` |
| AI | OpenAI `gpt-image-2-2026-04-21`, medium, source size, one candidate, one HTTP attempt |
| Privacy | nonpersonal fixture transfer to OpenAI is approved for this one staging demo |
| QC | pinned worker-local YuNet/SFace adapter; no additional image transfer |
| Invites | email provider and verified sender/domain |

If a selected name becomes unavailable, use `hair-twin-demo`, then
`hair-twin-staging-kr`; never append an arbitrary number. Supabase project cost
must still be displayed and confirmed through the connected Supabase workflow.
Creating a paid Vercel team or exceeding a Railway spending cap requires a new
approval.

## Topology and trust boundaries

```text
Browser -- publishable key/session --> staging Vercel web
  |                                      |
  | private signed media                 | server-only secret key
  v                                      v
staging Supabase Auth/Postgres/private Storage
                                           ^
                                           | service-role-only RPCs
hosting-neutral Python worker -------------+
  | explicit transfer gates + call budget
  +--> approved image provider
  +--> pinned local CV scorer (fail-closed remains the default)
```

The browser receives only `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_SECRET_KEY`, provider keys,
media token secrets, webhook secrets, and cron secrets stay in the web/worker
secret stores and never use a `NEXT_PUBLIC_` prefix.

## Supabase staging procedure

1. Create the new `hair-twin-staging` project in Seoul and confirm its assigned
   project ref. Never connect an existing project or add production/customer data.
2. Review `supabase migration list --linked` against the local migrations.
   Report every pending forward migration and its impact before applying it.
3. Confirm public signup remains disabled and configure the staging site URL
   plus exact login/invite redirect URLs. Wildcard redirects are for ephemeral
   preview URLs only; the fixed staging domain should be exact.
4. Apply only forward migrations with `supabase db push --linked`. Never reset,
   roll back, or delete staging data.
5. Run database tests and advisors, then verify all three Storage buckets are
   private, tenant prefixes are enforced, and worker RPCs are executable only
   by the service role.
6. Use generated test users and repository-generated/nonpersonal images for
   Auth, PostgREST, Storage, invite, queue, retry, and retention verification.

Existing migrations remain immutable. A defect after apply is fixed with a new
additive migration. Backups are verified through the approved Supabase plan;
recovery is a new forward fix or isolated restore rehearsal, never an ad-hoc
production restore.

## Web staging procedure

1. Create `hair-twin-staging` in the authenticated personal scope, connect only
   the new private GitHub repository, set Root Directory to `apps/web`, and use
   Preview. Do not create a paid team.
2. Add public variables from `apps/web/.env.example` to the staging scope. Add
   server-only values as sensitive variables. Review scope before each write
   because environment changes affect only new deployments.
3. Set `HAIR_TWIN_STORE=supabase`. A production-mode process refuses the memory
   store, so there is no silent hosted fallback.
4. Configure the exact staging origin for Supabase redirects. Keep the custom
   production domain disconnected.
5. Deploy to staging/preview and verify login, logout, invite, consultation
   upload, job queueing, retry, save, signed-media expiry, and retention with
   nonpersonal fixtures. Check mobile and desktop layouts, browser console
   errors, and failed network requests.
6. Keep the retention cron protected by `CRON_SECRET`; rotate an exposed secret
   and redeploy rather than editing logs or history.

## Worker staging procedure

Build `workers/ai-worker/Dockerfile` as the persistent Railway service
`hair-twin-ai-worker-staging` in the new `hair-twin-staging` project. It runs as a
non-root user, polls one database-owned job at a time, handles SIGTERM/SIGINT,
and exposes:

- `/healthz`: process liveness only;
- `/readyz`: configuration/readiness plus aggregate counters;
- `/metrics`: aggregate processed-job, idle-poll, and cycle-time metrics.

No endpoint contains job IDs, tenant IDs, object paths, image bytes, signed
URLs, prompts, provider bodies, or keys. Queue backlog still requires an
approved additive service-role RPC and is intentionally not guessed here.

Use `workers/ai-worker/.env.example` as the inventory. For local/CI only, mock
generation needs both `HAIR_TWIN_PROVIDER=mock` and
`HAIR_TWIN_ALLOW_MOCK=true`. A hosted worker must use the explicitly approved
real provider.

## Real AI and QC launch gates

All of these must be true before a real call:

- exact provider/model/quality/size approved;
- overseas-transfer and customer notice wording approved;
- provider key present only in the worker secret store;
- `HAIR_TWIN_ENABLE_EXTERNAL_AI=true` and
  `HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT=true`;
- positive `OPENAI_IMAGE_MAX_CALLS_PER_PROCESS` matching the approved test;
- only repository-generated or nonpersonal private test images selected.

Every HTTP attempt, including a retry, consumes the process budget. The maximum
cost calculation for one worker process lifetime is:

```text
approved HTTP attempts x candidates per attempt x provider price for the
approved model/quality/size
```

The fuse resets on process restart and applies per replica. Paid-call approval
must therefore also fix the worker replica count and test window; it is not a
durable billing limit. Use the provider account's own budget alert/hard limit
when the selected provider supports one.

State the count and current official price immediately before the call. The
single nonpersonal staging call described above is pre-approved, so no second
approval question is required. Any retry, second call, extra candidate/replica,
different model/quality/size, customer image, non-staging environment, or
external CV transfer requires a new approval. Keep the default budget at zero
until the pre-call report is sent and the deployed worker is ready.

The default scorer is `fail_closed`. The explicit `local_cv` option uses pinned
YuNet/SFace models inside the worker and makes no additional image transfer.
Unmeasured or invalid results remain private hard failures and cannot receive a
stylist `usable` verdict. See `actual-ai-demo.md` for versions, licenses,
measurements, timeout/memory bounds, and the paid-call checkpoint.

## Verification and handoff

Run web unit/integration tests, Python tests, typecheck, lint, production build,
runtime dependency audit, dependency-tree validation, strict pgTAP plus runner
self-test, local Supabase Auth/PostgREST/Storage journeys, `git diff --check`,
and a secret-pattern review. Hosted browser and real-AI checks begin only after
the new isolated resources, secret stores, migrations, and readiness checks are
complete.

Record staging resource identifiers (never secrets), deployment URLs, migration
state, test results, actual external call count/cost, and every unresolved gate.
Production promotion requires separate explicit approval and a fresh target,
privacy, cost, backup/recovery, and customer-exposure review.
