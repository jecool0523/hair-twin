"""Automated quality gate (mirror of quality.ts). Same thresholds and policy.

Keep DEFAULT_THRESHOLDS in sync with apps/web/src/lib/domain/quality.ts.

NOTE: this gate does NOT decide customer exposure. Auto-QC alone never shows a
candidate to the customer — an explicit stylist `usable` verdict is required and
hard-fail/regenerate can never be exposed. That policy is derived at response
time; see `can_stylist_approve` / `is_customer_visible` below, which mirror
apps/web/src/lib/domain/visibility.ts.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

from app.schemas import QualitySignals, QualityStatus


@dataclass
class Thresholds:
    identity_min: float = 0.82
    identity_soft_min: float = 0.90
    landmark_max: float = 0.06
    non_hair_max: float = 0.08
    non_hair_soft_max: float = 0.035
    realism_min: float = 0.55
    realism_soft_min: float = 0.70
    style_match_soft_min: float = 0.60
    hair_coverage_min: float = 0.03
    hair_coverage_max: float = 0.55


@dataclass
class QualityResult:
    status: QualityStatus
    hard_fail: bool
    soft_flags: list[str]
    hard_reasons: list[str]


# Statuses a stylist may approve (policy rule 2).
APPROVABLE_STATUSES = (
    QualityStatus.ACCEPTED,
    QualityStatus.NEEDS_STYLIST_REVIEW,
)


def can_stylist_approve(result: QualityResult) -> bool:
    """Hard fails and `regenerate` are never approvable (policy rule 3)."""
    if result.hard_fail:
        return False
    return result.status in APPROVABLE_STATUSES


def is_customer_visible(result: QualityResult, stylist_verdict: str | None) -> bool:
    """Requires an approvable result AND an explicit `usable` verdict (rules 1+3+5)."""
    if stylist_verdict != "usable":
        return False
    return can_stylist_approve(result)


def evaluate(sig: QualitySignals, t: Thresholds = Thresholds()) -> QualityResult:
    hard: list[str] = []
    soft: list[str] = []

    bounded = (
        sig.identity_similarity,
        sig.landmark_delta,
        sig.non_hair_diff,
        sig.hair_coverage_ratio,
        sig.realism_score,
        sig.style_match,
    )
    if (
        any(not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or value > 1 for value in bounded)
        or isinstance(sig.face_count, bool)
        or not isinstance(sig.face_count, int)
        or sig.face_count < 0
        or sig.face_count > 20
    ):
        return QualityResult(
            QualityStatus.BLOCKED_POLICY_OR_SAFETY,
            True,
            soft,
            ["품질 측정값이 유효한 범위가 아닙니다."],
        )

    if sig.face_count != 1:
        hard.append(f"얼굴 {sig.face_count}개 (1개여야 함)")
    if sig.identity_similarity < t.identity_min:
        hard.append("얼굴 정체성 유사도 미달")
    if sig.landmark_delta > t.landmark_max:
        hard.append("랜드마크 변화 초과")
    if sig.non_hair_diff > t.non_hair_max:
        hard.append("헤어 외 변화 초과")
    if sig.hair_coverage_ratio > t.hair_coverage_max:
        hard.append("헤어 침범")
    if sig.realism_score < t.realism_min:
        hard.append("사실성 미달")

    if hard:
        status = QualityStatus.BLOCKED_LOW_REALISM
        if (
            sig.identity_similarity < t.identity_min
            or sig.landmark_delta > t.landmark_max
            or sig.face_count != 1
        ):
            status = QualityStatus.BLOCKED_IDENTITY_CHANGED
        elif sig.non_hair_diff > t.non_hair_max or sig.hair_coverage_ratio > t.hair_coverage_max:
            status = QualityStatus.BLOCKED_NON_HAIR_CHANGED
        return QualityResult(status, True, soft, hard)

    if sig.hair_coverage_ratio < t.hair_coverage_min:
        return QualityResult(QualityStatus.REGENERATE, False, ["헤어 분리 부족"], hard)

    if sig.identity_similarity < t.identity_soft_min:
        soft.append("얼굴 유사도 경계")
    if sig.non_hair_diff > t.non_hair_soft_max:
        soft.append("헤어 외 변화 경계")
    if sig.realism_score < t.realism_soft_min:
        soft.append("사실성 경계")
    if sig.style_match < t.style_match_soft_min:
        soft.append("스타일 일치 낮음")

    if soft:
        return QualityResult(QualityStatus.NEEDS_STYLIST_REVIEW, False, soft, hard)

    return QualityResult(QualityStatus.ACCEPTED, False, soft, hard)
