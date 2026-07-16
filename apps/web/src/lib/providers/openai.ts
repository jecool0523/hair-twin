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
  ProviderAssetLoader,
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
    assets: ProviderAssetLoader,
  ): Promise<HairGenerationResult> {
    const source = await assets.loadSource(request.sourceAssetId);
    if (!source) {
      throw new ProviderError({
        message: "source image bytes missing",
        retryable: false,
        userMessageKo: "원본 이미지를 찾을 수 없습니다. 다시 촬영해 주세요.",
      });
    }

    // The real hair-edit mask is already reachable through the same adapter
    // contract the mock uses — this is exactly what /v1/images/edits needs as
    // its `mask` part, so wiring the call is a fill-in, not a redesign:
    //
    //   const mask = await assets.loadMask(request.masks.assetIds.hair_edit);
    //   form.append("image", new Blob([source]), "source.png");
    //   form.append("mask", new Blob([mask]), "hair-edit-mask.png");
    //   form.append("prompt", request.prompt.positive);
    //
    // Still deliberately unwired: a real call needs the provider data-processing
    // review (customer faces leaving the country — ADR-0006 privacy boundary)
    // and CV-based QualitySignals, which belong in the Python worker.
    const maskBytes = await assets.loadMask(request.masks.assetIds.hair_edit);
    if (!maskBytes) {
      throw new ProviderError({
        message: "hair_edit mask bytes missing",
        retryable: false,
        userMessageKo:
          "헤어 편집 마스크를 찾을 수 없습니다. 다시 촬영해 주세요.",
      });
    }

    throw new ProviderError({
      message: "OpenAI adapter is scaffolded but not wired (see ADR-0006)",
      retryable: false,
      userMessageKo:
        "실제 OpenAI 생성 경로는 아직 연결되지 않았습니다. 현재는 Mock provider로 상담 흐름을 진행합니다.",
    });
  }
}
