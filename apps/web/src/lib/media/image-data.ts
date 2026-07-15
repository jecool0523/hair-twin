/**
 * A minimal ImageData-like shape usable in both the browser and Node tests
 * (the browser's ImageData is structurally compatible).
 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, length = width*height*4
}

/** Rough skin-tone test in RGB (heuristic; MediaPipe is the real detector). */
export function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (
    r > 95 &&
    g > 40 &&
    b > 20 &&
    r > g &&
    r > b &&
    r - g > 12 &&
    max - min > 12
  );
}

/** Downscale-average an RGBA image to a coarse grid (for cheap analysis). */
export function toGrid(
  img: RgbaImage,
  cols: number,
  rows: number,
): { skin: Float32Array; luma: Float32Array; cols: number; rows: number } {
  const skin = new Float32Array(cols * rows);
  const luma = new Float32Array(cols * rows);
  const cellW = img.width / cols;
  const cellH = img.height / rows;
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      let skinCount = 0;
      let lumaSum = 0;
      let n = 0;
      const x0 = Math.floor(rx * cellW);
      const x1 = Math.floor((rx + 1) * cellW);
      const y0 = Math.floor(ry * cellH);
      const y1 = Math.floor((ry + 1) * cellH);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          const r = img.data[i]!;
          const g = img.data[i + 1]!;
          const b = img.data[i + 2]!;
          if (isSkin(r, g, b)) skinCount++;
          lumaSum += 0.299 * r + 0.587 * g + 0.114 * b;
          n++;
        }
      }
      const idx = ry * cols + rx;
      skin[idx] = n ? skinCount / n : 0;
      luma[idx] = n ? lumaSum / n / 255 : 0;
    }
  }
  return { skin, luma, cols, rows };
}
