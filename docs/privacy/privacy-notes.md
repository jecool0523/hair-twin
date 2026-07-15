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
