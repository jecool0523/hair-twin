/**
 * Customer exposure policy (approved 2026-07-15).
 *
 * The single source of truth for "may the customer see this candidate?".
 * Derived at RESPONSE time, never frozen at QC time, because a stylist verdict
 * can arrive after the quality gate has run.
 *
 * Policy:
 *   1. Only candidates the stylist explicitly approved (`usable`) are shown to
 *      the customer.
 *   2. `accepted` and `needs_stylist_review` are approvable by the stylist.
 *   3. Hard-fail and `regenerate` candidates can NEVER be shown, even if a
 *      `usable` verdict is somehow attached (bypass prevention).
 *   4. Before a verdict exists, the customer screen shows a "미용사 검수 중"
 *      state instead of candidates.
 *   6. Customer view/share is enabled only when >= 1 approved candidate exists.
 *
 * This module is pure and is the same rule the server enforces and the UI
 * renders, so the two cannot drift.
 */
import type { QualityCheckResult, QualityStatus, StylistVerdict } from "./types";

/** Quality statuses a stylist is allowed to approve (policy rule 2). */
const APPROVABLE_STATUSES: QualityStatus[] = [
  "accepted",
  "needs_stylist_review",
];

/**
 * May a stylist approve this candidate for the customer?
 * Hard fails and `regenerate` are never approvable (policy rule 3).
 */
export function canStylistApprove(quality: {
  status: QualityStatus;
  hardFail: boolean;
}): boolean {
  if (quality.hardFail) return false;
  return APPROVABLE_STATUSES.includes(quality.status);
}

/**
 * May the customer see this candidate right now?
 * Requires BOTH an approvable quality result AND an explicit `usable` verdict
 * (policy rules 1 + 3 + 5).
 */
export function isCustomerVisible(
  quality: { status: QualityStatus; hardFail: boolean },
  stylistVerdict?: StylistVerdict,
): boolean {
  if (stylistVerdict !== "usable") return false;
  return canStylistApprove(quality);
}

/** Count of candidates currently visible to the customer (policy rule 6). */
export function approvedCount(
  candidates: Array<{
    quality: Pick<QualityCheckResult, "status" | "hardFail">;
    stylistVerdict?: StylistVerdict;
  }>,
): number {
  return candidates.filter((c) => isCustomerVisible(c.quality, c.stylistVerdict))
    .length;
}

/** Korean reason a candidate cannot be approved — shown to the stylist. */
export function notApprovableReason(quality: {
  status: QualityStatus;
  hardFail: boolean;
}): string | undefined {
  if (canStylistApprove(quality)) return undefined;
  if (quality.hardFail) return "자동 검수 차단됨 · 미용사 판정으로도 고객 노출 불가";
  if (quality.status === "regenerate")
    return "재생성 필요 · 미용사 판정으로도 고객 노출 불가";
  return "고객 노출 불가";
}
