/**
 * Mock hair generation provider.
 *
 * Produces deterministic candidate images (procedural PNG, no canvas) and
 * deterministic quality signals so the entire consultation flow runs and is
 * testable without any external API or secret key (handoff §9, quality bar
 * "Mock Provider로 전체 상담 흐름을 완료할 수 있다").
 *
 * Determinism is keyed by (jobId, seed) so retries and tests are reproducible.
 * Some candidates are intentionally generated to FAIL the quality gate, so the
 * "hidden from customer" and "needs stylist review" paths are exercised.
 *
 * NOTE: the signal values are simulated. Real identity/landmark/non-hair
 * metrics come from the Python AI worker's CV models later. The mock does make
 * signals respond to mask size + retry tuning so retries are meaningful.
 */
import { encodePng } from "../media/png";
import type { StylePreset } from "../domain/types";
import type {
  HairGenerationProvider,
  HairGenerationRequest,
  HairGenerationResult,
  ProviderAssetLoader,
  ProviderCandidate,
} from "./adapter";

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const CANDIDATE_W = 432;
const CANDIDATE_H = 576;

/**
 * Render a deterministic procedural "consultation preview" frame. This stands
 * in for a provider's edited output; it is clearly a mock (labelled).
 */
function renderMockCandidate(
  preset: StylePreset,
  variant: number,
  rand: () => number,
): Buffer {
  const w = CANDIDATE_W;
  const h = CANDIDATE_H;
  const rgba = new Uint8Array(w * h * 4);
  const [ar, ag, ab] = hexToRgb(preset.accent);

  // Calm neutral background.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const shade = 236 - Math.floor((y / h) * 26);
      rgba[i] = shade;
      rgba[i + 1] = shade - 4;
      rgba[i + 2] = shade - 8;
      rgba[i + 3] = 255;
    }
  }

  // Head/shoulders placeholder (neutral skin block) — the "preserved" person.
  const cx = w / 2;
  const faceCy = h * 0.42;
  const faceRx = w * 0.2;
  const faceRy = h * 0.24;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / faceRx;
      const dy = (y - faceCy) / faceRy;
      if (dx * dx + dy * dy <= 1) {
        const i = (y * w + x) * 4;
        rgba[i] = 226;
        rgba[i + 1] = 202;
        rgba[i + 2] = 184;
      }
    }
  }

  // Hair silhouette on top, shape/size driven by mockProfile + variant.
  const heightByProfile: Record<StylePreset["mockProfile"], number> = {
    short: 0.16,
    medium: 0.24,
    long: 0.34,
    sleek: 0.2,
    wave: 0.3,
    color: 0.24,
  };
  const hairTop = faceCy - faceRy * 1.05;
  const hairH = h * (heightByProfile[preset.mockProfile] + variant * 0.01);
  const hairRx = faceRx * 1.35;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / hairRx;
      const rel = (y - hairTop) / hairH;
      if (rel < 0 || rel > 1) continue;
      // Rounded crown + falling sides.
      const widthAt = Math.sqrt(Math.max(0, 1 - Math.pow(rel - 0.15, 2) * 1.4));
      if (Math.abs(dx) <= widthAt) {
        // Leave the lower face uncovered so identity reads through.
        if (y > faceCy + faceRy * 0.2 && Math.abs(x - cx) < faceRx * 0.7)
          continue;
        const i = (y * w + x) * 4;
        const n = 0.85 + rand() * 0.3;
        rgba[i] = Math.min(255, ar * n * 0.6 + 20);
        rgba[i + 1] = Math.min(255, ag * n * 0.6 + 16);
        rgba[i + 2] = Math.min(255, ab * n * 0.6 + 14);
      }
    }
  }

  // "MOCK" watermark stripe at the bottom so no one mistakes it for a real edit.
  for (let y = h - 40; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = 30;
      rgba[i + 1] = 30;
      rgba[i + 2] = 36;
      rgba[i + 3] = 235;
    }
  }

  return encodePng(rgba, w, h);
}

export class MockHairProvider implements HairGenerationProvider {
  readonly name = "mock";
  readonly model = "mock-hair-preview-1";

  async generate(
    request: HairGenerationRequest,
    assets?: ProviderAssetLoader,
  ): Promise<HairGenerationResult> {
    const candidates: ProviderCandidate[] = [];
    // Real, server-derived coverage for THIS photo — different captures produce
    // different contracts, so they produce different simulated outcomes.
    const editCoverage = request.masks.coverage.hair_edit;
    const expansion = request.masks.expansionRadius;

    // Prove the adapter can reach the real mask bytes. These are raw grids, so
    // the mock only measures them; a real provider would have to convert them
    // to a provider-ready image first (ADR-0006).
    let hairEditMaskBytes = 0;
    if (assets) {
      const bytes = await assets.loadRawMaskGrid(
        request.masks.assetIds.hair_edit,
      );
      hairEditMaskBytes = bytes?.length ?? 0;
    }

    for (let idx = 0; idx < request.candidateCount; idx++) {
      const seed = request.seed + idx;
      const rand = mulberry32(hashStr(`${request.jobId}:${seed}`));
      const image = renderMockCandidate(request.preset, idx, rand);

      // Deterministic signals. Larger edit mask / expansion => more non-hair
      // risk, so smaller-mask retries improve outcomes (design §13 retry).
      // Scaled so a normal-sized edit mask leaves the "good" candidate below the
      // soft non-hair threshold (a clean accept), while wide masks trend worse.
      const riskBase = Math.min(0.12, editCoverage * 0.15 + expansion * 0.002);

      // Base "good" candidate.
      let identitySimilarity = 0.95 - rand() * 0.03;
      let landmarkDelta = 0.01 + rand() * 0.02;
      let nonHairDiff = riskBase * (0.4 + rand() * 0.3);
      let realismScore = 0.82 - rand() * 0.08;
      let styleMatch = 0.8 - rand() * 0.12;
      const hairCoverageRatio = Math.max(
        0.04,
        Math.min(0.5, editCoverage * (0.8 + rand() * 0.4)),
      );
      let faceCount = 1;

      // Intentional failure patterns to exercise QC branches:
      // - 2nd candidate: borderline => needs_stylist_review
      if (idx === 1) {
        identitySimilarity = 0.87 - rand() * 0.02;
        nonHairDiff = 0.045 + rand() * 0.01;
        styleMatch = 0.55 - rand() * 0.05;
      }
      // - 3rd candidate: hard identity failure => blocked, hidden from customer
      if (idx === 2) {
        identitySimilarity = 0.72 - rand() * 0.05;
        landmarkDelta = 0.09 + rand() * 0.02;
        faceCount = rand() > 0.6 ? 2 : 1;
      }

      candidates.push({
        image,
        mime: "image/png",
        seed,
        signals: {
          identitySimilarity,
          landmarkDelta,
          nonHairDiff,
          hairCoverageRatio,
          faceCount,
          realismScore,
          styleMatch,
        },
        rawProviderMetadata: {
          mock: true,
          variant: idx,
          jobId: request.jobId,
          // Recorded so a stylist/engineer can confirm which real contract
          // produced this candidate.
          maskContractId: request.masks.contractId,
          maskContractAttempt: request.masks.attempt,
          expansionRadius: expansion,
          hairEditCoverage: editCoverage,
          hairEditMaskBytes,
          note: "simulated signals; real metrics come from the Python worker",
        },
      });
    }

    return { provider: this.name, model: this.model, candidates };
  }
}
