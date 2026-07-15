/**
 * Central knobs. Retention values here are DEV defaults; production retention
 * and the consent wording require Korean PIPA legal review (marked 임시).
 */
export const RETENTION = {
  /** Unsaved source image lifetime (design §12: within 24h or sooner). */
  unsavedSourceMs: 24 * 60 * 60 * 1000,
  /** Unsaved candidate lifetime — shorter; they are previews. */
  unsavedCandidateMs: 6 * 60 * 60 * 1000,
  /** Media access token TTL (short-lived, signed-URL analog). */
  mediaTokenMs: 5 * 60 * 1000,
  /** Whole session preview lifetime when nothing is saved. */
  unsavedSessionMs: 24 * 60 * 60 * 1000,
} as const;

/** 임시(DRAFT) consent wording version. Legal review required before launch. */
export const CONSENT_WORDING_VERSION = "draft-ko-2026-07";

export const DEV_SALON_ID = "salon_dev";
export const DEV_STYLIST_ID = "stylist_dev";
