# Hair Twin — Privacy Notes (First Slice)

Face images are sensitive, potentially biometric-like data. Privacy is treated
as architecture (system-design §9), not just copy.

## Controls implemented in the first slice

- **Consent before capture.** No source image is accepted without
  `captureConsented` (enforced in `storeSourceImage`).
- **Separate save consent.** `saveImagesConsented` is required to persist
  results; without it, only discard is possible (enforced in
  `finalizeDecision` + the decision route).
- **Temporary by default.** Source images and candidates carry `expiresAt`
  (`RETENTION` in `lib/config.ts`) and are removed by `sweepExpired`. Discard
  force-expires immediately.
- **Private media only.** Bytes live in the store; the browser gets short-lived
  `/api/media/<token>` URLs (`RETENTION.mediaTokenMs`). No public bucket.
- **No client secrets.** Provider/service keys are read in `server-only`
  modules; nothing sensitive is bundled to the client.
- **Stylist-gated customer exposure (ADR-0004).** Auto-QC alone never exposes a
  result. Only candidates a stylist explicitly approved (`usable`) reach the
  customer; hard-fail and `regenerate` candidates can never be exposed or saved,
  even with a crafted request. Visibility is derived per response from
  `(status, hardFail, stylistVerdict)` — never frozen at QC time.
- **Audit log.** capture, job create/complete/fail, media view, save, discard
  are recorded via `appendAudit`.

## Media handling (ADR-0006)

- **No base64 image transport.** Uploads are multipart; the server decides the
  real format/dimensions from the bytes and rejects spoofed types.
- **Masks and region maps are sensitive.** They describe the customer's hairline
  and face region, so they are stored privately with the same expiry as the
  source photo and swept together with it.
## Retention — exactly what is and is not wired

An `expires_at` is a promise; deletion is the implementation. Here is the honest
split, because "retention is done" would be a dangerous thing to believe:

**Done:**

- `POST /api/maintenance/retention-sweep` — an authenticated, MANUAL sweep.
  Shared-secret (`RETENTION_SWEEP_TOKEN`); refuses to run if unset rather than
  defaulting to open. Verified over HTTP (401 / 401 / 200) and by tests proving
  it deletes expired media, spares saved media, and spares unexpired media.
- Deletion of unsaved expired source images, masks, region maps, and candidates
  **from the in-memory store**.
- **Tombstone rule for job-referenced masks** (migration 20260718103000): on
  expiry the mask BYTES always die; a contract still referenced by a generation
  job keeps a minimal `purged_at` record (ids, dimensions, coverage numbers) so
  the job can prove which contract it used. Purged contracts refuse new masks,
  new jobs, retries, and loading — enforced by DB triggers and in the app.
- **Sweep audit events (in-memory scope)**: each tombstoned contract emits a
  `mask_contract_purged` audit event on its session, once.
- DB-level guarantees that unsaved rows cannot exist without an expiry
  (`*_unsaved_must_expire` checks, verified in pgTAP).

**NOT done — do not claim otherwise:**

- **No scheduler.** Nothing calls the endpoint on a timer. Vercel Cron /
  Supabase pg_cron is not configured. Today retention only happens if a human
  or an external caller triggers it.
- **No remote deletion.** SupabaseStore does not exist, so nothing deletes rows
  from Postgres or objects from Storage buckets. The sweep currently only
  clears process memory.
- **Sweep audit coverage is partial.** `mask_contract_purged` events are
  emitted for tombstoned contracts, but only into the in-memory store; nothing
  lands in the real `audit_events` table until SupabaseStore exists, and
  plain asset deletions are still not individually audited.
- **No verification that storage objects and DB rows are deleted together**,
  since neither is wired yet.

Consequence: the retention *promise in the consent copy* is not yet operationally
met in any deployed environment. It is met in local/dev. Closing this requires
SupabaseStore + a scheduler + sweep audit events, and should be a launch gate.

## Face embeddings and QC intermediates — storage decision

- **Face embeddings are NOT stored.** Today the mock emits simulated identity
  signals and no embedding exists. When real identity scoring lands (Python
  worker), the embedding must be computed **in memory only**; persist the
  derived similarity score, never the vector. An embedding is biometric-grade
  data and storing it would materially change our PIPA exposure.
- **QC intermediates**: only the final `QualitySignals` numbers + status are
  persisted (`quality_checks`). Diff maps and other intermediates are not stored.
- **Masks/region maps ARE stored** (privately, expiring) because generation and
  retry need them; they are deleted by the same sweep as the photo.

## Offshore AI provider transfer — separate boundary

Sending a customer's face to an AI provider outside Korea is a **separate
personal-information transfer**, not covered by the current capture consent.
Before the OpenAI adapter is wired it requires: its own consent item, a provider
data-processing review (no training on submitted data), and legal sign-off.
The adapter is deliberately left unwired for this reason (ADR-0006).

## DRAFT items requiring legal review (임시)

- Consent wording (`CONSENT_WORDING_VERSION = draft-ko-2026-07`). Marked as a
  draft in the UI and code. **Do not treat as final.**
- Retention periods (24h source / 6h candidates) are engineering defaults, not
  legally reviewed values.
- Provider data-processing terms review before sending real customer faces to
  any external AI API (ADR-0002).

## Residual risks (first slice)

- In-memory store is process-local and not encrypted at rest (dev only).
- Mock QC signals are simulated; real CV scoring (identity embedding etc.) is
  not yet computing on actual pixels.
- No customer-facing deletion self-service yet (stylist discard only).
