/**
 * Segmentation + mask-contract worker.
 *
 * Produces the region map and derived mask set OFF the main thread, then ships
 * a compact MaskSummary (coverage ratios) to the server. Full mask PNGs are
 * only needed by the real AI worker; the mock flow + QC need the summary.
 *
 * === MEDIAPIPE SEAM ===
 * Production engine: MediaPipe Tasks Vision (ImageSegmenter, hair/person). Load
 * lazily with graceful fallback to the heuristic `segment()` so the mask step
 * works offline. The mask-contract construction (buildMaskSet) is
 * engine-independent.
 */
import { segment } from "../lib/media/segmentation";
import {
  buildMaskSet,
  summariseMaskSet,
  type MaskSummary,
} from "../lib/domain/masks";
import type { RgbaImage } from "../lib/media/image-data";

export interface SegmentRequest {
  type: "segment";
  image: RgbaImage;
  expansionRadius?: number;
}
export interface SegmentResponse {
  type: "segment:result";
  summary: MaskSummary;
}

self.addEventListener("message", (ev: MessageEvent<SegmentRequest>) => {
  const msg = ev.data;
  if (msg?.type !== "segment") return;
  const expansionRadius = msg.expansionRadius ?? 6;
  const region = segment(msg.image);
  const set = buildMaskSet(region, expansionRadius);
  const summary = summariseMaskSet(set, expansionRadius);
  const response: SegmentResponse = { type: "segment:result", summary };
  (self as unknown as Worker).postMessage(response);
});
