/**
 * Provider Adapter contract (ADR-0002, ai-generation-design §8).
 *
 * Product code depends ONLY on these types, never on a specific provider's
 * request/response shape. Mock and real providers implement the same interface,
 * so swapping providers requires no product/UI change.
 */
import type { GenerationMode, QualitySignals, StylePreset } from "../domain/types";
import type { MaskName } from "../domain/masks";

/**
 * The real mask contract handed to a provider.
 *
 * IMPORTANT — these are RAW MASK GRIDS, not provider-ready images.
 *
 * Each asset is an uncompressed byte-per-cell grid (`application/octet-stream`)
 * at the SEGMENTATION resolution given by `width`/`height` — typically ~48x64 —
 * which is NOT the source photo's resolution. They cannot be handed to an
 * image-editing API as-is. Converting a raw grid into a provider-ready mask
 * (resize to the source, decide alpha polarity, PNG-encode) is a separate step
 * that no code performs yet; see ADR-0006 for the checklist that step must
 * satisfy.
 *
 * Nothing here is client-asserted: `coverage` was derived server-side from the
 * region map (ADR-0006).
 */
export interface MaskContractRef {
  contractId: string;
  version: string;
  attempt: number;
  /** Cells the hair mask may grow into. Retries shrink this. */
  expansionRadius: number;
  /** Mask GRID size — deliberately not the source image size. */
  width: number;
  height: number;
  /** Private-store asset id per mask name (hair_edit, face_protect, …). */
  assetIds: Record<MaskName, string>;
  regionMapAssetId: string;
  /** Server-derived coverage ratios, 0..1. */
  coverage: Record<MaskName, number>;
}

export interface HairGenerationRequest {
  jobId: string;
  seed: number;
  candidateCount: number;
  mode: GenerationMode;
  preset: StylePreset;
  /** Reference to the source image bytes in the private store (not the bytes). */
  sourceAssetId: string;
  sourceWidth: number;
  sourceHeight: number;
  /** The real, persisted masks for this job. */
  masks: MaskContractRef;
  constraints: {
    preserveIdentity: true;
    preserveBackground: true;
    preserveExpression: true;
    allowHairExpansion: boolean;
  };
  prompt: { positive: string; negative: string };
}

export interface ProviderCandidate {
  /** Encoded image bytes (PNG) for the candidate. */
  image: Buffer;
  mime: string;
  seed: number;
  /**
   * Measured quality signals for this candidate. In the real worker these come
   * from CV models; the mock adapter emits deterministic signals. QualityStatus
   * is decided later by the product's own quality gate (domain/quality.ts).
   */
  signals: QualitySignals;
  rawProviderMetadata: Record<string, unknown>;
}

export interface HairGenerationResult {
  provider: string;
  model: string;
  modelVersion?: string;
  candidates: ProviderCandidate[];
}

export class ProviderError extends Error {
  retryable: boolean;
  userMessageKo: string;
  constructor(opts: {
    message: string;
    retryable: boolean;
    userMessageKo: string;
  }) {
    super(opts.message);
    this.name = "ProviderError";
    this.retryable = opts.retryable;
    this.userMessageKo = opts.userMessageKo;
  }
}

/**
 * Byte access for providers that need the actual pixels/masks. Kept as a
 * callback so the adapter never holds storage credentials itself, and so the
 * same interface works whether bytes come from the in-memory store or a private
 * Supabase bucket.
 */
export interface ProviderAssetLoader {
  /** The source photo bytes, in its real format (PNG/JPEG/WebP). */
  loadSource(assetId: string): Promise<Buffer | undefined>;
  /**
   * One mask of the job's contract, as a RAW byte-per-cell grid at the
   * segmentation resolution -- NOT a PNG and NOT at source resolution. Named
   * for what it returns: a provider needing an image mask must convert it
   * first (ADR-0006).
   */
  loadRawMaskGrid(assetId: string): Promise<Buffer | undefined>;
}

export interface HairGenerationProvider {
  readonly name: string;
  readonly model: string;
  generate(
    request: HairGenerationRequest,
    assets: ProviderAssetLoader,
  ): Promise<HairGenerationResult>;
}
