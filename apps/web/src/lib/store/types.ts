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

/**
 * Masks and region maps describe the customer's hairline and face region, so
 * they are stored exactly like the source photo: privately, with an expiry.
 */
export type AssetKind = "source" | "candidate" | "mask" | "region_map";

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

/**
 * A persisted mask contract, modelled as a discriminated union on `status` so
 * the type system — not a runtime `if` — decides which fields exist.
 *
 * `active`: the server-derived mask set for one source image. Coverage is
 * AUTHORITATIVE — computed on the server from the actual region-map bytes via
 * buildMaskSet(), never a client-supplied number. A job references one of these
 * by id; retries create a new version with a tighter expansion radius.
 *
 * `purged`: a tombstone. Retention destroyed this contract's mask bytes while a
 * job still referenced it. The record survives ONLY so the job can prove which
 * contract it used. It therefore does NOT carry `coverage`, `maskAssetIds`, or
 * `regionMapAssetId` — those describe material that no longer exists, and the
 * DB row has no `mask_assets` to reconstruct them from. Trying to read them is
 * a compile error, which is the point.
 */
export interface CommonMaskContractFields {
  id: string;
  sessionId: string;
  sourceImageId: string;
  version: string; // MASK_CONTRACT_VERSION
  attempt: number; // which generation attempt produced this version
  expansionRadius: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface ActiveMaskContract extends CommonMaskContractFields {
  status: "active";
  /** Derived server-side from the mask bytes. */
  coverage: Record<string, number>;
  /** assetId per mask name; bytes live in the private store. */
  maskAssetIds: Record<string, string>;
  regionMapAssetId: string;
  expiresAt?: string;
  saved: boolean;
}

export interface PurgedMaskContract extends CommonMaskContractFields {
  status: "purged";
  /** When retention destroyed the mask bytes. One-way. */
  purgedAt: string;
}

export type MaskContractRecord = ActiveMaskContract | PurgedMaskContract;

/** What one retention sweep actually did (feeds the sweep audit events). */
export interface SweepResult {
  /** Byte-carrying assets deleted (sources, masks, region maps, candidates). */
  removedAssets: number;
  /** Contracts fully deleted (no job referenced them). */
  deletedContracts: number;
  /** Contracts tombstoned because a job still references them. */
  purgedContracts: Array<{ id: string; sessionId: string }>;
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

  // mask contracts (server-derived; see MaskContractRecord)
  putMaskContract(contract: MaskContractRecord): Promise<MaskContractRecord>;
  getMaskContract(id: string): Promise<MaskContractRecord | undefined>;
  /** Newest-first, so a retry can find the latest version for a source. */
  listMaskContractsForSource(
    sourceImageId: string,
  ): Promise<MaskContractRecord[]>;

  // media access tokens (short-lived, signed-URL analog)
  issueMediaToken(assetId: string, ttlMs: number): Promise<MediaToken>;
  resolveMediaToken(token: string): Promise<string | undefined>; // -> assetId

  // audit (append-only)
  appendAudit(event: AuditEvent): Promise<void>;
  listAudit(sessionId: string): Promise<AuditEvent[]>;

  /**
   * Retention sweep: delete unsaved, expired assets. Expired mask contracts
   * still referenced by a job are TOMBSTONED (bytes destroyed, record kept with
   * purgedAt) rather than deleted — see SweepResult.
   */
  sweepExpired(now?: Date): Promise<SweepResult>;
}
