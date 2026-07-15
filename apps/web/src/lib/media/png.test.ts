import { describe, expect, it } from "vitest";
import { encodePng } from "./png";

describe("encodePng", () => {
  it("produces a valid PNG signature and IHDR dimensions", () => {
    const w = 4;
    const h = 3;
    const rgba = new Uint8Array(w * h * 4).fill(128);
    const png = encodePng(rgba, w, h);
    // PNG signature
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR width/height at bytes 16..24
    expect(png.readUInt32BE(16)).toBe(w);
    expect(png.readUInt32BE(20)).toBe(h);
    // ends with IEND
    expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe(
      "IEND",
    );
  });

  it("rejects mismatched buffer length", () => {
    expect(() => encodePng(new Uint8Array(3), 2, 2)).toThrow();
  });
});
