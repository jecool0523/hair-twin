# ADR-0006: Image Transport and the Real Mask Contract

Date: 2026-07-16

## Status

Accepted and verified locally.

## Context

Two structural defects survived into the vertical slice, both explicitly banned
by the migration rules (handoff §8):

1. **Base64 images in JSON.** Capture posted `{ dataUrl: "data:image/jpeg;base64,…" }`.
   The client also forced `Content-Type: application/json` on every request, so
   a binary body was impossible by construction. The server trusted the client's
   declared MIME and its claimed `width`/`height`.

2. **Fake mask wiring.** The browser computed a `maskSummary` from the real
   photo, sent it, and the server recorded only its *version string*. The worker
   then invented fixed coverage for every job:

   ```ts
   const maskSummary = { hairEditCoverage: 0.18, expansionRadius: 6, … };
   ```

   Every consultation therefore generated against the same imaginary mask, and
   "retry with a smaller mask" only changed a number that no mask had produced.

## Decision — transport

Capture uploads `multipart/form-data` with two binary parts: the image bytes
and the region map derived from that same photo. There is no base64 path; the
JSON route returns 400. Preview uses `URL.createObjectURL`, so base64 does not
exist client-side either.

`Content-Type` is now decided per request (`lib/client/api.ts`): a `FormData`
body must set its own multipart boundary, so a global JSON header is not merely
unnecessary but actively wrong.

**The server is authoritative about the file.** `lib/media/image-probe.ts` reads
the actual signature (PNG/JPEG/WebP) and parses real dimensions from the
container headers. A declared MIME that disagrees with the bytes is rejected —
that disagreement is the classic upload attack, not a rounding error. Client
width/height are not an input at all. Size, format, and dimension limits are
enforced with Korean copy per rejection. Responses carry ids and a short-lived
media token; never bytes, never secrets.

## Decision — mask contract

The server derives the **whole mask set** from the uploaded region-map bytes
using the same pure `buildMaskSet()` the client uses, and persists every mask
(current hair, expansion, face protect, body/clothing protect, background
protect, uncertain boundary, hair edit) plus the region map as private,
expiring assets. Coverage is whatever that derivation produced.

- **A client cannot assert a summary**: the API does not accept one.
- **Jobs bind to a persisted contract id** and are refused if the contract
  belongs to another session/source, or has expired.
- **Retry re-derives a new contract version** from the same real region map with
  a tighter expansion radius. Tuning shows up as genuinely smaller masks; the
  prior version survives for auditability.
- **Providers get real mask references** plus a loader. The mock uses the same
  contract, so swapping providers changes nothing else. Note what those
  references actually are — see "Raw masks are not provider-ready" below.

### Trust boundary (read this before "hardening" it)

Segmentation runs in the **browser**, because that is where the pixels are and
because the approved design puts MediaPipe there. So the region map is
client-derived, and a hostile client could send a doctored one.

What that does **not** mean: the client cannot assert coverage, cannot widen the
edit mask by claiming a number, cannot reuse another session's masks, and cannot
revive expired ones. The server re-derives everything from bytes and validates
plausibility (known classes, matching length, some hair and some face present).

When the Python worker takes over segmentation, `lib/services/masks.ts` keeps its
shape — the region map simply arrives from the worker instead of the browser,
and the client-trust question disappears entirely. That is the real fix; this is
the honest interim.

## Raw masks are not provider-ready (corrected 2026-07-16)

Earlier comments in this repo claimed the adapter could hand the `hair_edit`
mask to an image-editing API directly. **That was wrong**, and the code has been
corrected. What we persist is a *raw mask grid*:

| | Stored today | What an image-edit API needs |
| --- | --- | --- |
| Encoding | `application/octet-stream`, 1 byte per cell | PNG |
| Resolution | segmentation grid (`masks.width/height`, ~48×64) | same size as the source (e.g. 480×640) |
| Polarity | `1` = edit here | OpenAI: **transparent** = edit here |

The loader is therefore named `loadRawMaskGrid`, not `loadMask`, so the
interface cannot be misread.

### `toProviderMask()` — checklist for whoever wires a real provider

This conversion does not exist yet. It must:

1. **Resize** the grid to the exact source dimensions. Nearest-neighbour, not
   bilinear — an interpolated mask edge invents half-edit pixels along the
   hairline, which is precisely where identity damage happens.
2. **Decide alpha polarity explicitly** and assert it in a test. Inverting this
   by accident edits the *face* and protects the *hair* — a silent, maximally
   harmful failure that still returns a plausible-looking image.
3. **PNG-encode** with a real alpha channel (RGBA, not palette).
4. **Verify dimensions match the source exactly** before sending; reject rather
   than let the provider silently letterbox or stretch.
5. **Round-trip test** the encoder: decode its own output and confirm the edit
   region matches the source grid within a stated tolerance.
6. Keep the raw grid as the stored artefact; the provider-ready PNG is derived
   and disposable, so a polarity fix does not require re-capturing customers.

Until (1)-(5) exist and the offshore-transfer review is signed off, the OpenAI
adapter stays unwired and raises rather than sending anything.

## Consequences

Positive:

- No base64 bloat, and binary uploads are possible at all.
- Content-sniffing rejects spoofed uploads (verified: a PHP script named `.png`
  is refused).
- Different photos genuinely produce different provider contracts.
- Retry means something.
- Masks/region maps are treated as sensitive as the face photo: private,
  expiring, swept.

Tradeoffs:

- The region map crosses the wire (a few KB); acceptable versus decoding JPEG
  server-side without native deps.
- Coverage plausibility checks are heuristic; they reject the obvious garbage,
  not a carefully crafted map.
- The heuristic segmentation engine is still the active one — MediaPipe remains
  a documented seam.

## Related

- Retention now has a real deletion path (`/api/maintenance/retention-sweep`,
  shared-secret authenticated), not just recorded expiry timestamps.
- Face embeddings: **not stored**. The mock emits simulated identity signals; a
  real implementation must compute embeddings in memory and persist only the
  derived score, never the vector. Recorded in docs/privacy/privacy-notes.md.
- Sending customer faces to an offshore AI provider is a separate privacy
  boundary and requires its own consent/legal review before the OpenAI adapter
  is wired.
