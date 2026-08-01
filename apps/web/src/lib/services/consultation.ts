/**
 * Consultation service — high-level operations the route handlers call.
 * Enforces the product rules: consent gating, retention/expiry, audit logging,
 * and the "auto-QC failures are not auto-shown to the customer" rule.
 */
import "server-only";
import { getActorContext, getStore, isSupabaseMode, newId } from "../store";
import { audit } from "./audit";
import { processJob } from "./generation-worker";
import { getStylePreset } from "../domain/style-presets";
import { canRetry } from "../domain/job";
import {
  canStylistApprove,
  isCustomerVisible,
  notApprovableReason,
} from "../domain/visibility";
import { probeImage } from "../media/image-probe";
import {
  parseRegionMap,
  persistMaskContract,
  loadMaskContractForJob,
  deriveRetryContract,
  MaskRejected,
} from "./masks";
import { retryTuning } from "../domain/job";
import {
  CONSENT_WORDING_VERSION,
  RETENTION,
} from "../config";
import type {
  ConsentRecord,
  ConsultationSession,
  GeneratedCandidate,
  GenerationJob,
  SourceImageRef,
  StylistVerdict,
} from "../domain/types";
import type {
  ConsentInput,
  CreateJobInput,
  PreflightMeta,
  StartSessionInput,
} from "../validation/schemas";
import { assertCandidateCountAllowed } from "../domain/generation-policy";

/** Default plausible-growth ring for the first attempt (design §6). */
export const DEFAULT_EXPANSION_RADIUS = 6;

export async function startSession(
  input: StartSessionInput,
): Promise<ConsultationSession> {
  const store = getStore();
  const actor = getActorContext();
  const now = new Date();
  const session: ConsultationSession = {
    id: newId("sess"),
    salonId: actor.salonId,
    stylistId: actor.stylistId,
    customerAlias: input.customerAlias,
    stage: "consent",
    note: {
      memoKo: "",
      feasibility: "",
      estimatedPrice: "",
      estimatedTime: "",
      careNotesKo: "",
      updatedAt: now.toISOString(),
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + RETENTION.unsavedSessionMs,
    ).toISOString(),
  };
  await store.createSession(session);
  await audit(session.id, "session_started", session.stylistId, {
    stylist: input.stylistName,
  });
  return session;
}

export async function recordConsent(
  sessionId: string,
  input: ConsentInput,
): Promise<ConsultationSession | undefined> {
  const store = getStore();
  const consent: ConsentRecord = {
    captureConsented: input.captureConsented,
    saveImagesConsented: input.saveImagesConsented,
    saveReportConsented: input.saveReportConsented,
    wordingVersion: input.wordingVersion || CONSENT_WORDING_VERSION,
    consentedAt: new Date().toISOString(),
  };
  const session = await store.updateSession(sessionId, {
    consent,
    stage: "capture",
  });
  await audit(sessionId, "consent_recorded", getActorContext().stylistId, {
    saveImages: consent.saveImagesConsented,
    saveReport: consent.saveReportConsented,
    wordingVersion: consent.wordingVersion,
  });
  return session;
}

export interface StoreSourceInput {
  imageBytes: Uint8Array;
  declaredMime?: string;
  regionMapBytes: Uint8Array;
  regionMapWidth: number;
  regionMapHeight: number;
  preflight: PreflightMeta;
}

export async function storeSourceImage(
  sessionId: string,
  input: StoreSourceInput,
): Promise<
  | { ref: SourceImageRef; token: string; maskContractId: string }
  | undefined
> {
  const store = getStore();
  const session = await store.getSession(sessionId);
  if (!session || !session.consent?.captureConsented) return undefined;

  // The server decides what this file actually is. The client's declared MIME
  // is only checked for agreement, and its claimed width/height are not an
  // input at all.
  const probed = probeImage(input.imageBytes, input.declaredMime);

  // Coverage is derived here from the real region-map bytes, never accepted as
  // a client-supplied number (ADR-0006).
  const regionMap = parseRegionMap(
    input.regionMapBytes,
    input.regionMapWidth,
    input.regionMapHeight,
  );

  const assetId = newId("asset");
  const now = new Date();
  // Saving is an explicit later action, even when consent allows it.
  const saved = false;
  const expiresAt = new Date(
    now.getTime() + RETENTION.unsavedSourceMs,
  ).toISOString();

  await store.putAsset({
    id: assetId,
    kind: "source",
    sessionId,
    mime: probed.format,
    width: probed.width,
    height: probed.height,
    bytes: Buffer.from(input.imageBytes),
    createdAt: now.toISOString(),
    expiresAt,
    saved,
  });

  const ref: SourceImageRef = {
    id: assetId,
    sessionId,
    mime: probed.format,
    width: probed.width,
    height: probed.height,
    createdAt: now.toISOString(),
    expiresAt,
    saved,
  };
  await store.putSourceImage(ref);

  const contract = await persistMaskContract({
    sessionId,
    sourceImageId: assetId,
    regionMap,
    expansionRadius: DEFAULT_EXPANSION_RADIUS,
    attempt: 1,
  });

  await store.updateSession(sessionId, {
    sourceImageId: assetId,
    stage: "style",
  });
  await audit(sessionId, "capture_stored", getActorContext().stylistId, {
    assetId,
    maskContractId: contract.id,
    format: probed.format,
    width: probed.width,
    height: probed.height,
    // Preflight is recorded for the stylist's benefit; it is not QC input.
    preflightPassed: input.preflight.passed,
    preflightFaceCount: input.preflight.faceCount,
    engine: input.preflight.engine,
    expiresAt,
  });

  const token = await store.issueMediaToken(assetId, RETENTION.mediaTokenMs);
  return { ref, token: token.token, maskContractId: contract.id };
}

export async function createGenerationJob(
  sessionId: string,
  input: CreateJobInput,
): Promise<GenerationJob | undefined> {
  assertCandidateCountAllowed(input.candidateCount);
  const store = getStore();
  const session = await store.getSession(sessionId);
  if (!session || !session.sourceImageId) return undefined;
  const preset = getStylePreset(input.styleId);
  if (!preset) return undefined;

  // Bind the job to a real, persisted mask contract. This rejects a contract
  // from another session/source and one that has already expired, so a job can
  // never generate against someone else's masks or against stale ones.
  const contract = await loadMaskContractForJob({
    contractId: input.maskContractId,
    sessionId,
    sourceImageId: session.sourceImageId,
  });

  const now = new Date();
  const job: GenerationJob = {
    id: newId("job"),
    sessionId,
    sourceImageId: session.sourceImageId,
    styleId: input.styleId,
    mode: preset.defaultMode,
    status: "created",
    candidateCount: input.candidateCount,
    attempts: 1,
    maxAttempts: 3,
    candidateIds: [],
    provider: process.env.HAIR_TWIN_PROVIDER ?? "mock",
    model: "",
    maskContractId: contract.id,
    maskContractVersion: contract.version,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await store.createJob(job);
  await store.updateSession(sessionId, {
    selectedStyleId: input.styleId,
    stage: "generating",
  });
  await audit(sessionId, "job_created", getActorContext().stylistId, {
    jobId: job.id,
    styleId: input.styleId,
    candidateCount: input.candidateCount,
  });

  // Fire-and-forget worker simulation. UI polls status.
  if (!isSupabaseMode()) void processJob(job.id, { attempt: 1 }).catch(() => {
    /* errors are recorded on the job itself */
  });
  return job;
}

export async function retryJob(
  jobId: string,
): Promise<GenerationJob | undefined> {
  const store = getStore();
  const job = await store.getJob(jobId);
  if (!job) return undefined;
  if (!canRetry(job.attempts, job.status)) return job;

  const nextAttempt = job.attempts + 1;

  // Retry tuning is applied to the REAL contract: re-derive the mask set from
  // the same persisted region map with a tighter expansion radius, and point the
  // job at that new version. The previous version stays for auditability.
  let maskContractId = job.maskContractId;
  let maskContractVersion = job.maskContractVersion;
  try {
    const previous = await loadMaskContractForJob({
      contractId: job.maskContractId,
      sessionId: job.sessionId,
      sourceImageId: job.sourceImageId,
    });
    const tuning = retryTuning(nextAttempt);
    const next = await deriveRetryContract(
      previous,
      tuning.expansionRadius,
      nextAttempt,
    );
    maskContractId = next.id;
    maskContractVersion = next.version;
  } catch (err) {
    if (err instanceof MaskRejected) {
      return store.updateJob(jobId, {
        status: "failed_hard",
        failureReason: err.userMessageKo,
      });
    }
    throw err;
  }

  const updated = await store.updateJob(jobId, {
    status: "created",
    attempts: nextAttempt,
    failureReason: undefined,
    candidateIds: [],
    maskContractId,
    maskContractVersion,
  });
  await audit(job.sessionId, "job_created", getActorContext().stylistId, {
    jobId,
    retry: true,
    attempt: nextAttempt,
    maskContractId,
  });
  if (!isSupabaseMode()) void processJob(jobId, { attempt: nextAttempt }).catch(() => {});
  return updated;
}

/** Raised when a stylist tries to approve a candidate the policy forbids. */
export class VerdictNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerdictNotAllowedError";
  }
}

export async function setStylistVerdict(
  candidateId: string,
  verdict: StylistVerdict,
): Promise<GeneratedCandidate | undefined> {
  const store = getStore();
  const existing = await store.getCandidate(candidateId);
  if (!existing) return undefined;

  // Bypass prevention (policy rule 3): a hard-fail or `regenerate` candidate can
  // never be approved for the customer, no matter what the client sends. This is
  // enforced here — on the server — not just in the UI.
  if (verdict === "usable" && !canStylistApprove(existing.quality)) {
    throw new VerdictNotAllowedError(
      notApprovableReason(existing.quality) ??
        "이 후보는 고객에게 노출할 수 없습니다.",
    );
  }

  return store.updateCandidate(candidateId, { stylistVerdict: verdict });
}

export async function finalizeDecision(
  sessionId: string,
  action: "save" | "discard",
  candidateIds: string[],
): Promise<ConsultationSession | undefined> {
  const store = getStore();
  const session = await store.getSession(sessionId);
  if (!session) return undefined;

  if (action === "discard") {
    // Force-expire the source + all candidate assets now.
    const now = new Date();
    const past = new Date(now.getTime() - 1000).toISOString();
    if (session.sourceImageId) {
      const a = await store.getAsset(session.sourceImageId);
      if (a) await store.putAsset({ ...a, expiresAt: past, saved: false });
    }
    for (const job of await store.listJobsForSession(sessionId)) {
      for (const c of await store.listCandidatesForJob(job.id)) {
        const a = await store.getAsset(c.assetId);
        if (a) await store.putAsset({ ...a, expiresAt: past, saved: false });
      }
    }
    await store.sweepExpired();
    const updated = await store.updateSession(sessionId, {
      stage: "discarded",
    });
    await audit(sessionId, "result_discarded", getActorContext().stylistId, {});
    return updated;
  }

  // Save requires explicit save-images consent (design §12).
  if (!session.consent?.saveImagesConsented) {
    throw new Error("save_images consent required to save results");
  }
  // Persist the chosen candidates (and only those). Bypass prevention: only
  // stylist-approved candidates may be saved, so a blocked/unreviewed output
  // cannot be persisted by a crafted request.
  for (const id of candidateIds) {
    const c = await store.getCandidate(id);
    if (!c) continue;
    if (!isCustomerVisible(c.quality, c.stylistVerdict)) {
      throw new VerdictNotAllowedError(
        "미용사가 '사용 가능'으로 승인한 후보만 저장할 수 있습니다.",
      );
    }
    await store.markAssetSaved(c.assetId, true);
  }
  if (session.sourceImageId) {
    await store.markAssetSaved(session.sourceImageId, true);
    const ref = await store.getSourceImage(session.sourceImageId);
    if (ref)
      await store.putSourceImage({
        ...ref,
        saved: true,
        expiresAt: undefined,
      });
  }
  const updated = await store.updateSession(sessionId, { stage: "saved" });
  await audit(sessionId, "result_saved", getActorContext().stylistId, {
    savedCandidateIds: candidateIds,
  });
  return updated;
}
