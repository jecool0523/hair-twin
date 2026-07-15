/**
 * End-to-end integration test for the first vertical slice, driven through the
 * service layer with the Mock provider + in-memory store (no infra, no secret).
 *
 * Covers: session → consent → capture → job → async candidates → auto-QC →
 * stylist verdict → save, and the discard path + retention, and the
 * save-without-consent guard.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { getStore } from "../store";
import {
  createGenerationJob,
  finalizeDecision,
  recordConsent,
  retryJob,
  setStylistVerdict,
  startSession,
  storeSourceImage,
  VerdictNotAllowedError,
} from "./consultation";
import { buildSessionView } from "./views";
import type { CandidateView } from "../dto";
import { CONSENT_WORDING_VERSION } from "../config";
import { encodePng } from "../media/png";

const TERMINAL = new Set([
  "completed",
  "needs_stylist_review",
  "failed_hard",
]);

// A tiny valid PNG data URL as a stand-in captured image.
function pngDataUrl(): string {
  const png = encodePng(new Uint8Array(8 * 8 * 4).fill(200), 8, 8);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function waitForTerminal(sessionId: string, jobId: string) {
  for (let i = 0; i < 200; i++) {
    const job = await getStore().getJob(jobId);
    if (job && TERMINAL.has(job.status)) return job;
    if (job && job.status === "failed_retryable") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job did not reach a terminal state");
}

beforeAll(() => {
  process.env.HAIR_TWIN_STORE = "memory";
  delete process.env.HAIR_TWIN_PROVIDER; // default mock
});

describe("consultation full flow (mock provider)", () => {
  it("captures, generates, auto-QCs, and saves with consent", async () => {
    const session = await startSession({
      stylistName: "테스트 미용사",
      customerAlias: "테스트 고객",
    });

    // Consent WITH image saving.
    await recordConsent(session.id, {
      captureConsented: true,
      saveImagesConsented: true,
      saveReportConsented: false,
      wordingVersion: CONSENT_WORDING_VERSION,
    });

    // Capture/upload.
    const src = await storeSourceImage(session.id, {
      dataUrl: pngDataUrl(),
      width: 600,
      height: 800,
      preflight: { faceCount: 1, passed: true, engine: "heuristic" },
    });
    expect(src?.ref.id).toBeTruthy();
    // Source is stored temporarily (not saved) with an expiry.
    expect(src?.ref.saved).toBe(false);
    expect(src?.ref.expiresAt).toBeTruthy();

    // Create the generation job (fires the worker simulation).
    const job = await createGenerationJob(session.id, {
      styleId: "layered-c-curl",
      candidateCount: 3,
      maskSummary: {
        version: "mask-contract-1",
        hairCurrentCoverage: 0.14,
        hairEditCoverage: 0.18,
        faceProtectCoverage: 0.22,
        backgroundProtectCoverage: 0.4,
        expansionRadius: 6,
      },
    });
    expect(job).toBeTruthy();

    const terminal = await waitForTerminal(session.id, job!.id);
    expect(["completed", "needs_stylist_review"]).toContain(terminal.status);

    const view = await buildSessionView(session.id);
    const jobView = view!.jobs.at(-1)!;
    expect(jobView.candidates.length).toBe(3);

    // Policy rule 1+4: BEFORE any stylist verdict, nothing is customer-visible,
    // not even auto-accepted candidates.
    expect(jobView.candidates.every((c) => c.customerVisible === false)).toBe(
      true,
    );
    expect(jobView.approvedCount).toBe(0);
    // Policy rule 3: hard-failed candidates are not even approvable.
    expect(
      jobView.candidates.filter((c) => c.hardFail).every((c) => !c.canApprove),
    ).toBe(true);

    // Stylist approves an accepted candidate -> it becomes customer-visible.
    const usable = jobView.candidates.find(
      (c) => c.qualityStatus === "accepted",
    )!;
    expect(usable.canApprove).toBe(true);
    await setStylistVerdict(usable.id, "usable");

    const afterApproval = await buildSessionView(session.id);
    const jobAfter = afterApproval!.jobs.at(-1)!;
    expect(jobAfter.approvedCount).toBe(1);
    expect(
      jobAfter.candidates.find((c) => c.id === usable.id)!.customerVisible,
    ).toBe(true);

    const saved = await finalizeDecision(session.id, "save", [usable.id]);
    expect(saved?.stage).toBe("saved");

    // The saved candidate asset is retained (no expiry, saved flag).
    const cand = await getStore().getCandidate(usable.id);
    const assetAfter = await getStore().getAsset(cand!.assetId);
    expect(assetAfter?.saved).toBe(true);
    expect(assetAfter?.expiresAt).toBeUndefined();

    // Audit trail exists.
    const audit = await getStore().listAudit(session.id);
    const actions = audit.map((a) => a.action);
    expect(actions).toContain("session_started");
    expect(actions).toContain("consent_recorded");
    expect(actions).toContain("capture_stored");
    expect(actions).toContain("job_created");
    expect(actions).toContain("result_saved");
  });

  it("enforces the customer exposure policy end-to-end", async () => {
    const session = await startSession({
      stylistName: "정책",
      customerAlias: "고객",
    });
    await recordConsent(session.id, {
      captureConsented: true,
      saveImagesConsented: true,
      saveReportConsented: false,
      wordingVersion: CONSENT_WORDING_VERSION,
    });
    await storeSourceImage(session.id, {
      dataUrl: pngDataUrl(),
      width: 400,
      height: 500,
      preflight: { faceCount: 1, passed: true, engine: "heuristic" },
    });
    const job = await createGenerationJob(session.id, {
      styleId: "layered-c-curl",
      candidateCount: 3,
      maskSummary: {
        version: "mask-contract-1",
        hairCurrentCoverage: 0.14,
        hairEditCoverage: 0.18,
        faceProtectCoverage: 0.22,
        backgroundProtectCoverage: 0.4,
        expansionRadius: 6,
      },
    });
    await waitForTerminal(session.id, job!.id);

    const pick = async (fn: (c: CandidateView) => boolean) => {
      const v = await buildSessionView(session.id);
      return v!.jobs.at(-1)!.candidates.find(fn);
    };
    const visibilityOf = async (id: string) => {
      const v = await buildSessionView(session.id);
      return v!.jobs.at(-1)!.candidates.find((c) => c.id === id)!.customerVisible;
    };

    // Reported case 1: accepted + 재생성 verdict => NOT visible.
    const accepted = (await pick((c) => c.qualityStatus === "accepted"))!;
    await setStylistVerdict(accepted.id, "regenerate");
    expect(await visibilityOf(accepted.id)).toBe(false);

    // Reported case 3: accepted with no verdict => NOT visible (a second
    // accepted candidate, still unreviewed).
    const untouched = await pick(
      (c) => c.qualityStatus === "accepted" && c.id !== accepted.id,
    );
    if (untouched) expect(await visibilityOf(untouched.id)).toBe(false);

    // Reported case 2: needs_stylist_review + usable => visible.
    const review = await pick((c) => c.qualityStatus === "needs_stylist_review");
    expect(review, "mock must produce a needs_stylist_review candidate").toBeDefined();
    expect(review!.canApprove).toBe(true);
    await setStylistVerdict(review!.id, "usable");
    expect(await visibilityOf(review!.id)).toBe(true);

    // Bypass prevention: approving a hard-failed candidate is rejected by the
    // SERVER, and it never becomes visible.
    const blocked = await pick((c) => c.hardFail);
    expect(blocked, "mock must produce a hard-failed candidate").toBeDefined();
    expect(blocked!.canApprove).toBe(false);
    await expect(setStylistVerdict(blocked!.id, "usable")).rejects.toThrow(
      VerdictNotAllowedError,
    );
    expect(await visibilityOf(blocked!.id)).toBe(false);

    // Bypass prevention: an unapproved candidate cannot be saved either.
    await expect(
      finalizeDecision(session.id, "save", [accepted.id]),
    ).rejects.toThrow(VerdictNotAllowedError);
  });

  it("blocks saving without image-save consent and discards + expires assets", async () => {
    const session = await startSession({
      stylistName: "테스트",
      customerAlias: "익명",
    });
    await recordConsent(session.id, {
      captureConsented: true,
      saveImagesConsented: false, // no save consent
      saveReportConsented: false,
      wordingVersion: CONSENT_WORDING_VERSION,
    });
    await storeSourceImage(session.id, {
      dataUrl: pngDataUrl(),
      width: 400,
      height: 500,
      preflight: { faceCount: 1, passed: true, engine: "heuristic" },
    });
    const job = await createGenerationJob(session.id, {
      styleId: "see-through-bob",
      candidateCount: 2,
      maskSummary: {
        version: "mask-contract-1",
        hairCurrentCoverage: 0.12,
        hairEditCoverage: 0.16,
        faceProtectCoverage: 0.2,
        backgroundProtectCoverage: 0.4,
        expansionRadius: 6,
      },
    });
    await waitForTerminal(session.id, job!.id);

    // Saving without consent must be rejected.
    await expect(
      finalizeDecision(session.id, "save", []),
    ).rejects.toThrow(/consent/);

    // Discard force-expires the source asset immediately.
    const sess = await getStore().getSession(session.id);
    const discarded = await finalizeDecision(session.id, "discard", []);
    expect(discarded?.stage).toBe("discarded");
    expect(await getStore().getAsset(sess!.sourceImageId!)).toBeUndefined();

    // The view must not claim a source that no longer exists: hasSource
    // reflects the actual asset, not a dangling id.
    const view = await buildSessionView(session.id);
    expect(view!.hasSource).toBe(false);
    expect(view!.sourceUrl).toBeUndefined();
  });

  it("rejects capture without consent", async () => {
    const session = await startSession({
      stylistName: "t",
      customerAlias: "c",
    });
    const result = await storeSourceImage(session.id, {
      dataUrl: pngDataUrl(),
      width: 100,
      height: 100,
      preflight: { faceCount: 1, passed: true, engine: "heuristic" },
    });
    expect(result).toBeUndefined();
  });

  it("can retry a retryable job", async () => {
    const session = await startSession({ stylistName: "t", customerAlias: "c" });
    await recordConsent(session.id, {
      captureConsented: true,
      saveImagesConsented: false,
      saveReportConsented: false,
      wordingVersion: CONSENT_WORDING_VERSION,
    });
    await storeSourceImage(session.id, {
      dataUrl: pngDataUrl(),
      width: 300,
      height: 400,
      preflight: { faceCount: 1, passed: true, engine: "heuristic" },
    });
    const job = await createGenerationJob(session.id, {
      styleId: "long-wave",
      candidateCount: 2,
      maskSummary: {
        version: "mask-contract-1",
        hairCurrentCoverage: 0.14,
        hairEditCoverage: 0.18,
        faceProtectCoverage: 0.22,
        backgroundProtectCoverage: 0.4,
        expansionRadius: 6,
      },
    });
    await waitForTerminal(session.id, job!.id);
    // Force the job into a retryable state, then retry.
    await getStore().updateJob(job!.id, { status: "failed_retryable" });
    const retried = await retryJob(job!.id);
    expect(retried!.attempts).toBe(2);
    const terminal = await waitForTerminal(session.id, job!.id);
    expect(TERMINAL.has(terminal.status) || terminal.status === "failed_retryable").toBe(
      true,
    );
  });
});
