/**
 * Test fixtures: realistic capture inputs.
 *
 * These build a real PNG and a real region map (hair on top, face in the middle,
 * body at the bottom) so tests exercise the same server-side derivation the app
 * uses, rather than hand-written coverage numbers.
 */
import { RegionClass, type RegionMap } from "@/lib/domain/masks";
import { encodePng } from "@/lib/media/png";

/** A valid PNG of the given size (>= the prober's minimum). */
export function pngBytes(width = 480, height = 640): Uint8Array {
  return new Uint8Array(
    encodePng(new Uint8Array(width * height * 4).fill(200), width, height),
  );
}

export interface RegionMapOptions {
  cols?: number;
  rows?: number;
  /** Fraction of rows from the top occupied by hair. Bigger => more hair. */
  hairRows?: number;
  /** Horizontal half-width of the head, as a fraction of cols. */
  headHalfWidth?: number;
}

/**
 * A plausible region map. Varying `hairRows` produces genuinely different
 * coverage, which is how tests prove different inputs yield different contracts.
 */
export function regionMap(opts: RegionMapOptions = {}): RegionMap {
  const cols = opts.cols ?? 48;
  const rows = opts.rows ?? 64;
  const hairRows = opts.hairRows ?? 0.3;
  const half = opts.headHalfWidth ?? 0.25;

  const data = new Uint8Array(cols * rows);
  const cx = cols / 2;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const inHead = Math.abs(x - cx) <= cols * half;
      let cls: RegionClass = RegionClass.Background;
      if (y > rows * 0.78) cls = RegionClass.Body;
      else if (inHead && y < rows * hairRows) cls = RegionClass.Hair;
      else if (inHead && y < rows * 0.72) cls = RegionClass.Face;
      else if (Math.abs(x - cx) <= cols * (half + 0.04)) cls = RegionClass.Uncertain;
      data[y * cols + x] = cls;
    }
  }
  return { width: cols, height: rows, data };
}

export const PREFLIGHT_OK = {
  faceCount: 1,
  passed: true,
  engine: "heuristic" as const,
};

/** A capture payload shaped for storeSourceImage(). */
export function captureInput(opts: RegionMapOptions & { width?: number; height?: number } = {}) {
  const rm = regionMap(opts);
  return {
    imageBytes: pngBytes(opts.width ?? 480, opts.height ?? 640),
    declaredMime: "image/png",
    regionMapBytes: rm.data,
    regionMapWidth: rm.width,
    regionMapHeight: rm.height,
    preflight: PREFLIGHT_OK,
  };
}
