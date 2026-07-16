/**
 * Generation worker (in-process simulation of workers/ai-worker).
 *
 * Drives a job through its lifecycle (design §13), calls the Provider Adapter,
 * stores candidate bytes privately, runs the automated quality gate on each
 * candidate, and sets the terminal job status. Runs asynchronously so the UI
 * polls job status while it works.
 *
 * In production this logic moves to the Python AI worker; the boundary (adapter
 * + store + quality domain) is identical, so that move requires no UI change.
 */
import "server-only";
import { getStore, newId } from "../store";
import { createProvider } from "../providers/factory";
import { ProviderError } from "../providers/adapter";
import type {
  MaskContractRef,
  ProviderAssetLoader,
} from "../providers/adapter";
import { loadMaskContractForJob, MaskRejected } from "./masks";
import { evaluateQuality } from "../domain/quality";
import { buildHairPrompt } from "../domain/prompt";
import { getStylePreset } from "../domain/style-presets";
import { canRetry } from "../domain/job";
import { RETENTION } from "../config";
import { audit } from "./audit";
import type { GeneratedCandidate, GenerationJob } from "../domain/types";

const DEFAULT_STEP_DELAY = process.env.NODE_ENV === "test" ? 0 : 400;

function sleep(ms: number) {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}

export interface ProcessOptions {
  stepDelayMs?: number;
  attempt?: number; // for retries; 1-based
}

/**
 * Process a single generation job to a terminal state. Safe to await (tests) or
 * fire-and-forget (route handler).
 */
export async function processJob(
  jobId: string,
  opts: ProcessOptions = {},
): Promise<GenerationJob | undefined> {
  const store = getStore();
  const delay = opts.stepDelayMs ?? DEFAULT_STEP_DELAY;
  const attempt = opts.attempt ?? 1;

  let job = await store.getJob(jobId);
  if (!job) return undefined;
  const preset = getStylePreset(job.styleId);
  if (!preset) {
    return store.updateJob(jobId, {
      status: "failed_hard",
      failureReason: "선택한 스타일 프리셋을 찾을 수 없습니다.",
    });
  }

  try {
    await store.updateJob(jobId, { status: "queued" });
    await sleep(delay);
    await store.updateJob(jobId, { status: "masking" });
    await sleep(delay);

    const job2 = await store.getJob(jobId);
    if (!job2) return undefined;

    await store.updateJob(jobId, { status: "generating" });

    const source = await store.getSourceImage(job.sourceImageId);
    if (!source) {
      return store.updateJob(jobId, {
        status: "failed_hard",
        failureReason: "원본 이미지를 찾을 수 없습니다. 다시 촬영해 주세요.",
      });
    }

    // The REAL masks for this job. Coverage was derived server-side from the
    // region map of this very photo; nothing here is hardcoded or client-sent.
    // Retries already re-derived a tighter contract (see retryJob), so the
    // worker simply uses whatever contract the job points at.
    let contract;
    try {
      contract = await loadMaskContractForJob({
        contractId: job2.maskContractId,
        sessionId: job2.sessionId,
        sourceImageId: job2.sourceImageId,
      });
    } catch (err) {
      if (err instanceof MaskRejected) {
        await audit(job.sessionId, "job_failed", "worker", {
          jobId,
          reason: err.message,
        });
        return store.updateJob(jobId, {
          status: "failed_hard",
          failureReason: err.userMessageKo,
        });
      }
      throw err;
    }

    const prompt = buildHairPrompt(preset, { stricter: attempt > 1 });
    const provider = createProvider();

    const masks: MaskContractRef = {
      contractId: contract.id,
      version: contract.version,
      attempt: contract.attempt,
      expansionRadius: contract.expansionRadius,
      width: contract.width,
      height: contract.height,
      assetIds: contract.maskAssetIds as MaskContractRef["assetIds"],
      regionMapAssetId: contract.regionMapAssetId,
      coverage: contract.coverage as MaskContractRef["coverage"],
    };

    const assets: ProviderAssetLoader = {
      loadSource: (assetId) => store.getAsset(assetId).then((a) => a?.bytes),
      loadMask: (assetId) => store.getAsset(assetId).then((a) => a?.bytes),
    };

    const result = await provider.generate(
      {
        jobId,
        seed: 1000 + attempt * 10,
        candidateCount: job.candidateCount,
        mode: job.mode,
        preset,
        sourceAssetId: source.id,
        sourceWidth: source.width,
        sourceHeight: source.height,
        masks,
        constraints: {
          preserveIdentity: true,
          preserveBackground: true,
          preserveExpression: true,
          allowHairExpansion: preset.defaultMode === "hair_inpaint",
        },
        prompt: { positive: prompt.positive, negative: prompt.negative },
      },
      assets,
    );

    await sleep(delay);
    await store.updateJob(jobId, { status: "quality_checking" });

    const candidateIds: string[] = [];
    const savedCandidates: GeneratedCandidate[] = [];
    for (let i = 0; i < result.candidates.length; i++) {
      const pc = result.candidates[i]!;
      const assetId = newId("asset");
      await store.putAsset({
        id: assetId,
        kind: "candidate",
        sessionId: job.sessionId,
        mime: pc.mime,
        width: 432,
        height: 576,
        bytes: pc.image,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(
          Date.now() + RETENTION.unsavedCandidateMs,
        ).toISOString(),
        saved: false,
      });

      const quality = evaluateQuality(pc.signals);
      const candidate: GeneratedCandidate = {
        id: newId("cand"),
        jobId,
        assetId,
        styleId: job.styleId,
        variantLabel: `후보 ${i + 1}`,
        seed: pc.seed,
        quality,
        provider: result.provider,
        model: result.model,
        createdAt: new Date().toISOString(),
      };
      await store.putCandidate(candidate);
      candidateIds.push(candidate.id);
      savedCandidates.push(candidate);
    }

    await sleep(delay);

    // Job-level status: completed if any candidate accepted; else if any needs
    // review, needs_stylist_review; else failed_retryable (nothing usable).
    const anyAccepted = savedCandidates.some(
      (c) => c.quality.status === "accepted",
    );
    const anyReview = savedCandidates.some(
      (c) => c.quality.status === "needs_stylist_review",
    );

    let status: GenerationJob["status"];
    let failureReason: string | undefined;
    if (anyAccepted) {
      status = "completed";
    } else if (anyReview) {
      status = "needs_stylist_review";
    } else {
      status = "failed_retryable";
      failureReason =
        "자동 검수를 통과한 후보가 없습니다. 스타일을 조정하거나 재시도하세요.";
    }

    const updated = await store.updateJob(jobId, {
      status,
      failureReason,
      candidateIds,
    });
    await audit(job.sessionId, status === "completed" ? "job_completed" : "job_failed", "worker", {
      jobId,
      status,
      candidateCount: candidateIds.length,
    });
    return updated;
  } catch (err) {
    const retryable = err instanceof ProviderError ? err.retryable : true;
    const message =
      err instanceof ProviderError
        ? err.userMessageKo
        : "생성 처리 중 예기치 못한 오류가 발생했습니다.";
    const current = await store.getJob(jobId);
    const attempts = current?.attempts ?? attempt;
    const status =
      retryable && canRetry(attempts, "failed_retryable")
        ? "failed_retryable"
        : "failed_hard";
    const updated = await store.updateJob(jobId, {
      status,
      failureReason: message,
    });
    await audit(job.sessionId, "job_failed", "worker", { jobId, message });
    return updated;
  }
}
