/**
 * Consultation service — high-level operations the route handlers call.
 * Enforces the product rules: consent gating, retention/expiry, audit logging,
 * and the "auto-QC failures are not auto-shown to the customer" rule.
 */
import "server-only";
import { getStore, newId } from "../store";
import { audit } from "./audit";
import { processJob } from "./generation-worker";
import { getStylePreset } from "../domain/style-presets";
import { canRetry } from "../domain/job";
import {
  canStylistApprove,
  isCustomerVisible,
  notApprovableReason,
} from "../domain/visibility";
import {
  CONSENT_WORDING_VERSION,
  DEV_SALON_ID,
  DEV_STYLIST_ID,
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
  SourceImageInput,
  StartSessionInput,
} from "../validation/schemas";

export async function startSession(
  input: StartSessionInput,
): Promise<ConsultationSession> {
  const store = getStore();
  const now = new Date();
  const session: ConsultationSession = {
    id: newId("sess"),
    salonId: DEV_SALON_ID,
    stylistId: DEV_STYLIST_ID,
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
  await audit(sessionId, "consent_recorded", DEV_STYLIST_ID, {
    saveImages: consent.saveImagesConsented,
    saveReport: consent.saveReportConsented,
    wordingVersion: consent.wordingVersion,
  });
  return session;
}

function decodeDataUrl(dataUrl: string): { mime: string; bytes: Buffer } {
  const match = dataUrl.match(
    /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/,
  );
  if (!match) throw new Error("invalid data url");
  const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1]!;
  return { mime, bytes: Buffer.from(match[2]!, "base64") };
}

export async function storeSourceImage(
  sessionId: string,
  input: SourceImageInput,
): Promise<{ ref: SourceImageRef; token: string } | undefined> {
  const store = getStore();
  const session = await store.getSession(sessionId);
  if (!session || !session.consent?.captureConsented) return undefined;

  const { mime, bytes } = decodeDataUrl(input.dataUrl);
  const assetId = newId("asset");
  const now = new Date();

  // Retention: unless the customer consented to saving images, the source
  // carries an expiry and is swept. It is NEVER stored publicly.
  const saved = false; // saving is an explicit later action, even with consent
  const expiresAt = new Date(
    now.getTime() + RETENTION.unsavedSourceMs,
  ).toISOString();

  await store.putAsset({
    id: assetId,
    kind: "source",
    sessionId,
    mime,
    width: input.width,
    height: input.height,
    bytes,
    createdAt: now.toISOString(),
    expiresAt,
    saved,
  });

  const ref: SourceImageRef = {
    id: assetId,
    sessionId,
    mime,
    width: input.width,
    height: input.height,
    createdAt: now.toISOString(),
    expiresAt,
    saved,
  };
  await store.putSourceImage(ref);
  await store.updateSession(sessionId, {
    sourceImageId: assetId,
    stage: "style",
  });
  await audit(sessionId, "capture_stored", DEV_STYLIST_ID, {
    assetId,
    faceCount: input.preflight.faceCount,
    engine: input.preflight.engine,
    expiresAt,
  });

  const token = await store.issueMediaToken(assetId, RETENTION.mediaTokenMs);
  return { ref, token: token.token };
}

export async function createGenerationJob(
  sessionId: string,
  input: CreateJobInput,
): Promise<GenerationJob | undefined> {
  const store = getStore();
  const session = await store.getSession(sessionId);
  if (!session || !session.sourceImageId) return undefined;
  const preset = getStylePreset(input.styleId);
  if (!preset) return undefined;

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
    maskContractVersion: input.maskSummary.version,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await store.createJob(job);
  await store.updateSession(sessionId, {
    selectedStyleId: input.styleId,
    stage: "generating",
  });
  await audit(sessionId, "job_created", DEV_STYLIST_ID, {
    jobId: job.id,
    styleId: input.styleId,
    candidateCount: input.candidateCount,
  });

  // Fire-and-forget worker simulation. UI polls status.
  void processJob(job.id, { attempt: 1 }).catch(() => {
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
  const updated = await store.updateJob(jobId, {
    status: "created",
    attempts: nextAttempt,
    failureReason: undefined,
    candidateIds: [],
  });
  await audit(job.sessionId, "job_created", DEV_STYLIST_ID, {
    jobId,
    retry: true,
    attempt: nextAttempt,
  });
  void processJob(jobId, { attempt: nextAttempt }).catch(() => {});
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
    await audit(sessionId, "result_discarded", DEV_STYLIST_ID, {});
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
  await audit(sessionId, "result_saved", DEV_STYLIST_ID, {
    savedCandidateIds: candidateIds,
  });
  return updated;
}
