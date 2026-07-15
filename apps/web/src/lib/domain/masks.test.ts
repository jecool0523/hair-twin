import { describe, expect, it } from "vitest";
import {
  RegionClass,
  buildMaskSet,
  dilate,
  erode,
  type RegionMap,
} from "./masks";

/** Build a small synthetic region map: face block in center, hair on top row,
 * background sides, body bottom. */
function synthetic(): RegionMap {
  const width = 10;
  const height = 10;
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let cls = RegionClass.Background;
      if (y >= 6) cls = RegionClass.Body;
      else if (y >= 3 && y <= 5 && x >= 3 && x <= 6) cls = RegionClass.Face;
      else if (y <= 2 && x >= 3 && x <= 6) cls = RegionClass.Hair;
      data[y * width + x] = cls;
    }
  }
  return { width, height, data };
}

describe("buildMaskSet", () => {
  it("derives a hair_edit mask that excludes face/body/background cores", () => {
    const region = synthetic();
    const set = buildMaskSet(region, 1);
    const { masks } = set;

    // hair_edit must not overlap the protected background or body.
    for (let i = 0; i < masks.hair_edit.data.length; i++) {
      if (masks.hair_edit.data[i]) {
        expect(masks.background_protect.data[i]).toBe(0);
        expect(masks.body_clothing_protect.data[i]).toBe(0);
      }
    }
    // Coverage numbers are within [0,1].
    Object.values(set.coverage).forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    });
    // Hair edit should include at least the current hair region.
    expect(set.coverage.hair_edit).toBeGreaterThan(0);
  });

  it("expansion mask is the ring around current hair", () => {
    const region = synthetic();
    const set = buildMaskSet(region, 1);
    for (let i = 0; i < set.masks.hair_expansion.data.length; i++) {
      if (set.masks.hair_expansion.data[i]) {
        expect(set.masks.hair_current.data[i]).toBe(0);
      }
    }
  });

  it("throws on malformed region maps", () => {
    expect(() =>
      buildMaskSet({ width: 2, height: 2, data: new Uint8Array(3) }),
    ).toThrow();
  });
});

describe("morphology", () => {
  it("dilate grows and erode shrinks", () => {
    const m = {
      name: "hair_current" as const,
      width: 5,
      height: 5,
      data: new Uint8Array(25),
    };
    m.data[12] = 1; // center
    const d = dilate(m, 1);
    const grown = d.data.reduce((a, b) => a + b, 0);
    expect(grown).toBe(9);
    const e = erode(d, 1);
    const shrunk = e.data.reduce((a, b) => a + b, 0);
    expect(shrunk).toBe(1);
  });
});
