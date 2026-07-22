# ADR-0003: Local/Mock Boundary for the First Vertical Slice

Date: 2026-07-15

## Status

Accepted for the first implementation slice.

## Context

The approved stack (ADR-0001) targets Supabase (Postgres/Auth/Storage/RLS/
Realtime) and a managed image-editing provider behind an adapter (ADR-0002).
However, no Supabase project, Vercel project, or image provider/model has been
chosen yet (handoff §12). The instruction is explicit: **do not connect an
arbitrary Supabase/Vercel project to production; if the target is undecided,
build a local/mock boundary with clear interfaces first.**

The first slice must nonetheless run locally and be testable end-to-end with a
Mock provider, with no secret in the client bundle and no public storage.

## Decision

1. **Persistence** is accessed only through `HairTwinStore`
   (`apps/web/src/lib/store/types.ts`). The default implementation is an
   in-process store (`InMemoryStore`) selected by `HAIR_TWIN_STORE=memory`.
   `HAIR_TWIN_STORE=supabase` is reserved and currently throws, rather than
   half-connecting to real customer data. The authoritative schema lives in
   `supabase/migrations` and is applied only once a project is chosen.

2. **Image bytes** are stored privately in the store and served via short-lived
   media tokens (`/api/media/<token>`), a signed-URL analog. There is no public
   bucket and no stable public URL.

3. **Generation** goes through the Provider Adapter
   (`lib/providers/adapter.ts`). The default is `MockHairProvider`; `openai` is
   selected only when `HAIR_TWIN_PROVIDER=openai` and `OPENAI_API_KEY` is set.
   Secrets are read server-side only (`server-only` modules) and never reach the
   browser.

4. **The worker** runs in-process (`lib/services/generation-worker.ts`) using
   the same adapter + quality-gate contracts as the Python worker skeleton in
   `workers/ai-worker`. Moving to the Python worker is a lift-and-shift with no
   product/UI change.

5. **MediaPipe** is the intended capture/segmentation engine and is represented
   as a documented seam in the Web Workers
   (`apps/web/src/workers/*.worker.ts`). A heuristic engine is the active
   fallback so capture/masking work offline without downloading models. Wiring
   MediaPipe Tasks Vision is a follow-up.

## Consequences

Positive:

- Whole consultation flow runs with `npm run dev` and in Node tests, no infra.
- Clear seams: swapping in Supabase, a real provider, or MediaPipe changes an
  adapter, not the product.
- Security invariants (no client secrets, no public storage, consent-gated
  retention) hold in the mock boundary already.

Tradeoffs / explicitly NOT done yet:

- In-memory store is not durable and single-process only.
- Real identity/landmark/non-hair CV signals are simulated by the mock.
- OpenAI image-edit call + full mask PNG upload are stubbed.
- Retention/consent wording are DRAFT pending Korean PIPA legal review.

## Reversal / Next Triggers

- Choose a Supabase project + environment split → implement `SupabaseStore`.
- Choose the first image provider/model → wire `OpenAIHairProvider` + Python
  worker; run the ADR-0002 benchmark.
- Approve legal consent wording + retention periods → replace DRAFT values.
