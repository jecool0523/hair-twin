# ADR-0002: AI Generation Method

Date: 2026-07-01

## Status

Accepted for MVP planning.

## Context

Hair Twin's differentiator is not generic image generation. The product must preserve the customer's identity and edit only the hair in a way that is useful for a salon consultation.

The system must avoid:

- Face changes.
- Beauty-filter effects.
- Background or clothing changes.
- Unrealistic hair structure.
- Outputs that imply a guaranteed final salon result.

## Decision

Use a controlled hair-only image-editing pipeline:

1. Browser capture with local face/framing checks.
2. Hair, face, body, and background segmentation.
3. Hair edit mask plus protected-region map.
4. Managed image-editing API through a provider adapter.
5. Automatic quality gates for identity and non-hair preservation.
6. Stylist review before save/report.

The first implementation should use a managed image-editing provider through an adapter, with OpenAI image editing as the first benchmark candidate. Product code must not depend directly on one provider.

## Rationale

Mask-based image editing gives more control than free-form generation.

Provider adapters let the team compare OpenAI, Google/Vertex, Stability, hosted open models, and future self-hosted pipelines without rewriting the product.

Automatic quality gates are mandatory because one bad output that changes the customer's face can destroy trust in the salon setting.

## Consequences

Positive:

- Faster MVP than training a custom model.
- Better privacy and cost control through local preflight.
- Clearer audit trail for generated images.
- Safer customer-facing experience.

Tradeoffs:

- Managed providers may not obey masks perfectly.
- Identity scoring must be tuned carefully.
- Some desired hairstyles may need wider edit masks and therefore higher risk.
- Turnaround views are references, not true 3D reconstruction.

## Reversal Triggers

Move toward a self-hosted/custom pipeline if:

- Managed providers cannot preserve identity reliably.
- Provider terms do not support salon customer face-image handling.
- Latency or cost fails pilot requirements.
- Hair-only control is not good enough after prompt/mask/QC improvements.

