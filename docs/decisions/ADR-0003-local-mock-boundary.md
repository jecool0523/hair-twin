# ADR-0003: Local/mock and production-shaped boundaries

Date: 2026-07-15
Status: Accepted; production-shaped adapters implemented locally

## Decision

Persistence is accessed through `HairTwinStore`:

- `memory` is an explicit offline development/test implementation.
- `supabase` is request-scoped, uses the authenticated user's access token,
  and relies on database membership/RLS for authority.

Media remains private and is served through short-lived, user-bound tokens.
Generation is deterministic and in-process only in memory mode. Supabase mode
queues database-owned jobs for the Python worker, whose mutations are limited
to service-role-only RPCs.

The provider boundary supports mock and OpenAI Images. Mock is forbidden when
`HAIR_TWIN_ENV=production`. OpenAI is fail-closed unless external-AI and
overseas-transfer gates are enabled. Results without real CV measurements are
hard-blocked.

Browser segmentation remains a documented trust boundary. The server derives
all masks from the uploaded region-map bytes, validates their shape and
plausibility, and binds jobs to immutable versioned mask contracts.

## Consequences

- The full consultation flow remains available without infrastructure.
- Production persistence, tenancy, storage, worker, and retention behavior can
  be verified against a disposable local Supabase stack.
- Secrets never enter client code; public signup and public buckets stay off.
- The mock path cannot silently become a production provider.

## Remaining launch gates

- Connect reviewed staging Supabase/Vercel targets and verify deployment.
- Approve Korean consent/retention wording and overseas-provider terms.
- Benchmark the selected image model and deploy real pixel-based CV scoring.
- Validate monitoring, invite delivery, scheduled retention, and recovery runbooks.
