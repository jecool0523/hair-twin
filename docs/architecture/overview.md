# Hair Twin — Implementation Architecture (First Slice)

This complements `outputs/cto/architecture/hair-twin-system-design.md` with the
concrete boundaries built in `apps/web`.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Starts a consultation and redirects to `/consultation/<id>` (307). Not a landing page. |
| `/consultation/[id]` | The console. Session identity lives in the URL, so a refresh **resumes** the consultation instead of abandoning it. Initial state is server-rendered. |
| `/consultation/[id]` (unknown/expired) | `not-found.tsx` — explains the retention sweep and offers a clean restart. |

No session is created on component mount, so a remount (Fast Refresh, re-render,
back/forward) cannot orphan sessions server-side.

## Trust boundary

```
Browser (untrusted)                 Server / route handlers (trusted)
────────────────────                ─────────────────────────────────
capture + preflight (Web Workers)   validate (zod)  ──►  services
mask summary (coverage only)        provider adapter (secrets here only)
media tokens ◄── /api/media         in-process worker simulation
                                    HairTwinStore (private bytes + expiry)
                                    audit log
```

- The browser never receives: provider API keys, service-role keys, image
  bytes (only short-lived `/api/media/<token>` URLs), or full masks.
- `server-only` guards the store/provider/services so they cannot be imported
  into client bundles.

## Pipeline (ADR-0002)

```
capture ─► local preflight ─► segmentation ─► mask contract (hair_edit +
protected regions) ─► generation job ─► provider adapter ─► candidates ─►
automated quality gate ─► stylist review ─► save (consent) or discard
```

## Key modules

| Concern | Module |
| --- | --- |
| Domain types | `src/lib/domain/types.ts` |
| Style presets | `src/lib/domain/style-presets.ts` |
| Mask contract | `src/lib/domain/masks.ts` |
| Quality gate | `src/lib/domain/quality.ts` |
| Customer exposure policy | `src/lib/domain/visibility.ts` (ADR-0004) |
| Job lifecycle | `src/lib/domain/job.ts` |
| Provider adapter | `src/lib/providers/adapter.ts` (+ mock/openai/factory) |
| Store boundary | `src/lib/store/*` |
| Worker simulation | `src/lib/services/generation-worker.ts` |
| Capture vision | `src/lib/media/*`, `src/workers/*.worker.ts` |
| Consultation UI | `src/features/*` |

## Data model

Authoritative schema: `supabase/migrations/0001_init.sql` (+ `0002_storage`).
RLS on every exposed table; private buckets only. Applied only once a project is
chosen (ADR-0003).
