# ADR-0004: Customer Exposure Policy

Date: 2026-07-15

## Status

Accepted.

## Context

Browser verification of the first vertical slice found that `customerVisible`
was frozen at auto-QC time and ignored the stylist verdict entirely. Measured
against the running server:

| Candidate | Auto-QC | Stylist verdict | Customer saw it? |
| --- | --- | --- | --- |
| 1 | accepted | `regenerate` (rejected) | **yes** — rejected result still shown |
| 2 | needs_stylist_review | `usable` (approved) | **no** — approval had no effect |
| 4 | accepted | (none) | **yes** — shown with zero human review |

This contradicted the stylist UI's own copy ("미용사가 '사용 가능'으로 판정한
결과만 고객과 공유하세요") and the handoff §5 rule that auto-QC passing does not
make a result customer-final without stylist review.

## Decision

1. Only candidates the stylist explicitly approved (`usable`) are shown to the
   customer.
2. `accepted` and `needs_stylist_review` are approvable by the stylist.
3. Hard-fail and `regenerate` candidates can never be exposed, even with a
   `usable` verdict (bypass prevention).
4. Before a verdict exists, the customer surface shows a **미용사 검수 중**
   state instead of candidates.
5. `customerVisible` is NOT stored at QC time. It is derived at response time
   from `(status, hardFail, stylistVerdict)`.
6. Customer view/share is enabled only when >= 1 approved candidate exists.

The policy lives in one pure module, `apps/web/src/lib/domain/visibility.ts`
(`canStylistApprove`, `isCustomerVisible`, `approvedCount`), mirrored in the
Python worker (`workers/ai-worker/app/quality/gate.py`) so the two cannot drift.

Enforcement is server-side, not UI-only:

- `setStylistVerdict` throws `VerdictNotAllowedError` (HTTP 400) when a
  hard-fail/`regenerate` candidate is approved.
- `finalizeDecision` refuses to persist any candidate that is not approved.

## Consequences

Positive:

- The stylist's judgement is authoritative for what the customer sees.
- A rejected or unreviewed result can no longer reach the customer.
- Hard-blocked outputs cannot be surfaced or saved by a crafted request.
- The UI copy now matches actual behaviour.

Tradeoffs:

- The customer screen shows "미용사 검수 중" until the stylist acts — a
  deliberate extra step that trades immediacy for trust.
- Revoking approval while the customer view is open does NOT snap back to the
  stylist view (that would expose QC internals to the customer); it falls back
  to the 미용사 검수 중 state.
- `approvedCount` is computed per response; if candidate counts grow, this may
  warrant caching.

## Verification

- `src/lib/domain/visibility.test.ts` — the three reported cases + bypass
  prevention for every blocked status and `regenerate`.
- `src/features/consultation/CandidateCompare.test.tsx` — 미용사 검수 중 renders;
  the customer surface never renders unapproved candidates or QC internals.
- `src/lib/services/consultation.integration.test.ts` — policy end-to-end,
  including server rejection of approve/save bypass attempts.
- Live HTTP verification against the dev server covering all six rules.

---

## Addendum (2026-07-15): session identity + recovery

Related fixes shipped alongside this policy, from the same browser verification:

- **Session identity moved into the URL** (`/consultation/[id]`). Previously it
  lived only in React state, so any remount (dev Fast Refresh, a stylist's
  refresh) silently abandoned the consultation and minted a new session —
  observed as 3 orphan sessions and a save that landed on a session the UI was
  no longer showing. `/` now starts a session and redirects; the console never
  creates one on mount. Unknown/expired ids render a recovery screen.
- **Timeouts + pending feedback.** Client requests abort after 15s (45s for
  image upload) and surface a retryable Korean error instead of an indefinite
  spinner; save shows "저장 중…"; the error banner has a 다시 시도 action.
- **`hasSource` derived from the asset**, not a dangling id, so a discarded
  session no longer claims to still hold a source image.
- **Progress-card heading a11y**: the status badge moved out of `CardTitle`
  (was announced as "생성 진행 상태대기열 등록"), plus an `aria-live` status
  region.
