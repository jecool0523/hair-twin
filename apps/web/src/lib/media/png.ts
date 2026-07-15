/**
 * Minimal PNG encoder (server-side, no native deps).
 *
 * Encodes an RGBA buffer to a PNG using Node's built-in zlib. Used by the Mock
 * provider to synthesize deterministic candidate images without a browser
 * canvas or a native image library, so the whole flow runs under `npm run dev`
 * and in Node tests.
 */
import { deflateSync } from "node:zlib";

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return out;
}

/**
 * @param rgba length must be width*height*4
 */
export function encodePng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error("rgba length must equal width*height*4");
  }
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data with a filter byte (0) per scanline.
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw);

  const chunks = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(compressed)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = Buffer.alloc(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
