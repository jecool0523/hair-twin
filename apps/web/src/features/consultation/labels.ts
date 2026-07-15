import type { JobStatus, QualityStatus } from "@/lib/domain/types";

export function jobStatusLabel(status: JobStatus): string {
  const map: Record<JobStatus, string> = {
    created: "생성 준비",
    preflight_failed: "촬영 품질 실패",
    queued: "대기열 등록",
    masking: "마스크 생성 중",
    generating: "후보 생성 중",
    quality_checking: "자동 검수 중",
    needs_stylist_review: "미용사 검토 필요",
    completed: "생성 완료",
    failed_retryable: "실패 (재시도 가능)",
    failed_hard: "실패",
    expired: "만료됨",
    deleted: "삭제됨",
  };
  return map[status];
}

export function qualityTone(
  status: QualityStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "accepted") return "success";
  if (status === "needs_stylist_review" || status === "regenerate")
    return "warning";
  return "danger";
}

export function qualityLabel(status: QualityStatus): string {
  const map: Record<QualityStatus, string> = {
    accepted: "자동 검수 통과",
    needs_stylist_review: "미용사 검토 필요",
    regenerate: "재생성 권장",
    blocked_identity_changed: "얼굴 변경 감지 · 숨김",
    blocked_non_hair_changed: "헤어 외 변경 · 숨김",
    blocked_low_realism: "사실성 부족 · 숨김",
    blocked_policy_or_safety: "정책/안전 · 숨김",
  };
  return map[status];
}

export const JOB_ACTIVE: JobStatus[] = [
  "created",
  "queued",
  "masking",
  "generating",
  "quality_checking",
];
