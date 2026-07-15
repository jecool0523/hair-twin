/**
 * Provider Adapter contract (ADR-0002, ai-generation-design §8).
 *
 * Product code depends ONLY on these types, never on a specific provider's
 * request/response shape. Mock and real providers implement the same interface,
 * so swapping providers requires no product/UI change.
 */
import type { GenerationMode, QualitySignals, StylePreset } from "../domain/types";
import type { MaskSummary } from "../domain/masks";

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
  maskSummary: MaskSummary;
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

export interface HairGenerationProvider {
  readonly name: string;
  readonly model: string;
  generate(
    request: HairGenerationRequest,
    getSourceBytes: (assetId: string) => Promise<Buffer | undefined>,
  ): Promise<HairGenerationResult>;
}
