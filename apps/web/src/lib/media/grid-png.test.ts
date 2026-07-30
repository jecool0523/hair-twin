import { describe, expect, it } from "vitest";
import { decodeGridPng, encodeGridPng } from "./grid-png";

describe("private mask grid PNG storage encoding", () => {
  it("round-trips arbitrary region labels losslessly", () => {
    const grid = Buffer.from([0, 1, 2, 7, 255, 4]);
    const png = encodeGridPng(grid, 3, 2);
    expect([...decodeGridPng(png, 3, 2)]).toEqual([...grid]);
  });
  it("rejects dimension drift", () => {
    const png = encodeGridPng(Buffer.from([0, 1, 1, 0]), 2, 2);
    expect(() => decodeGridPng(png, 4, 1)).toThrow(/dimensions/);
  });
  it("rejects processing dimensions beyond the mask contract limit", () => {
    const png = encodeGridPng(Buffer.from([0]), 1, 1);
    expect(() => decodeGridPng(png, 1025, 1)).toThrow(/limits/);
  });
});
