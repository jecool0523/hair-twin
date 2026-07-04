import { GoogleGenAI } from "@google/genai";
import { EMPTY_QUALITY_CHECK } from "../constants";
import { GeneratedCandidate, GenerationRequest, HairStylePreset, ProviderStatus } from "../types";

const HAIR_TWIN_PROMPT_PRINCIPLES = `
Hair Twin salon consultation constraints:
- Preserve the customer's face identity exactly.
- Preserve facial structure, skin tone, expression, pose, body, clothing, and background.
- Modify only hairstyle, hair length, hair color, volume, curl, and texture.
- Do not beautify the face or create a social media filter look.
- Make the result look like a natural, realistic salon consultation preview.
- Avoid changing non-hair regions. Keep the photo composition and lighting stable.
`;

const cleanBase64 = (dataUrl: string) =>
  dataUrl.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, "");

const createCandidateId = () =>
  `candidate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const buildHairStylePrompt = (
  style: HairStylePreset,
  variantIndex: number,
  consultationNote?: string
) => {
  const variantGuidance = [
    "conservative and realistic version with minimal non-hair change",
    "slightly more expressive salon proposal while still natural",
    "balanced premium consultation version with clear style readability"
  ][(variantIndex - 1) % 3];

  return `${HAIR_TWIN_PROMPT_PRINCIPLES}

Selected hairstyle preset:
- Korean display name: ${style.nameKo}
- Normalized style description: ${style.normalizedDescription}
- Consultation summary: ${style.consultationSummary}
- Variant direction: ${variantGuidance}
${consultationNote ? `- Stylist note to consider: ${consultationNote}` : ""}

Return a photorealistic result image. The customer should recognize themselves immediately.`;
};

const createCandidate = (
  image: string,
  request: GenerationRequest,
  prompt: string,
  variantIndex: number,
  provider: "gemini" | "mock",
  durationMs: number,
  providerStatus: ProviderStatus,
  warning?: string
): GeneratedCandidate => ({
  id: createCandidateId(),
  image,
  styleId: request.style.id,
  styleName: request.style.nameKo,
  variantLabel: `후보 ${((variantIndex - 1) % 3) + 1}`,
  status: "needs_review",
  qualityCheck: { ...EMPTY_QUALITY_CHECK },
  metadata: {
    provider,
    providerStatus,
    styleId: request.style.id,
    styleName: request.style.nameKo,
    prompt,
    variantIndex,
    createdAt: new Date().toISOString(),
    durationMs,
    generationMode: "hair_style_simulation",
    isMock: provider === "mock",
    warning
  }
});

const drawMockHair = (
  ctx: CanvasRenderingContext2D,
  style: HairStylePreset,
  variantIndex: number,
  targetWidth: number,
  targetHeight: number
) => {
  const headX = targetWidth / 2;
  const headY = targetHeight * 0.28;
  const variantShift = ((variantIndex - 1) % 3) - 1;
  const hairWidth = targetWidth * (0.19 + Math.abs(variantShift) * 0.012);
  const baseHeight =
    style.mockProfile === "long"
      ? targetHeight * 0.29
      : style.mockProfile === "short"
        ? targetHeight * 0.145
        : targetHeight * 0.205;
  const hairHeight = baseHeight + variantShift * 14;
  const hairColor =
    style.id === "ash-brown-tone-down"
      ? "#8b7b72"
      : style.id === "balayage"
        ? "#c08a47"
        : style.id === "long-wave"
          ? "#5a3b2f"
          : style.id === "volume-magic"
            ? "#252221"
            : style.accent;

  const gradient = ctx.createLinearGradient(headX - hairWidth, headY, headX + hairWidth, headY + hairHeight);
  gradient.addColorStop(0, "rgba(20, 15, 14, 0.85)");
  gradient.addColorStop(0.45, `${hairColor}d9`);
  gradient.addColorStop(1, `${hairColor}88`);

  ctx.save();
  ctx.shadowColor = `${hairColor}99`;
  ctx.shadowBlur = 18;
  ctx.fillStyle = gradient;

  ctx.beginPath();
  if (style.mockProfile === "short") {
    ctx.ellipse(headX, headY + 14, hairWidth * 0.92, hairHeight * 0.78, 0, Math.PI, 0);
    ctx.lineTo(headX + hairWidth * 0.88, headY + hairHeight * 0.68);
    ctx.quadraticCurveTo(headX, headY + hairHeight * 0.92, headX - hairWidth * 0.88, headY + hairHeight * 0.68);
  } else if (style.mockProfile === "sleek") {
    ctx.moveTo(headX - hairWidth * 0.9, headY - 8);
    ctx.quadraticCurveTo(headX, headY - hairHeight * 0.55, headX + hairWidth * 0.9, headY - 8);
    ctx.lineTo(headX + hairWidth * 0.72, headY + hairHeight);
    ctx.quadraticCurveTo(headX, headY + hairHeight * 1.12, headX - hairWidth * 0.72, headY + hairHeight);
    ctx.closePath();
  } else {
    ctx.moveTo(headX - hairWidth, headY);
    ctx.bezierCurveTo(headX - hairWidth * 1.2, headY + hairHeight * 0.28, headX - hairWidth * 0.82, headY + hairHeight, headX - hairWidth * 0.42, headY + hairHeight * 1.2);
    ctx.bezierCurveTo(headX - hairWidth * 0.12, headY + hairHeight * 1.35, headX + hairWidth * 0.12, headY + hairHeight * 1.35, headX + hairWidth * 0.42, headY + hairHeight * 1.2);
    ctx.bezierCurveTo(headX + hairWidth * 0.82, headY + hairHeight, headX + hairWidth * 1.2, headY + hairHeight * 0.28, headX + hairWidth, headY);
    ctx.quadraticCurveTo(headX, headY - hairHeight * 0.52, headX - hairWidth, headY);
  }
  ctx.fill();

  if (style.mockProfile === "wave" || style.id === "long-wave" || style.id === "hush-cut") {
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.lineWidth = 5;
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(headX + i * hairWidth * 0.22, headY + 34);
      ctx.bezierCurveTo(
        headX + i * hairWidth * 0.22 + 32,
        headY + hairHeight * 0.38,
        headX + i * hairWidth * 0.22 - 28,
        headY + hairHeight * 0.78,
        headX + i * hairWidth * 0.22 + 12,
        headY + hairHeight
      );
      ctx.stroke();
    }
  }

  if (style.id === "balayage") {
    ctx.strokeStyle = "rgba(253, 230, 138, 0.62)";
    ctx.lineWidth = 10;
    for (let i = -2; i <= 2; i += 1) {
      ctx.beginPath();
      ctx.moveTo(headX + i * hairWidth * 0.25, headY + hairHeight * 0.44);
      ctx.lineTo(headX + i * hairWidth * 0.18, headY + hairHeight * 1.08);
      ctx.stroke();
    }
  }

  ctx.restore();
};

const makeMockCandidateImage = async (
  sourceImage: string,
  style: HairStylePreset,
  variantIndex: number
): Promise<string> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const targetWidth = 1080;
      const targetHeight = 1440;
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(sourceImage);
        return;
      }

      ctx.fillStyle = "#05070a";
      ctx.fillRect(0, 0, targetWidth, targetHeight);

      const scale = Math.min(targetWidth / img.width, targetHeight / img.height);
      const width = img.width * scale;
      const height = img.height * scale;
      const x = (targetWidth - width) / 2;
      const y = (targetHeight - height) / 2;
      ctx.drawImage(img, x, y, width, height);

      drawMockHair(ctx, style, variantIndex, targetWidth, targetHeight);

      ctx.fillStyle = "rgba(5, 14, 20, 0.78)";
      ctx.fillRect(0, targetHeight - 164, targetWidth, 164);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 44px Arial";
      ctx.fillText(`Hair Twin ${variantIndex}`, 48, targetHeight - 92);
      ctx.font = "500 32px Arial";
      ctx.fillStyle = style.accent;
      ctx.fillText(style.nameKo, 48, targetHeight - 44);

      resolve(canvas.toDataURL("image/png", 0.92));
    };
    img.src = sourceImage;
  });

interface ImageGenerationProvider {
  generateCandidates(request: GenerationRequest): Promise<GeneratedCandidate[]>;
}

class MockHairProvider implements ImageGenerationProvider {
  async generateCandidates(request: GenerationRequest): Promise<GeneratedCandidate[]> {
    const startedAt = performance.now();
    const start = request.variantStart ?? 1;
    const candidates: GeneratedCandidate[] = [];

    for (let index = 0; index < request.count; index += 1) {
      const variantIndex = start + index;
      const prompt = buildHairStylePrompt(request.style, variantIndex, request.consultationNote);
      const image = await makeMockCandidateImage(request.sourceImage, request.style, variantIndex);
      candidates.push(
        createCandidate(
          image,
          request,
          prompt,
          variantIndex,
          "mock",
          Math.round(performance.now() - startedAt),
          "api_key_missing",
          "VITE_GEMINI_API_KEY가 없어 mock preview provider로 생성되었습니다."
        )
      );
    }

    return candidates;
  }
}

class GeminiHairProvider implements ImageGenerationProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateCandidates(request: GenerationRequest): Promise<GeneratedCandidate[]> {
    const start = request.variantStart ?? 1;
    const startedAt = performance.now();

    return Promise.all(
      Array.from({ length: request.count }, async (_, index) => {
        const variantIndex = start + index;
        const prompt = buildHairStylePrompt(request.style, variantIndex, request.consultationNote);
        const response = await this.ai.models.generateContent({
          model: "gemini-2.5-flash-image",
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: cleanBase64(request.sourceImage)
                }
              },
              { text: prompt }
            ]
          }
        });

        const parts = response.candidates?.[0]?.content?.parts ?? [];
        const imagePart = parts.find((part) => part.inlineData?.data);

        if (!imagePart?.inlineData?.data) {
          throw new Error("이미지 생성 응답에서 결과 이미지를 찾지 못했습니다.");
        }

        return createCandidate(
          `data:image/png;base64,${imagePart.inlineData.data}`,
          request,
          prompt,
          variantIndex,
          "gemini",
          Math.round(performance.now() - startedAt),
          "gemini_ready"
        );
      })
    );
  }
}

export const getGenerationProviderStatus = (): ProviderStatus =>
  import.meta.env.VITE_GEMINI_API_KEY ? "gemini_ready" : "api_key_missing";

const createProvider = (): ImageGenerationProvider => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  return apiKey ? new GeminiHairProvider(apiKey) : new MockHairProvider();
};

export const generateHairStyleCandidates = (request: GenerationRequest) =>
  request.forceMock ? new MockHairProvider().generateCandidates(request) : createProvider().generateCandidates(request);
