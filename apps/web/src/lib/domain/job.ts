/**
 * Generation job lifecycle helpers (ai-generation-design §13).
 * Pure functions describing legal transitions + retry policy.
 */
import type { JobStatus } from "./types";

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  created: ["queued", "preflight_failed", "deleted"],
  preflight_failed: ["deleted"],
  queued: ["masking", "failed_retryable", "deleted"],
  masking: ["generating", "failed_retryable", "failed_hard", "deleted"],
  generating: ["quality_checking", "failed_retryable", "failed_hard", "deleted"],
  quality_checking: [
    "completed",
    "needs_stylist_review",
    "failed_retryable",
    "failed_hard",
    "deleted",
  ],
  needs_stylist_review: ["completed", "failed_hard", "deleted", "queued"],
  completed: ["deleted", "expired"],
  failed_retryable: ["queued", "failed_hard", "deleted"],
  failed_hard: ["deleted", "queued"],
  expired: ["deleted"],
  deleted: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export const MAX_JOB_ATTEMPTS = 3; // initial + 2 retries (design §13)

export function canRetry(attempts: number, status: JobStatus): boolean {
  return status === "failed_retryable" && attempts < MAX_JOB_ATTEMPTS;
}

/** Retry strategy: stricter prompt + smaller edit mask on each attempt. */
export function retryTuning(attempt: number): {
  expansionRadius: number;
  stricterPrompt: boolean;
} {
  // attempt is the *next* attempt number (2 or 3).
  if (attempt >= 3) return { expansionRadius: 2, stricterPrompt: true };
  return { expansionRadius: 4, stricterPrompt: true };
}

export function isActive(status: JobStatus): boolean {
  return (
    status === "created" ||
    status === "queued" ||
    status === "masking" ||
    status === "generating" ||
    status === "quality_checking"
  );
}
