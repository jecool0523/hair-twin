# Hair Twin implementation architecture

Hair Twin is an invited-salon, tenant-isolated Next.js application backed by
Supabase and a separately hosted Python generation worker. The offline memory
store and mock provider are explicit local/CI fixtures; hosted production-mode
web requests require `HAIR_TWIN_STORE=supabase`.

## Request and data boundaries

```text
Browser
  -> Next.js routes (same-origin mutations, authenticated session)
  -> Supabase Auth/PostgREST/private Storage
  -> generation_jobs queue
  -> Python worker service-role RPC claim
  -> provider adapter -> CV scorer -> quality gate
  -> private generated object + atomic candidate/QC finish RPC
  -> stylist review -> explicit usable verdict -> customer exposure
```

The browser receives only a Supabase publishable key and short-lived media
tokens. Service-role/provider keys, private object paths, full image bytes,
masks, prompts, and provider responses remain server/worker-only. Salon roles
come from `salon_memberships`, never mutable JWT user metadata.

## Authoritative components

| Concern | Implementation |
| --- | --- |
| UI and HTTP routes | `apps/web/src/app`, `apps/web/src/features` |
| Same-origin/auth boundary | `apps/web/src/middleware.ts`, `apps/web/src/lib/request-security.ts` |
| Supabase store | `apps/web/src/lib/store/supabase.ts` |
| Domain/QC/exposure policy | `apps/web/src/lib/domain` |
| Schema, RLS, Storage, RPC ACLs | `supabase/migrations` |
| Strict database tests | `supabase/tests` |
| Worker claim/lifecycle | `workers/ai-worker/app/main.py`, `app/storage` |
| Provider adapter | `workers/ai-worker/app/providers` |
| CV boundary | `workers/ai-worker/app/quality/scorer.py` |
| Worker health/readiness | `workers/ai-worker/app/runtime.py` |

All migrations under `supabase/migrations` are ordered, forward-only source of
truth. The current schema includes membership/invite authority, tenant-bound
consultations and media, mask contracts, generation lifecycle RPCs, atomic
result/QC finalization, and retention claim/delete/finalize behavior.

## Exposure and launch gates

Automated QC never exposes a candidate by itself. Only `accepted` or
`needs_stylist_review` can receive an explicit stylist `usable` verdict; hard
fail and regenerate results remain hidden.

No real image model or CV service is selected by default. Real image calls need
explicit provider/model/quality/size, privacy-transfer approval, secret key, and
a positive HTTP-attempt budget. With no approved CV scorer, the fail-closed
adapter produces hard-failing measurements for every external result.

See `docs/operations/staging-runbook.md` for environment scope, connection,
verification, cost, recovery, and production-promotion gates.
