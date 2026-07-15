/**
 * Client-safe DTOs. The client never receives image bytes or provider secrets —
 * only short-lived media tokens (signed-URL analog) and domain state.
 */
import "server-only";
import { getStore } from "../store";
import { RETENTION } from "../config";
import {
  canStylistApprove,
  isCustomerVisible,
  notApprovableReason,
} from "../domain/visibility";
import type { CandidateView, JobView, SessionView } from "../dto";

export type { CandidateView, JobView, SessionView } from "../dto";

export async function buildSessionView(
  sessionId: string,
): Promise<SessionView | undefined> {
  const store = getStore();
  const session = await store.getSession(sessionId);
  if (!session) return undefined;

  // `hasSource` reflects whether the bytes actually still exist, not merely
  // whether the session holds an id. After a discard (or a retention sweep) the
  // asset is gone, and the session must not claim to still have a source.
  let sourceUrl: string | undefined;
  let hasSource = false;
  if (session.sourceImageId) {
    const asset = await store.getAsset(session.sourceImageId);
    if (asset) {
      hasSource = true;
      const t = await store.issueMediaToken(
        session.sourceImageId,
        RETENTION.mediaTokenMs,
      );
      sourceUrl = `/api/media/${t.token}`;
    }
  }

  const jobs: JobView[] = [];
  for (const job of await store.listJobsForSession(sessionId)) {
    const candidates: CandidateView[] = [];
    for (const c of await store.listCandidatesForJob(job.id)) {
      const t = await store.issueMediaToken(
        c.assetId,
        RETENTION.mediaTokenMs,
      );
      candidates.push({
        id: c.id,
        jobId: c.jobId,
        variantLabel: c.variantLabel,
        mediaUrl: `/api/media/${t.token}`,
        qualityStatus: c.quality.status,
        // Derived now, from the current verdict — never a QC-time snapshot.
        customerVisible: isCustomerVisible(c.quality, c.stylistVerdict),
        canApprove: canStylistApprove(c.quality),
        notApprovableReason: notApprovableReason(c.quality),
        hardFail: c.quality.hardFail,
        softFlags: c.quality.softFlags,
        hardReasons: c.quality.hardReasons,
        signals: {
          identitySimilarity: round(c.quality.signals.identitySimilarity),
          nonHairDiff: round(c.quality.signals.nonHairDiff),
          realismScore: round(c.quality.signals.realismScore),
          styleMatch: round(c.quality.signals.styleMatch),
          landmarkDelta: round(c.quality.signals.landmarkDelta),
        },
        stylistVerdict: c.stylistVerdict,
      });
    }
    jobs.push({
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      failureReason: job.failureReason,
      candidates,
      approvedCount: candidates.filter((c) => c.customerVisible).length,
    });
  }

  return {
    id: session.id,
    stage: session.stage,
    customerAlias: session.customerAlias,
    selectedStyleId: session.selectedStyleId,
    hasSource,
    sourceUrl,
    consent: session.consent
      ? {
          saveImagesConsented: session.consent.saveImagesConsented,
          saveReportConsented: session.consent.saveReportConsented,
          wordingVersion: session.consent.wordingVersion,
        }
      : undefined,
    note: session.note,
    jobs,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
