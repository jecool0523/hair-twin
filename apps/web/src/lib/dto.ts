/**
 * Client-safe DTO types shared by the server view serializer and the UI.
 * No server-only imports here so client components can use these types.
 */
import type {
  ConsultationNote,
  JobStatus,
  QualityStatus,
  SessionStage,
  StylistVerdict,
} from "./domain/types";

export interface CandidateView {
  id: string;
  jobId: string;
  variantLabel: string;
  mediaUrl: string; // /api/media/<token>
  qualityStatus: QualityStatus;
  /**
   * Derived at response time from (qualityStatus, hardFail, stylistVerdict).
   * True ONLY when the stylist explicitly approved an approvable candidate.
   */
  customerVisible: boolean;
  /** May the stylist approve this candidate at all? False for hardFail/regenerate. */
  canApprove: boolean;
  /** Korean reason approval is impossible, when canApprove is false. */
  notApprovableReason?: string;
  hardFail: boolean;
  softFlags: string[];
  hardReasons: string[];
  signals: {
    identitySimilarity: number;
    nonHairDiff: number;
    realismScore: number;
    styleMatch: number;
    landmarkDelta: number;
  };
  stylistVerdict?: StylistVerdict;
}

export interface JobView {
  id: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  failureReason?: string;
  candidates: CandidateView[];
  /** Candidates currently visible to the customer (policy rule 6). */
  approvedCount: number;
}

export interface SessionView {
  id: string;
  stage: SessionStage;
  customerAlias: string;
  selectedStyleId?: string;
  hasSource: boolean;
  sourceUrl?: string;
  consent?: {
    saveImagesConsented: boolean;
    saveReportConsented: boolean;
    wordingVersion: string;
  };
  note: ConsultationNote;
  jobs: JobView[];
}
