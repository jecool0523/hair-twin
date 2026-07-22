/**
 * Segmentation worker — produces the REGION MAP off the main thread.
 *
 * It returns the region map itself (per-pixel classes derived from the actual
 * captured photo), not a summary. The server re-derives the mask set and the
 * authoritative coverage from these bytes; the client is deliberately not
 * trusted to assert a mask summary (ADR-0006).
 *
 * === MEDIAPIPE SEAM ===
 * Production engine: MediaPipe Tasks Vision (ImageSegmenter, hair/person),
 * loaded lazily with graceful fallback to the heuristic `segment()` so the mask
 * step works offline. The region-map contract is engine-independent.
 */
import { segment } from "../lib/media/segmentation";
import type { RegionMap } from "../lib/domain/masks";
import type { RgbaImage } from "../lib/media/image-data";

export interface SegmentRequest {
  type: "segment";
  image: RgbaImage;
}
export interface SegmentResponse {
  type: "segment:result";
  width: number;
  height: number;
  /** Transferred, not copied. */
  data: ArrayBuffer;
}

self.addEventListener("message", (ev: MessageEvent<SegmentRequest>) => {
  const msg = ev.data;
  if (msg?.type !== "segment") return;
  const region: RegionMap = segment(msg.image);
  const buffer = region.data.buffer.slice(0) as ArrayBuffer;
  const response: SegmentResponse = {
    type: "segment:result",
    width: region.width,
    height: region.height,
    data: buffer,
  };
  (self as unknown as Worker).postMessage(response, [buffer]);
});
