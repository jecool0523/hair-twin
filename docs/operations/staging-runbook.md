# Hair Twin staging connection runbook

This runbook prepares a staging-first deployment without selecting or creating
external resources. The repository is currently **not linked** to Supabase,
Vercel, a worker host, an AI model, a CV service, or an invite-email provider.
Production is out of scope.

## Approval checkpoint

Before any external change, record approval for all applicable targets:

| Decision | Required value |
| --- | --- |
| Supabase | staging project ref and region |
| Web | Vercel team/project and staging domain |
| Worker | hosting target and service name |
| AI | provider, exact model, quality, image size, call count, cost ceiling |
| Privacy | approved overseas-transfer and customer notice wording |
| QC | CV service/model, retention behavior, and measured thresholds |
| Invites | email provider and verified sender/domain |

Do not infer a value from an example. Confirm the target and expected impact
immediately before linking, creating resources, setting environment variables,
applying migrations, or deploying.

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
  +--> approved CV scorer (not implemented; fail-closed today)
```

The browser receives only `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_SECRET_KEY`, provider keys,
media token secrets, webhook secrets, and cron secrets stay in the web/worker
secret stores and never use a `NEXT_PUBLIC_` prefix.

## Supabase staging procedure

1. Confirm the exact staging project ref, region, and that it contains no
   production/customer data.
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

1. Confirm the Vercel team/project and whether staging is Preview or a custom
   environment. Link only that approved target.
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

Build `workers/ai-worker/Dockerfile` on the approved worker host. It runs as a
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

State that count and price source immediately before requesting approval for a
paid call. With the current defaults the maximum is zero calls and zero cost.

The current scorer is `fail_closed`. It returns deliberately failing identity,
landmark, non-hair, coverage, face-count, realism, and style signals. This means
unmeasured external results are private hard failures. They cannot receive a
stylist `usable` verdict or become customer-visible. Do not switch this setting
until an approved scorer implements the in-memory input/output contract and
passes timeout, error, retention, threshold, and exposure tests.

## Verification and handoff

Run web unit/integration tests, Python tests, typecheck, lint, production build,
runtime dependency audit, dependency-tree validation, strict pgTAP plus runner
self-test, local Supabase Auth/PostgREST/Storage journeys, `git diff --check`,
and a secret-pattern review. Hosted browser and real-AI checks remain blocked
until the targets and paid-call approval above are supplied.

Record staging resource identifiers (never secrets), deployment URLs, migration
state, test results, actual external call count/cost, and every unresolved gate.
Production promotion requires separate explicit approval and a fresh target,
privacy, cost, backup/recovery, and customer-exposure review.
