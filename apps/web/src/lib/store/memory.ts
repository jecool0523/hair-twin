/**
 * In-process store implementation (dev/tests).
 *
 * Not for production. Enforces the retention rule: unsaved assets carry an
 * `expiresAt` and are removed by `sweepExpired`. Explicitly-saved assets drop
 * their expiry. This is the boundary a Supabase implementation later replaces.
 */
import { randomUUID, randomBytes } from "node:crypto";
import type {
  AuditEvent,
  ConsultationSession,
  GeneratedCandidate,
  GenerationJob,
  SourceImageRef,
} from "../domain/types";
import type {
  HairTwinStore,
  MaskContractRecord,
  PurgedMaskContract,
  MediaToken,
  StoredAsset,
} from "./types";

export class InMemoryStore implements HairTwinStore {
  private sessions = new Map<string, ConsultationSession>();
  private assets = new Map<string, StoredAsset>();
  private sources = new Map<string, SourceImageRef>();
  private jobs = new Map<string, GenerationJob>();
  private candidates = new Map<string, GeneratedCandidate>();
  private masks = new Map<string, MaskContractRecord>();
  private tokens = new Map<string, MediaToken>();
  private audit: AuditEvent[] = [];

  async createSession(s: ConsultationSession) {
    this.sessions.set(s.id, s);
    return s;
  }
  async getSession(id: string) {
    return this.sessions.get(id);
  }
  async updateSession(id: string, patch: Partial<ConsultationSession>) {
    const cur = this.sessions.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.sessions.set(id, next);
    return next;
  }

  async putAsset(a: StoredAsset) {
    this.assets.set(a.id, a);
    return a;
  }
  async getAsset(id: string) {
    return this.assets.get(id);
  }
  async markAssetSaved(id: string, saved: boolean) {
    const a = this.assets.get(id);
    if (!a) return;
    a.saved = saved;
    // Saving clears expiry; un-saving would require a new expiry set by caller.
    if (saved) a.expiresAt = undefined;
    this.assets.set(id, a);
  }

  async putSourceImage(ref: SourceImageRef) {
    this.sources.set(ref.id, ref);
    return ref;
  }
  async getSourceImage(id: string) {
    return this.sources.get(id);
  }

  async createJob(job: GenerationJob) {
    this.jobs.set(job.id, job);
    return job;
  }
  async getJob(id: string) {
    return this.jobs.get(id);
  }
  async updateJob(id: string, patch: Partial<GenerationJob>) {
    const cur = this.jobs.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(id, next);
    return next;
  }
  async listJobsForSession(sessionId: string) {
    return [...this.jobs.values()].filter((j) => j.sessionId === sessionId);
  }

  async putCandidate(c: GeneratedCandidate) {
    this.candidates.set(c.id, c);
    return c;
  }
  async getCandidate(id: string) {
    return this.candidates.get(id);
  }
  async updateCandidate(id: string, patch: Partial<GeneratedCandidate>) {
    const cur = this.candidates.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    this.candidates.set(id, next);
    return next;
  }
  async listCandidatesForJob(jobId: string) {
    return [...this.candidates.values()].filter((c) => c.jobId === jobId);
  }

  async putMaskContract(c: MaskContractRecord) {
    this.masks.set(c.id, c);
    return c;
  }
  async getMaskContract(id: string) {
    return this.masks.get(id);
  }
  async listMaskContractsForSource(sourceImageId: string) {
    return [...this.masks.values()]
      .filter((m) => m.sourceImageId === sourceImageId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.attempt - a.attempt);
  }

  async issueMediaToken(assetId: string, ttlMs: number) {
    const token = randomBytes(24).toString("base64url");
    const t: MediaToken = {
      token,
      assetId,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
    this.tokens.set(token, t);
    return t;
  }
  async resolveMediaToken(token: string) {
    const t = this.tokens.get(token);
    if (!t) return undefined;
    if (new Date(t.expiresAt).getTime() < Date.now()) {
      this.tokens.delete(token);
      return undefined;
    }
    return t.assetId;
  }

  async appendAudit(event: AuditEvent) {
    this.audit.push(event);
  }
  async listAudit(sessionId: string) {
    return this.audit.filter((e) => e.sessionId === sessionId);
  }

  async sweepExpired(now: Date = new Date()) {
    let removed = 0;
    const ts = now.getTime();
    for (const [id, a] of this.assets) {
      if (!a.saved && a.expiresAt && new Date(a.expiresAt).getTime() < ts) {
        this.assets.delete(id);
        removed++;
      }
    }
    for (const [id, s] of this.sources) {
      if (!s.saved && s.expiresAt && new Date(s.expiresAt).getTime() < ts) {
        this.sources.delete(id);
      }
    }
    // Mask contracts are as sensitive as the source photo. On expiry the BYTES
    // always die; whether the record dies depends on whether a job still points
    // at it (auditability): unreferenced -> delete outright; referenced ->
    // tombstone with purgedAt so the job can prove which contract it used.
    let deletedContracts = 0;
    const purgedContracts: Array<{ id: string; sessionId: string }> = [];
    for (const [id, m] of this.masks) {
      if (m.status === "purged") continue; // already a tombstone; bytes long gone
      if (!m.saved && m.expiresAt && new Date(m.expiresAt).getTime() < ts) {
        for (const assetId of Object.values(m.maskAssetIds)) {
          if (this.assets.delete(assetId)) removed++;
        }
        if (this.assets.delete(m.regionMapAssetId)) removed++;

        const referencedByJob = [...this.jobs.values()].some(
          (j) => j.maskContractId === id,
        );
        if (referencedByJob) {
          // Collapse to the PURGED variant: the tombstone must NOT carry
          // coverage, maskAssetIds, or regionMapAssetId — that material is gone.
          // Only the common fields survive, so the job can prove which contract
          // it used.
          const tombstone: PurgedMaskContract = {
            status: "purged",
            id: m.id,
            sessionId: m.sessionId,
            sourceImageId: m.sourceImageId,
            version: m.version,
            attempt: m.attempt,
            expansionRadius: m.expansionRadius,
            width: m.width,
            height: m.height,
            createdAt: m.createdAt,
            purgedAt: now.toISOString(),
          };
          this.masks.set(id, tombstone);
          purgedContracts.push({ id, sessionId: m.sessionId });
        } else {
          this.masks.delete(id);
          deletedContracts++;
        }
      }
    }
    for (const [token, t] of this.tokens) {
      if (new Date(t.expiresAt).getTime() < ts) this.tokens.delete(token);
    }
    return { removedAssets: removed, deletedContracts, purgedContracts };
  }
}

export function newId(prefix: string): string {
  void prefix;
  return randomUUID();
}
