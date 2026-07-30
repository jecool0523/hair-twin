import { inflateSync } from "node:zlib";
import { encodePng } from "./png";

export function encodeGridPng(grid: Uint8Array, width: number, height: number): Buffer {
  if (grid.length !== width * height) throw new Error("grid length does not match dimensions");
  const rgba = new Uint8Array(grid.length * 4);
  for (let i = 0; i < grid.length; i++) {
    rgba[i * 4] = grid[i]!;
    rgba[i * 4 + 1] = grid[i]!;
    rgba[i * 4 + 2] = grid[i]!;
    rgba[i * 4 + 3] = 255;
  }
  return encodePng(rgba, width, height);
}

export function decodeGridPng(png: Uint8Array, width: number, height: number): Buffer {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width > 1024 || height > 1024 || width * height > 1_048_576) {
    throw new Error("stored grid PNG dimensions exceed limits");
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const input = Buffer.from(png);
  if (!input.subarray(0, 8).equals(signature) || input.readUInt32BE(16) !== width || input.readUInt32BE(20) !== height) {
    throw new Error("stored grid PNG has invalid signature or dimensions");
  }
  const chunks: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    if (offset + 12 + length > input.length) throw new Error("stored grid PNG has a truncated chunk");
    const type = input.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") chunks.push(input.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const stride = width * 4;
  const expected = (stride + 1) * height;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: expected });
  } catch {
    throw new Error("stored grid PNG has invalid or oversized payload");
  }
  if (raw.length !== expected) throw new Error("stored grid PNG has invalid payload length");
  const grid = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    if (raw[row] !== 0) throw new Error("stored grid PNG uses unsupported filtering");
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4;
      if (raw[pixel] !== raw[pixel + 1] || raw[pixel] !== raw[pixel + 2] || raw[pixel + 3] !== 255) {
        throw new Error("stored grid PNG is not a lossless grid encoding");
      }
      grid[y * width + x] = raw[pixel]!;
    }
  }
  return grid;
}
