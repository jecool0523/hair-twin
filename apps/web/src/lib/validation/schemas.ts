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

// Source image is uploaded as a data URL (browser capture/upload). It is stored
// server-side as bytes; the data URL is not persisted as-is or echoed in JSON.
export const sourceImageSchema = z.object({
  dataUrl: z
    .string()
    .regex(
      /^data:image\/(png|jpeg|jpg|webp);base64,/,
      "dataUrl must be a base64 image data URL",
    ),
  width: z.number().int().positive().max(8000),
  height: z.number().int().positive().max(8000),
  preflight: z.object({
    faceCount: z.number().int().nonnegative(),
    passed: z.boolean(),
    engine: z.enum(["mediapipe", "heuristic"]),
  }),
});

export const maskSummarySchema = z.object({
  version: z.string(),
  hairCurrentCoverage: z.number().min(0).max(1),
  hairEditCoverage: z.number().min(0).max(1),
  faceProtectCoverage: z.number().min(0).max(1),
  backgroundProtectCoverage: z.number().min(0).max(1),
  expansionRadius: z.number().min(0).max(64),
});

export const createJobSchema = z.object({
  styleId: z.string().min(1),
  candidateCount: z.number().int().min(1).max(4).default(3),
  maskSummary: maskSummarySchema,
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
export type SourceImageInput = z.infer<typeof sourceImageSchema>;
export type CreateJobInput = z.infer<typeof createJobSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type SaveDecisionInput = z.infer<typeof saveDecisionSchema>;
