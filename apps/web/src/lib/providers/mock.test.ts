import { describe, expect, it } from "vitest";
import { MockHairProvider } from "./mock";
import { evaluateQuality } from "../domain/quality";
import { canStylistApprove, isCustomerVisible } from "../domain/visibility";
import { getStylePreset } from "../domain/style-presets";
import type { HairGenerationRequest, ProviderAssetLoader } from "./adapter";

/** Stand-in private storage: the adapter reaches mask bytes by reference. */
const loader: ProviderAssetLoader = {
  loadSource: async () => Buffer.alloc(16),
  loadMask: async () => Buffer.alloc(64),
};

function req(count: number): HairGenerationRequest {
  return {
    jobId: "job_test",
    seed: 1000,
    candidateCount: count,
    mode: "hair_inpaint",
    preset: getStylePreset("layered-c-curl")!,
    sourceAssetId: "asset_src",
    sourceWidth: 600,
    sourceHeight: 800,
    masks: {
      contractId: "maskc_test",
      version: "mask-contract-1",
      attempt: 1,
      expansionRadius: 6,
      width: 48,
      height: 64,
      assetIds: {
        hair_current: "a1",
        hair_expansion: "a2",
        face_protect: "a3",
        body_clothing_protect: "a4",
        background_protect: "a5",
        uncertain_boundary: "a6",
        hair_edit: "a7",
      },
      regionMapAssetId: "rm1",
      coverage: {
        hair_current: 0.14,
        hair_expansion: 0.05,
        face_protect: 0.22,
        body_clothing_protect: 0.1,
        background_protect: 0.4,
        uncertain_boundary: 0.03,
        hair_edit: 0.18,
      },
    },
    constraints: {
      preserveIdentity: true,
      preserveBackground: true,
      preserveExpression: true,
      allowHairExpansion: true,
    },
    prompt: { positive: "p", negative: "n" },
  };
}

describe("MockHairProvider", () => {
  it("returns PNG candidates and is deterministic", async () => {
    const p = new MockHairProvider();
    const r1 = await p.generate(req(3), loader);
    const r2 = await p.generate(req(3), loader);
    expect(r1.candidates).toHaveLength(3);
    // PNG signature on each candidate image
    for (const c of r1.candidates) {
      expect([...c.image.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    }
    // Deterministic bytes for the same request
    expect(r1.candidates[0]!.image.equals(r2.candidates[0]!.image)).toBe(true);
  });

  it("produces both an approvable candidate and a hard-blocked one", async () => {
    const p = new MockHairProvider();
    const r = await p.generate(req(3), loader);
    const results = r.candidates.map((c) => evaluateQuality(c.signals));
    // The mock must exercise both branches: something the stylist can approve,
    // and something the quality gate hard-blocks (never approvable).
    expect(results.some((v) => canStylistApprove(v))).toBe(true);
    expect(results.some((v) => v.hardFail)).toBe(true);
    // Nothing is customer-visible without an explicit stylist approval.
    expect(results.every((v) => !isCustomerVisible(v, undefined))).toBe(true);
  });
});
