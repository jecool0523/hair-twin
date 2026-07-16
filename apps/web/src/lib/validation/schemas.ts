/**
 * Zod schemas for API route inputs. Validation happens at the trust boundary
 * (server route handlers) before anything touches the store.
 */
import { z } from "zod";

export const startSessionSchema = z.object({
  stylistName: z.string().min(1).max(60).default("개발용 미용사"),
  customerAlias: z.string().min(1).max(60).default("익명 고객"),
});

export const consentSchema = z.object({
  captureConsented: z.literal(true),
  saveImagesConsented: z.boolean(),
  saveReportConsented: z.boolean(),
  wordingVersion: z.string().min(1),
});

/**
 * Capture preflight metadata.
 *
 * AUDIT ONLY. These are the browser's own observations about capture quality;
 * they are recorded so a stylist can see why a photo was flagged, and they are
 * never used as QC input or as authority over the image. Width/height are NOT
 * accepted from the client at all — the server reads them from the bytes
 * (see lib/media/image-probe.ts).
 */
export const preflightMetaSchema = z.object({
  faceCount: z.number().int().nonnegative().max(50).default(0),
  passed: z.boolean().default(false),
  engine: z.enum(["mediapipe", "heuristic"]).default("heuristic"),
});

/**
 * Job creation references a PERSISTED mask contract by id. The client no longer
 * sends a mask summary: coverage is whatever the server derived from the real
 * region-map bytes at capture time (ADR-0006).
 */
export const createJobSchema = z.object({
  styleId: z.string().min(1),
  candidateCount: z.number().int().min(1).max(4).default(3),
  maskContractId: z.string().min(1),
});

export const decisionSchema = z.object({
  candidateId: z.string().min(1),
  verdict: z.enum(["usable", "needs_manual_review", "regenerate"]),
});

export const saveDecisionSchema = z.object({
  action: z.enum(["save", "discard"]),
  candidateIds: z.array(z.string()).default([]),
});

export type StartSessionInput = z.infer<typeof startSessionSchema>;
export type ConsentInput = z.infer<typeof consentSchema>;
export type PreflightMeta = z.infer<typeof preflightMetaSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type SaveDecisionInput = z.infer<typeof saveDecisionSchema>;
