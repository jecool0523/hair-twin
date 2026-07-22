/**
 * Face landmark / capture preflight worker.
 *
 * Runs preflight OFF the main thread so the camera UI never freezes
 * (system-design §2 "Web Workers should be part of the capture architecture").
 *
 * === MEDIAPIPE SEAM ===
 * The production engine is MediaPipe Tasks Vision (FaceLandmarker). It is loaded
 * lazily and, if unavailable/offline, we fall back to the heuristic engine so
 * capture still works. To wire MediaPipe:
 *   1. add "@mediapipe/tasks-vision" dependency
 *   2. FilesetResolver.forVisionTasks(<wasm cdn or self-hosted>)
 *   3. FaceLandmarker.createFromOptions(...) and map results into PreflightResult
 * Until then, `runPreflight` (heuristic) is the active engine. This keeps the
 * worker boundary + message contract stable regardless of engine.
 */
import { runPreflight } from "../lib/media/preflight";
import type { RgbaImage } from "../lib/media/image-data";
import type { PreflightResult } from "../lib/domain/types";

export interface PreflightRequest {
  type: "preflight";
  image: RgbaImage;
}
export interface PreflightResponse {
  type: "preflight:result";
  result: PreflightResult;
}

self.addEventListener("message", (ev: MessageEvent<PreflightRequest>) => {
  const msg = ev.data;
  if (msg?.type !== "preflight") return;
  const result = runPreflight(msg.image);
  const response: PreflightResponse = { type: "preflight:result", result };
  (self as unknown as Worker).postMessage(response);
});
