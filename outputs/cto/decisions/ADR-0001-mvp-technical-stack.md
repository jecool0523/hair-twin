# ADR-0001: MVP Technical Stack

Date: 2026-07-01

## Status

Accepted for MVP planning.

## Context

Hair Twin needs to prove a salon consultation workflow before investing in full custom mirror hardware or specialized model training. The MVP must support:

- Webcam/tablet capture.
- Face and hair-region checks.
- AI hair synthesis.
- Side-by-side consultation comparison.
- Stylist notes.
- Consent-aware saving.
- Private image/report storage.
- Fast iteration with previews.

## Decision

Use this starting stack:

- Frontend/app: Next.js App Router + TypeScript.
- UI: Tailwind CSS + shadcn/ui primitives.
- Capture/vision: browser camera APIs + MediaPipe Tasks Vision.
- Backend: Supabase Postgres, Auth, Storage, Realtime, RLS.
- Deployment: Vercel for Next.js previews and production.
- AI generation: provider-agnostic image editing adapter first.
- AI worker: separate Python worker for masking, generation orchestration, quality scoring, retries, and upload.
- Hardware: PC/tablet/webcam pilot kit before custom mirror hardware.

## Rationale

Next.js and Vercel reduce product iteration time and support protected app routes, reports, and preview links.

Supabase fits the MVP data model because the product needs relational records, access control, private media storage, realtime job status, and auditability.

MediaPipe gives a practical browser-side starting point for face landmark and segmentation checks before uploading images.

A separate Python worker keeps long-running AI/image jobs out of the web app and lets the team change generation providers without rewriting the product.

The hardware form factor should be validated after the software consultation value is proven.

## Consequences

Positive:

- Fast MVP path.
- Strong privacy/security baseline with RLS and private storage.
- Clear separation between app, database, and AI worker.
- Avoids premature GPU and hardware lock-in.

Tradeoffs:

- Managed image APIs may fail hair-only precision.
- Browser-based vision may need tuning across salon lighting and devices.
- Supabase Realtime should be benchmarked before heavy scale.
- Custom hardware remains a later engineering program.

## Reversal Triggers

Reconsider the stack if:

- Browser/kiosk constraints block salon usage.
- Managed image APIs cannot preserve identity/hair-only edits at acceptable quality.
- Buyer requirements force strict data residency, VPC, or on-premise processing.
- Generation volume makes managed API cost worse than self-hosted GPU operations.
- Mirror hardware becomes a proven purchase driver after pilots.

