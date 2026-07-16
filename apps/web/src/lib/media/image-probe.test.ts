import { describe, expect, it } from "vitest";
import { probeImage, ImageRejected, IMAGE_LIMITS } from "./image-probe";
import { encodePng } from "./png";

function png(w: number, h: number) {
  return new Uint8Array(encodePng(new Uint8Array(w * h * 4).fill(180), w, h));
}

/** Minimal JPEG: SOI + SOF0 carrying dimensions + EOI. */
function jpeg(w: number, h: number) {
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (h >> 8) & 0xff, h & 0xff,
    (w >> 8) & 0xff, w & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return new Uint8Array([0xff, 0xd8, ...sof, 0xff, 0xd9]);
}

describe("probeImage", () => {
  it("reads real PNG dimensions from the bytes", () => {
    const r = probeImage(png(300, 400), "image/png");
    expect(r).toMatchObject({ format: "image/png", width: 300, height: 400 });
  });

  it("reads real JPEG dimensions from the SOF segment", () => {
    const r = probeImage(jpeg(640, 480), "image/jpeg");
    expect(r).toMatchObject({ format: "image/jpeg", width: 640, height: 480 });
  });

  it("treats image/jpg as image/jpeg", () => {
    expect(probeImage(jpeg(640, 480), "image/jpg").format).toBe("image/jpeg");
  });

  it("rejects a file whose declared MIME disagrees with its bytes", () => {
    // The classic upload attack: claim image/png, send something else.
    expect(() => probeImage(jpeg(640, 480), "image/png")).toThrow(ImageRejected);
  });

  it("rejects non-image bytes even when a MIME type is declared", () => {
    const script = new TextEncoder().encode("<?php system($_GET['c']); ?>");
    expect(() => probeImage(script, "image/png")).toThrow(ImageRejected);
  });

  it("rejects an empty body", () => {
    expect(() => probeImage(new Uint8Array(0))).toThrow(ImageRejected);
  });

  // Note: Error.message carries the technical detail (for logs); the Korean
  // copy lives on userMessageKo (for the customer-facing UI).
  it("rejects oversized files before parsing", () => {
    const huge = new Uint8Array(IMAGE_LIMITS.maxBytes + 1);
    expect(() => probeImage(huge)).toThrow(ImageRejected);
    try {
      probeImage(huge);
    } catch (e) {
      expect((e as ImageRejected).userMessageKo).toMatch(/너무 큽니다/);
    }
  });

  it("rejects images below the minimum resolution", () => {
    expect(() => probeImage(png(8, 8), "image/png")).toThrow(ImageRejected);
    try {
      probeImage(png(8, 8), "image/png");
    } catch (e) {
      expect((e as ImageRejected).userMessageKo).toMatch(/너무 낮습니다/);
    }
  });

  it("does not trust client-declared dimensions (they are not an input)", () => {
    // Whatever the client says, the probe reports what the bytes actually are.
    const r = probeImage(png(300, 400));
    expect(r.width).toBe(300);
    expect(r.height).toBe(400);
  });

  it("surfaces a Korean user-facing message", () => {
    try {
      probeImage(new Uint8Array([1, 2, 3, 4]));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ImageRejected);
      expect((e as ImageRejected).userMessageKo).toMatch(/이미지/);
    }
  });
});
