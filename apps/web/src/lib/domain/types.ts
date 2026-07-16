/**
 * Hair Twin core domain types.
 *
 * These are the product's own contracts. They are deliberately independent of
 * any AI provider's request/response shape (ADR-0002) and of the Supabase row
 * shapes. Provider- and DB-specific types live behind adapters.
 *
 * Migrated/rewritten from hair-twin-mvp/src/types.ts, restructured to match the
 * approved data model (system-design §5) and the mask/QC contracts
 * (ai-generation-design §6, §11).
 */

// ---------------------------------------------------------------------------
// Generation modes (ai-generation-design §3). Only hair_inpaint is exercised
// end-to-end in the first slice; the rest are declared for the adapter contract.
// ---------------------------------------------------------------------------
export type GenerationMode =
  | "hair_inpaint"
  | "color_transfer"
  | "reference_style"
  | "turnaround_reference";

// ---------------------------------------------------------------------------
// Style presets (ai-generation-design §7 style schema, merged with MVP preset
// consultation copy).
// ---------------------------------------------------------------------------
export interface StyleColor {
  family: string; // e.g. "brown"
  tone: string; // e.g. "neutral ash brown"
  level: number; // 1..10 lightness level
}

export interface StylePreset {
  id: string;
  displayNameKo: string; // shown in UI (Korean salon term)
  category: "cut" | "perm" | "color";
  categoryLabelKo: string;
  consultationSummaryKo: string; // stylist/customer facing one-liner
  // Normalized attributes used to build the generation prompt (never the raw
  // Korean term — see design §7 "Korean Stylist Labels").
  length: string;
  bangs: string;
  parting: string;
  silhouette: string;
  texture: string;
  volume: string;
  color: StyleColor;
  defaultMode: GenerationMode;
  // Purely cosmetic accent + mock rendering hint carried over from the MVP.
  accent: string;
  mockProfile: "short" | "medium" | "long" | "sleek" | "wave" | "color";
}

// ---------------------------------------------------------------------------
// Consent (system-design §5, §9). Immutable except revocation.
// ---------------------------------------------------------------------------
export type ConsentScope = "capture" | "save_images" | "save_report";

export interface ConsentRecord {
  captureConsented: boolean;
  saveImagesConsented: boolean;
  saveReportConsented: boolean;
  // NOTE(임시): the actual consent wording requires Korean PIPA legal review.
  // `wordingVersion` marks which draft copy the customer saw.
  wordingVersion: string;
  consentedAt: string; // ISO
  revokedAt?: string;
}

// ---------------------------------------------------------------------------
// Source image reference. Bytes live in the private store, never a public URL.
// ---------------------------------------------------------------------------
export interface SourceImageRef {
  id: string;
  sessionId: string;
  mime: string;
  width: number;
  height: number;
  createdAt: string;
  // Retention: unsaved captures carry an expiry (design §12). Absent expiry ==
  // explicitly saved with consent.
  expiresAt?: string;
  saved: boolean;
}

// ---------------------------------------------------------------------------
// Capture preflight result (ai-generation-design §5).
// ---------------------------------------------------------------------------
export interface PreflightResult {
  faceCount: number;
  hasSinglePrimaryFace: boolean;
  centered: boolean;
  distanceOk: boolean;
  brightnessOk: boolean;
  sharpnessOk: boolean;
  hairVisibleEnough: boolean;
  passed: boolean;
  issues: string[]; // Korean, user-facing guidance
  // Optional structured metrics for debugging / thresholds.
  metrics: {
    faceBox?: { x: number; y: number; w: number; h: number };
    brightness: number; // 0..1
    sharpness: number; // 0..1 relative
    centerOffset: number; // 0..1, 0 = perfectly centered
    faceAreaRatio: number; // face box area / image area
  };
  engine: "mediapipe" | "heuristic";
}

// ---------------------------------------------------------------------------
// Generation job lifecycle (ai-generation-design §13).
// ---------------------------------------------------------------------------
export type JobStatus =
  | "created"
  | "preflight_failed"
  | "queued"
  | "masking"
  | "generating"
  | "quality_checking"
  | "needs_stylist_review"
  | "completed"
  | "failed_retryable"
  | "failed_hard"
  | "expired"
  | "deleted";

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  "created",
  "queued",
  "masking",
  "generating",
  "quality_checking",
];

export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "completed",
  "needs_stylist_review",
  "failed_hard",
  "expired",
  "deleted",
];

// ---------------------------------------------------------------------------
// Automated quality gate (system-design §6, ai-generation-design §11).
// ---------------------------------------------------------------------------
export type QualityStatus =
  | "accepted"
  | "needs_stylist_review"
  | "regenerate"
  | "blocked_identity_changed"
  | "blocked_non_hair_changed"
  | "blocked_low_realism"
  | "blocked_policy_or_safety";

/** Raw measured signals a provider/worker attaches to each candidate. */
export interface QualitySignals {
  identitySimilarity: number; // 0..1 cosine-like, 1 = identical
  landmarkDelta: number; // 0..1 normalized by face size, 0 = no shift
  nonHairDiff: number; // 0..1 change outside the hair edit mask, 0 = untouched
  hairCoverageRatio: number; // 0..1 plausible hair region coverage
  faceCount: number; // primary faces detected in the output
  realismScore: number; // 0..1, 1 = photoreal, low = blurred/over-smoothed
  styleMatch: number; // 0..1 preset adherence
}

export interface QualityCheckResult {
  status: QualityStatus;
  hardFail: boolean;
  softFlags: string[]; // reasons for needs_stylist_review
  hardReasons: string[]; // reasons for a block
  signals: QualitySignals;
  evaluatedAt: string;
}
// NOTE: customer visibility is deliberately NOT stored here. It is derived at
// response time from (status, hardFail, stylistVerdict) — see domain/visibility.ts.
// Auto-QC alone never makes a candidate customer-visible; only an explicit
// stylist `usable` verdict does.

// ---------------------------------------------------------------------------
// Candidate + stylist decision.
// ---------------------------------------------------------------------------
export type StylistVerdict = "usable" | "needs_manual_review" | "regenerate";

export interface GeneratedCandidate {
  id: string;
  jobId: string;
  assetId: string; // key into the private media store
  styleId: string;
  variantLabel: string;
  seed: number;
  quality: QualityCheckResult;
  stylistVerdict?: StylistVerdict;
  provider: string;
  model: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Consultation session (aggregate root for the first slice).
// ---------------------------------------------------------------------------
export type SessionStage =
  | "consent"
  | "capture"
  | "quality"
  | "style"
  | "generating"
  | "review"
  | "saved"
  | "discarded";

export interface ConsultationNote {
  memoKo: string;
  feasibility: "easy" | "moderate" | "hard" | "";
  estimatedPrice: string;
  estimatedTime: string;
  careNotesKo: string;
  updatedAt: string;
}

export interface ConsultationSession {
  id: string;
  salonId: string;
  stylistId: string;
  customerAlias: string; // pseudonymous by default (system-design §5)
  stage: SessionStage;
  consent?: ConsentRecord;
  sourceImageId?: string;
  selectedStyleId?: string;
  note: ConsultationNote;
  createdAt: string;
  updatedAt: string;
  // Retention marker for the whole session when unsaved.
  expiresAt?: string;
}

export interface GenerationJob {
  id: string;
  sessionId: string;
  sourceImageId: string;
  styleId: string;
  mode: GenerationMode;
  status: JobStatus;
  candidateCount: number;
  attempts: number;
  maxAttempts: number;
  candidateIds: string[];
  failureReason?: string; // Korean, user-facing
  provider: string;
  model: string;
  /**
   * The persisted mask contract this job generates against. A job always uses
   * real, server-derived masks; a retry points at a newly derived version with a
   * tighter expansion radius rather than mutating the original.
   */
  maskContractId: string;
  maskContractVersion: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Audit (system-design §5). Append-only.
// ---------------------------------------------------------------------------
export type AuditAction =
  | "session_started"
  | "consent_recorded"
  | "capture_stored"
  | "job_created"
  | "job_completed"
  | "job_failed"
  | "candidate_viewed"
  | "result_saved"
  | "result_discarded"
  | "source_expired"
  | "report_created";

export interface AuditEvent {
  id: string;
  sessionId: string;
  action: AuditAction;
  actorId: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}
