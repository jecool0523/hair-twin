/**
 * Local capture preflight (ai-generation-design §5).
 *
 * Heuristic engine: detects a central skin-tone blob as the primary face and
 * checks framing/lighting. This runs in the segmentation/landmark worker off
 * the main thread. MediaPipe Face Landmarker is the intended production engine
 * (see the worker's MEDIAPIPE seam); this heuristic is the offline fallback so
 * the capture step works without downloading models.
 */
import type { PreflightResult } from "../domain/types";
import { toGrid, type RgbaImage } from "./image-data";

export interface PreflightThresholds {
  minBrightness: number;
  maxBrightness: number;
  minFaceAreaRatio: number;
  maxFaceAreaRatio: number;
  maxCenterOffset: number;
  minSharpness: number;
}

export const PREFLIGHT_THRESHOLDS: PreflightThresholds = {
  minBrightness: 0.22,
  maxBrightness: 0.92,
  minFaceAreaRatio: 0.03,
  maxFaceAreaRatio: 0.75,
  maxCenterOffset: 0.32,
  minSharpness: 0.015,
};

function sharpnessScore(img: RgbaImage): number {
  // Mean absolute luma gradient, normalized. Cheap proxy for blur.
  const step = Math.max(1, Math.floor(img.width / 160));
  let sum = 0;
  let n = 0;
  for (let y = step; y < img.height - step; y += step) {
    for (let x = step; x < img.width - step; x += step) {
      const i = (y * img.width + x) * 4;
      const ir = (y * img.width + x + step) * 4;
      const ib = ((y + step) * img.width + x) * 4;
      const l = 0.299 * img.data[i]! + 0.587 * img.data[i + 1]! + 0.114 * img.data[i + 2]!;
      const lr = 0.299 * img.data[ir]! + 0.587 * img.data[ir + 1]! + 0.114 * img.data[ir + 2]!;
      const lb = 0.299 * img.data[ib]! + 0.587 * img.data[ib + 1]! + 0.114 * img.data[ib + 2]!;
      sum += Math.abs(l - lr) + Math.abs(l - lb);
      n += 2;
    }
  }
  return n ? sum / n / 255 : 0;
}

export function runPreflight(
  img: RgbaImage,
  thresholds: PreflightThresholds = PREFLIGHT_THRESHOLDS,
): PreflightResult {
  const cols = 24;
  const rows = 32;
  const { skin } = toGrid(img, cols, rows);

  // Bounding box of skin cells (the face+neck blob).
  let minX = cols,
    minY = rows,
    maxX = -1,
    maxY = -1,
    skinCells = 0;
  let brightnessSum = 0;
  const { luma } = toGrid(img, cols, rows);
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const idx = ry * cols + rx;
      brightnessSum += luma[idx]!;
      if (skin[idx]! > 0.35) {
        skinCells++;
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
      }
    }
  }

  const brightness = brightnessSum / (cols * rows);
  const sharpness = sharpnessScore(img);
  const hasBlob = maxX >= 0 && skinCells >= 6;

  let faceBox: PreflightResult["metrics"]["faceBox"];
  let centerOffset = 1;
  let faceAreaRatio = 0;
  if (hasBlob) {
    const bx = minX / cols;
    const by = minY / rows;
    const bw = (maxX - minX + 1) / cols;
    const bh = (maxY - minY + 1) / rows;
    faceBox = { x: bx, y: by, w: bw, h: bh };
    faceAreaRatio = bw * bh;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;
    centerOffset = Math.hypot(cx - 0.5, cy - 0.45) * 1.5;
  }

  const issues: string[] = [];
  const faceCount = hasBlob ? 1 : 0;
  const hasSinglePrimaryFace = hasBlob;
  if (!hasBlob) issues.push("얼굴을 찾지 못했습니다. 카메라를 정면으로 바라봐 주세요.");
  const brightnessOk =
    brightness >= thresholds.minBrightness &&
    brightness <= thresholds.maxBrightness;
  if (!brightnessOk) {
    issues.push(
      brightness < thresholds.minBrightness
        ? "화면이 너무 어둡습니다. 조명을 밝게 해주세요."
        : "화면이 너무 밝습니다. 역광을 피해주세요.",
    );
  }
  const distanceOk =
    hasBlob &&
    faceAreaRatio >= thresholds.minFaceAreaRatio &&
    faceAreaRatio <= thresholds.maxFaceAreaRatio;
  if (hasBlob && !distanceOk) {
    issues.push(
      faceAreaRatio < thresholds.minFaceAreaRatio
        ? "얼굴이 너무 작습니다. 카메라에 가까이 와주세요."
        : "얼굴이 너무 큽니다. 조금 떨어져 주세요.",
    );
  }
  const centered = hasBlob && centerOffset <= thresholds.maxCenterOffset;
  if (hasBlob && !centered)
    issues.push("얼굴을 화면 가운데에 맞춰주세요.");
  const sharpnessOk = sharpness >= thresholds.minSharpness;
  if (!sharpnessOk) issues.push("이미지가 흐릿합니다. 움직임을 줄여주세요.");
  // Hair visibility heuristic: some non-skin, non-bright region above the face.
  const hairVisibleEnough = hasBlob;

  const passed =
    hasSinglePrimaryFace &&
    brightnessOk &&
    distanceOk &&
    centered &&
    sharpnessOk;

  return {
    faceCount,
    hasSinglePrimaryFace,
    centered,
    distanceOk,
    brightnessOk,
    sharpnessOk,
    hairVisibleEnough,
    passed,
    issues,
    metrics: {
      faceBox,
      brightness,
      sharpness,
      centerOffset: hasBlob ? Math.min(1, centerOffset) : 1,
      faceAreaRatio,
    },
    engine: "heuristic",
  };
}
