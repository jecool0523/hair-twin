/**
 * First-pass person/hair segmentation (ai-generation-design §5, §6).
 *
 * Heuristic engine producing a RegionMap (hair/face/body/background/uncertain)
 * from an RGBA image. MediaPipe Image Segmenter is the intended production
 * engine; this heuristic keeps the mask-contract step working offline.
 *
 * The output feeds buildMaskSet() (domain/masks.ts), which derives the
 * hair-edit mask + protected-region map. This module is pure and testable.
 */
import { RegionClass, type RegionMap } from "../domain/masks";
import { isSkin, type RgbaImage } from "./image-data";

export interface SegmentationOptions {
  /** Output grid resolution. Masks are computed at this resolution. */
  cols?: number;
  rows?: number;
}

export function segment(
  img: RgbaImage,
  opts: SegmentationOptions = {},
): RegionMap {
  const cols = opts.cols ?? 96;
  const rows = opts.rows ?? 128;
  const data = new Uint8Array(cols * rows);
  const cellW = img.width / cols;
  const cellH = img.height / rows;

  // Per-cell skin ratio + mean luma.
  const skin = new Float32Array(cols * rows);
  const luma = new Float32Array(cols * rows);
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      let sc = 0,
        ls = 0,
        n = 0;
      const x0 = Math.floor(rx * cellW);
      const x1 = Math.floor((rx + 1) * cellW);
      const y0 = Math.floor(ry * cellH);
      const y1 = Math.floor((ry + 1) * cellH);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          const r = img.data[i]!,
            g = img.data[i + 1]!,
            b = img.data[i + 2]!;
          if (isSkin(r, g, b)) sc++;
          ls += 0.299 * r + 0.587 * g + 0.114 * b;
          n++;
        }
      }
      const idx = ry * cols + rx;
      skin[idx] = n ? sc / n : 0;
      luma[idx] = n ? ls / n / 255 : 0;
    }
  }

  // Locate the face blob (skin) bounding box + centroid.
  let sumX = 0,
    sumY = 0,
    count = 0,
    minY = rows;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      if (skin[ry * cols + rx]! > 0.35) {
        sumX += rx;
        sumY += ry;
        count++;
        if (ry < minY) minY = ry;
      }
    }
  }
  const faceCx = count ? sumX / count : cols / 2;
  const faceTop = count ? minY : rows * 0.25;

  // Background luma reference from top corners.
  const cornerLuma =
    (luma[0]! + luma[cols - 1]! + luma[Math.floor(cols * 0.5)]!) / 3;

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const idx = ry * cols + rx;
      const s = skin[idx]!;
      const l = luma[idx]!;
      const distFromFaceX = Math.abs(rx - faceCx) / cols;

      let cls: RegionClass;
      if (s > 0.4) {
        cls = RegionClass.Face;
      } else if (
        // Hair: darker-than-background cells near the top/around the face crown.
        ry <= faceTop + rows * 0.28 &&
        distFromFaceX < 0.28 &&
        l < cornerLuma - 0.05
      ) {
        cls = RegionClass.Hair;
      } else if (ry > rows * 0.72) {
        cls = RegionClass.Body; // lower band: neck/shoulders/clothing
      } else if (Math.abs(l - cornerLuma) < 0.06 && s < 0.15) {
        cls = RegionClass.Background;
      } else {
        cls = RegionClass.Uncertain;
      }
      data[idx] = cls;
    }
  }

  return { width: cols, height: rows, data };
}
