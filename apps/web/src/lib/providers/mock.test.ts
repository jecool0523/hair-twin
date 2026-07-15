import { describe, expect, it } from "vitest";
import { MockHairProvider } from "./mock";
import { evaluateQuality } from "../domain/quality";
import { canStylistApprove, isCustomerVisible } from "../domain/visibility";
import { getStylePreset } from "../domain/style-presets";
import type { HairGenerationRequest } from "./adapter";

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
    maskSummary: {
      version: "mask-contract-1",
      hairCurrentCoverage: 0.14,
      hairEditCoverage: 0.18,
      faceProtectCoverage: 0.22,
      backgroundProtectCoverage: 0.4,
      expansionRadius: 6,
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
    const r1 = await p.generate(req(3));
    const r2 = await p.generate(req(3));
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
    const r = await p.generate(req(3));
    const results = r.candidates.map((c) => evaluateQuality(c.signals));
    // The mock must exercise both branches: something the stylist can approve,
    // and something the quality gate hard-blocks (never approvable).
    expect(results.some((v) => canStylistApprove(v))).toBe(true);
    expect(results.some((v) => v.hardFail)).toBe(true);
    // Nothing is customer-visible without an explicit stylist approval.
    expect(results.every((v) => !isCustomerVisible(v, undefined))).toBe(true);
  });
});
