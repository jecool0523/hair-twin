/**
 * Server-side image validation.
 *
 * The client is not authoritative about anything: not the MIME type it declares,
 * not the width/height it reports. This module reads the actual bytes, decides
 * the real format from the file signature (magic bytes), and parses the real
 * dimensions out of the container headers.
 *
 * Pure + dependency-free so it runs in route handlers and in Node tests.
 */

export type ImageFormat = "image/png" | "image/jpeg" | "image/webp";

export interface ProbedImage {
  format: ImageFormat;
  width: number;
  height: number;
  byteLength: number;
}

export class ImageRejected extends Error {
  /** Korean, user-facing. Safe to show in the capture UI. */
  userMessageKo: string;
  constructor(userMessageKo: string, detail: string) {
    super(detail);
    this.name = "ImageRejected";
    this.userMessageKo = userMessageKo;
  }
}

export const IMAGE_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // 10MB — matches the storage bucket limit
  minWidth: 240,
  minHeight: 240,
  maxWidth: 8000,
  maxHeight: 8000,
} as const;

function u16be(b: Uint8Array, o: number) {
  return (b[o]! << 8) | b[o + 1]!;
}
function u32be(b: Uint8Array, o: number) {
  return (
    ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0
  );
}
function u32le(b: Uint8Array, o: number) {
  return (
    ((b[o + 3]! << 24) | (b[o + 2]! << 16) | (b[o + 1]! << 8) | b[o]!) >>> 0
  );
}

/** PNG: 8-byte signature then an IHDR chunk carrying width/height. */
function probePng(b: Uint8Array): ProbedImage | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (b.length < 24) return null;
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
  // Bytes 12..16 must be the IHDR chunk type.
  if (String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) !== "IHDR") return null;
  return {
    format: "image/png",
    width: u32be(b, 16),
    height: u32be(b, 20),
    byteLength: b.length,
  };
}

/** JPEG: SOI then segments; SOFn carries the dimensions. */
function probeJpeg(b: Uint8Array): ProbedImage | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++; // resync past padding
      continue;
    }
    const marker = b[o + 1]!;
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2;
      continue;
    }
    const len = u16be(b, o + 2);
    // SOF0..SOF15, excluding DHT(c4)/JPGA(c8)/DAC(cc) which are not frame headers.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSof) {
      return {
        format: "image/jpeg",
        height: u16be(b, o + 5),
        width: u16be(b, o + 7),
        byteLength: b.length,
      };
    }
    if (len <= 0) return null;
    o += 2 + len;
  }
  return null;
}

/** WebP: RIFF....WEBP, then VP8 / VP8L / VP8X carry the dimensions. */
function probeWebp(b: Uint8Array): ProbedImage | null {
  if (b.length < 30) return null;
  const tag = (o: number) =>
    String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") return null;
  const chunk = tag(12);
  if (chunk === "VP8 ") {
    // Lossy: 3-byte frame tag, 3-byte sync code (9d 01 2a), then 14-bit dims.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return {
      format: "image/webp",
      width: ((b[27]! << 8) | b[26]!) & 0x3fff,
      height: ((b[29]! << 8) | b[28]!) & 0x3fff,
      byteLength: b.length,
    };
  }
  if (chunk === "VP8L") {
    const bits = u32le(b, 21);
    return {
      format: "image/webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      byteLength: b.length,
    };
  }
  if (chunk === "VP8X") {
    return {
      format: "image/webp",
      width: (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1,
      height: (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1,
      byteLength: b.length,
    };
  }
  return null;
}

/**
 * Decide format + dimensions from the bytes themselves and enforce limits.
 * @param declaredMime what the client claimed — checked for agreement, never trusted.
 */
export function probeImage(
  bytes: Uint8Array,
  declaredMime?: string,
): ProbedImage {
  if (bytes.length === 0) {
    throw new ImageRejected("이미지가 비어 있습니다.", "empty body");
  }
  if (bytes.length > IMAGE_LIMITS.maxBytes) {
    throw new ImageRejected(
      `이미지가 너무 큽니다. ${Math.floor(IMAGE_LIMITS.maxBytes / 1024 / 1024)}MB 이하로 다시 시도해 주세요.`,
      `too large: ${bytes.length}`,
    );
  }

  const probed = probePng(bytes) ?? probeJpeg(bytes) ?? probeWebp(bytes);
  if (!probed) {
    throw new ImageRejected(
      "지원하지 않는 이미지 형식입니다. PNG, JPEG, WebP만 사용할 수 있습니다.",
      "no supported signature found",
    );
  }

  // A declared type that disagrees with the actual bytes is a red flag, not a
  // rounding error: reject rather than silently trusting the signature.
  if (declaredMime) {
    const normalized =
      declaredMime === "image/jpg" ? "image/jpeg" : declaredMime.split(";")[0];
    if (normalized !== probed.format) {
      throw new ImageRejected(
        "이미지 형식이 올바르지 않습니다. 다시 촬영하거나 다른 파일을 사용해 주세요.",
        `declared ${normalized} but bytes are ${probed.format}`,
      );
    }
  }

  if (probed.width <= 0 || probed.height <= 0) {
    throw new ImageRejected(
      "이미지 크기를 확인할 수 없습니다.",
      `bad dims ${probed.width}x${probed.height}`,
    );
  }
  if (
    probed.width > IMAGE_LIMITS.maxWidth ||
    probed.height > IMAGE_LIMITS.maxHeight
  ) {
    throw new ImageRejected(
      "이미지 해상도가 너무 큽니다.",
      `too big ${probed.width}x${probed.height}`,
    );
  }
  if (
    probed.width < IMAGE_LIMITS.minWidth ||
    probed.height < IMAGE_LIMITS.minHeight
  ) {
    throw new ImageRejected(
      "이미지 해상도가 너무 낮습니다. 더 큰 사진을 사용해 주세요.",
      `too small ${probed.width}x${probed.height}`,
    );
  }

  return probed;
}
