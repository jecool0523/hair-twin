/**
 * Automated quality gate (system-design §6, ai-generation-design §11).
 *
 * `evaluateQuality` is pure domain logic: given measured QualitySignals it
 * returns a QualityStatus, whether the candidate is a hard fail, and the
 * reasons behind that call.
 *
 * IMPORTANT: this gate does NOT decide customer visibility. Auto-QC alone never
 * exposes a candidate to the customer — an explicit stylist `usable` verdict is
 * required, and hard-fail/`regenerate` can never be exposed at all. That policy
 * lives in domain/visibility.ts and is applied at response time.
 *
 * The signal *values* come from the provider/worker (real CV in the Python
 * worker; deterministic mock signals in the mock adapter). The thresholds and
 * decision policy below are the product's own and are unit-tested.
 */
import type {
  QualityCheckResult,
  QualitySignals,
  QualityStatus,
} from "./types";

export interface QualityThresholds {
  identityMin: number; // below => identity changed (hard fail)
  identitySoftMin: number; // below => stylist review
  landmarkMax: number; // above => face moved (hard fail)
  nonHairMax: number; // above => non-hair region changed (hard fail)
  nonHairSoftMax: number; // above => stylist review
  realismMin: number; // below => low realism (hard fail)
  realismSoftMin: number; // below => stylist review
  styleMatchSoftMin: number; // below => stylist review
  hairCoverageMin: number; // below => hair not separated well (regenerate)
  hairCoverageMax: number; // above => hair invaded face/frame (hard fail)
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  identityMin: 0.82,
  identitySoftMin: 0.9,
  landmarkMax: 0.06,
  nonHairMax: 0.08,
  nonHairSoftMax: 0.035,
  realismMin: 0.55,
  realismSoftMin: 0.7,
  styleMatchSoftMin: 0.6,
  hairCoverageMin: 0.03,
  hairCoverageMax: 0.55,
};

export function evaluateQuality(
  signals: QualitySignals,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): QualityCheckResult {
  const hardReasons: string[] = [];
  const softFlags: string[] = [];

  // ---- Hard-fail checks (ai-generation-design §11 "Hard-Fail Checks") ----
  if (signals.faceCount !== 1) {
    hardReasons.push(
      `얼굴이 ${signals.faceCount}개로 감지됨 (정확히 1개여야 함)`,
    );
  }
  if (signals.identitySimilarity < thresholds.identityMin) {
    hardReasons.push("얼굴 정체성 유사도가 기준 미만");
  }
  if (signals.landmarkDelta > thresholds.landmarkMax) {
    hardReasons.push("얼굴 랜드마크 변화가 기준 초과");
  }
  if (signals.nonHairDiff > thresholds.nonHairMax) {
    hardReasons.push("헤어 외 영역 변화가 기준 초과");
  }
  if (signals.hairCoverageRatio > thresholds.hairCoverageMax) {
    hardReasons.push("헤어가 얼굴/프레임을 비정상적으로 침범");
  }
  if (signals.realismScore < thresholds.realismMin) {
    hardReasons.push("결과 이미지의 사실성이 기준 미만");
  }

  if (hardReasons.length > 0) {
    // Choose the most specific block status.
    let status: QualityStatus = "blocked_low_realism";
    if (
      signals.identitySimilarity < thresholds.identityMin ||
      signals.landmarkDelta > thresholds.landmarkMax ||
      signals.faceCount !== 1
    ) {
      status = "blocked_identity_changed";
    } else if (
      signals.nonHairDiff > thresholds.nonHairMax ||
      signals.hairCoverageRatio > thresholds.hairCoverageMax
    ) {
      status = "blocked_non_hair_changed";
    }
    return {
      status,
      hardFail: true,
      hardReasons,
      softFlags,
      signals,
      evaluatedAt: now.toISOString(),
    };
  }

  // ---- Regenerate check: hair not separated well enough ----
  if (signals.hairCoverageRatio < thresholds.hairCoverageMin) {
    return {
      status: "regenerate",
      hardFail: false,
      hardReasons,
      softFlags: ["헤어 영역이 충분히 분리되지 않음"],
      signals,
      evaluatedAt: now.toISOString(),
    };
  }

  // ---- Soft-fail checks (needs stylist review) ----
  if (signals.identitySimilarity < thresholds.identitySoftMin) {
    softFlags.push("얼굴 유사도가 경계값 근처");
  }
  if (signals.nonHairDiff > thresholds.nonHairSoftMax) {
    softFlags.push("헤어 외 영역 변화가 경계값 근처");
  }
  if (signals.realismScore < thresholds.realismSoftMin) {
    softFlags.push("사실성이 경계값 근처");
  }
  if (signals.styleMatch < thresholds.styleMatchSoftMin) {
    softFlags.push("선택한 프리셋과의 일치도가 낮음");
  }

  if (softFlags.length > 0) {
    return {
      status: "needs_stylist_review",
      hardFail: false,
      hardReasons,
      softFlags,
      signals,
      evaluatedAt: now.toISOString(),
    };
  }

  return {
    status: "accepted",
    hardFail: false,
    hardReasons,
    softFlags,
    signals,
    evaluatedAt: now.toISOString(),
  };
}

/** Korean, user-facing summary for a quality status. */
export function qualityStatusLabel(status: QualityStatus): string {
  switch (status) {
    case "accepted":
      return "자동 검수 통과";
    case "needs_stylist_review":
      return "미용사 검토 필요";
    case "regenerate":
      return "재생성 권장";
    case "blocked_identity_changed":
      return "얼굴 보존 실패로 숨김";
    case "blocked_non_hair_changed":
      return "헤어 외 영역 변경으로 숨김";
    case "blocked_low_realism":
      return "사실성 부족으로 숨김";
    case "blocked_policy_or_safety":
      return "정책/안전 기준으로 숨김";
  }
}
