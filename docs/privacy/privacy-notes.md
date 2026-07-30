# Hair Twin privacy notes

Customer face images and hairline masks are sensitive data. The application
treats privacy requirements as enforceable architecture.

## Implemented controls

- Capture is rejected without immutable capture consent.
- Saving images is a separate consent and database RPC check.
- Source, mask, and generated media are private, tenant-prefixed objects.
- Customer-media objects are immutable and cannot be replaced in place.
- Browser media URLs are short-lived, signed, and bound to the authenticated
  user; there are no stable public object URLs.
- Multipart binary upload replaces base64 JSON. The server verifies the real
  image signature, MIME, dimensions, and limits.
- Customer visibility requires both an approvable quality result and an
  explicit stylist `usable` verdict.
- Audit events cover capture, generation lifecycle, media access, save,
  discard, invite acceptance, and retention deletion.
- Face embeddings and diff maps are not persisted. Only derived quality scores
  and reasons belong in `quality_checks`.

## Retention

Unsaved media always has an expiry. Vercel Cron calls the authenticated
retention route hourly. The Supabase retention service uses retry-safe,
service-role-only RPCs:

1. Claim expired rows with one opaque lease token.
2. Delete each corresponding private Storage object.
3. Finalize metadata only after successful object deletion.
4. Release failed claims for retry without losing metadata.

Source and generated deletions are audited. Job-referenced mask contracts keep
only a minimal purge tombstone after their bytes and mask rows are removed;
unreferenced contracts are deleted. Saved and unexpired media are excluded.
The memory development mode mirrors expiry semantics but is not a production
storage system.

Saving an approved generated result locks and preserves its source, active mask
contracts, and mask bytes in the same transaction. Saving is rejected while a
retention lease is active, and finalization rechecks `saved = false`, preventing
a successful save from racing a cascading source deletion.

## External AI transfer

Sending a customer face to an overseas AI provider is a separate transfer
boundary. The OpenAI adapter is implemented but fails closed unless both
`HAIR_TWIN_ENABLE_EXTERNAL_AI` and
`HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT` are explicitly enabled. Provider legal
review, approved consent wording, no-training/retention terms, and real CV
scoring are production launch gates.

## Items requiring legal and operational approval

- Korean consent wording (`draft-ko-2026-07` is not final).
- Engineering-default retention periods.
- Provider processing and overseas-transfer terms.
- Customer/stylist deletion and owner-recovery procedures.
- Staging/production monitoring that proves scheduled sweeps continue to run.
