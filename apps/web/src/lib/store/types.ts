/**
 * Persistence boundary.
 *
 * The product talks to this interface only. The default implementation is an
 * in-process store (dev/tests). A Supabase-backed implementation is a drop-in
 * replacement once a project is chosen (ADR-0003) — the schema of record lives
 * in supabase/migrations. Image BYTES are stored here privately and served via
 * short-lived access tokens (a signed-URL analog); there is no public URL.
 */
import type {
  AuditAction,
  AuditEvent,
  ConsultationSession,
  GeneratedCandidate,
  GenerationJob,
  SourceImageRef,
} from "../domain/types";

export type AssetKind = "source" | "candidate";

export interface StoredAsset {
  id: string;
  kind: AssetKind;
  sessionId: string;
  mime: string;
  width: number;
  height: number;
  bytes: Buffer;
  createdAt: string;
  expiresAt?: string; // absent => retained (explicitly saved)
  saved: boolean;
}

export interface MediaToken {
  token: string;
  assetId: string;
  expiresAt: string;
}

export interface HairTwinStore {
  // sessions
  createSession(session: ConsultationSession): Promise<ConsultationSession>;
  getSession(id: string): Promise<ConsultationSession | undefined>;
  updateSession(
    id: string,
    patch: Partial<ConsultationSession>,
  ): Promise<ConsultationSession | undefined>;

  // assets (bytes)
  putAsset(asset: StoredAsset): Promise<StoredAsset>;
  getAsset(id: string): Promise<StoredAsset | undefined>;
  markAssetSaved(id: string, saved: boolean): Promise<void>;

  // source image refs (domain metadata)
  putSourceImage(ref: SourceImageRef): Promise<SourceImageRef>;
  getSourceImage(id: string): Promise<SourceImageRef | undefined>;

  // jobs + candidates
  createJob(job: GenerationJob): Promise<GenerationJob>;
  getJob(id: string): Promise<GenerationJob | undefined>;
  updateJob(
    id: string,
    patch: Partial<GenerationJob>,
  ): Promise<GenerationJob | undefined>;
  listJobsForSession(sessionId: string): Promise<GenerationJob[]>;

  putCandidate(candidate: GeneratedCandidate): Promise<GeneratedCandidate>;
  getCandidate(id: string): Promise<GeneratedCandidate | undefined>;
  updateCandidate(
    id: string,
    patch: Partial<GeneratedCandidate>,
  ): Promise<GeneratedCandidate | undefined>;
  listCandidatesForJob(jobId: string): Promise<GeneratedCandidate[]>;

  // media access tokens (short-lived, signed-URL analog)
  issueMediaToken(assetId: string, ttlMs: number): Promise<MediaToken>;
  resolveMediaToken(token: string): Promise<string | undefined>; // -> assetId

  // audit (append-only)
  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(sessionId: string): Promise<AuditEvent[]>;

  // retention sweep: delete unsaved, expired assets. Returns count removed.
  sweepExpired(now?: Date): Promise<number>;
}
