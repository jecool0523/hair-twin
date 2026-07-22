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

    // The hair-edit mask is reachable through the adapter, but it is a RAW GRID
    // and CANNOT be posted to /v1/images/edits as-is. Do not be tempted:
    //
    //   * It is `application/octet-stream`, one byte per cell — not a PNG.
    //   * It is at the segmentation resolution (request.masks.width/height,
    //     ~48x64), while the API requires a mask the same size as the source
    //     (request.sourceWidth/Height, e.g. 480x640).
    //   * Our convention is 1 = "edit here". OpenAI reads TRANSPARENT pixels as
    //     the editable area, so the polarity has to be decided and inverted
    //     deliberately, not assumed.
    //
    // A `toProviderMask()` conversion (resize -> alpha polarity -> PNG encode)
    // must exist before this call can be written. ADR-0006 carries the checklist
    // it has to satisfy. That work is intentionally not done here: it belongs
    // with the Python worker alongside real CV QualitySignals, and it must not
    // ship before the offshore-transfer privacy review (customer faces leaving
    // Korea) is signed off.
    const rawMaskGrid = await assets.loadRawMaskGrid(
      request.masks.assetIds.hair_edit,
    );
    if (!rawMaskGrid) {
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
