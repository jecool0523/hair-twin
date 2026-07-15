/**
 * OpenAI image-editing provider (ADR-0002 first benchmark candidate).
 *
 * This is the real-provider path behind the SAME adapter interface as the mock.
 * It is intentionally NOT the default: without OPENAI_API_KEY the app uses the
 * mock, and swapping to this provider requires no product/UI change.
 *
 * IMPORTANT: this runs server-side only. The API key is read from the server
 * environment and never reaches the browser. In the target architecture the
 * heavy call + real QC scoring lives in the Python AI worker; this adapter is a
 * thin bridge so the Next.js worker-simulation can call a real API during a
 * spike. Full mask upload + CV-based Quality signals are a documented next step
 * (see docs/decisions/ADR-0003).
 */
import type {
  HairGenerationProvider,
  HairGenerationRequest,
  HairGenerationResult,
} from "./adapter";
import { ProviderError } from "./adapter";

export class OpenAIHairProvider implements HairGenerationProvider {
  readonly name = "openai";
  readonly model: string;
  #apiKey: string;

  constructor(apiKey: string, model = "gpt-image-1") {
    this.#apiKey = apiKey;
    this.model = model;
  }

  async generate(
    request: HairGenerationRequest,
    getSourceBytes: (assetId: string) => Promise<Buffer | undefined>,
  ): Promise<HairGenerationResult> {
    const source = await getSourceBytes(request.sourceAssetId);
    if (!source) {
      throw new ProviderError({
        message: "source image bytes missing",
        retryable: false,
        userMessageKo: "원본 이미지를 찾을 수 없습니다. 다시 촬영해 주세요.",
      });
    }

    // NOTE: real implementation should send source + hair_edit mask PNG to
    // /v1/images/edits, then run CV-based QC to fill QualitySignals. That work
    // belongs in the Python worker (workers/ai-worker). This bridge is left as
    // an explicit not-yet-wired path so the interface is honest.
    throw new ProviderError({
      message: "OpenAI adapter is scaffolded but not wired for the first slice",
      retryable: false,
      userMessageKo:
        "실제 OpenAI 생성 경로는 아직 연결되지 않았습니다. 현재는 Mock provider로 상담 흐름을 진행합니다.",
    });
  }
}
