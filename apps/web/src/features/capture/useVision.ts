"use client";
import { useCallback, useEffect, useRef } from "react";
import type { PreflightResult } from "@/lib/domain/types";
import type { MaskSummary } from "@/lib/domain/masks";
import { runPreflight } from "@/lib/media/preflight";
import { segment } from "@/lib/media/segmentation";
import { buildMaskSet, summariseMaskSet } from "@/lib/domain/masks";

/**
 * Manages the two vision Web Workers (face-landmark + segmentation) and exposes
 * `analyze(canvas)`. If workers fail to spin up (older browsers), it falls back
 * to running the same pure functions on the main thread so capture still works.
 */
export function useVision() {
  const landmarkRef = useRef<Worker | null>(null);
  const segRef = useRef<Worker | null>(null);

  useEffect(() => {
    try {
      landmarkRef.current = new Worker(
        new URL("../../workers/face-landmark.worker.ts", import.meta.url),
        { type: "module" },
      );
      segRef.current = new Worker(
        new URL("../../workers/segmentation.worker.ts", import.meta.url),
        { type: "module" },
      );
    } catch {
      // Fallback: run on main thread (see analyze()).
      landmarkRef.current = null;
      segRef.current = null;
    }
    return () => {
      landmarkRef.current?.terminate();
      segRef.current?.terminate();
    };
  }, []);

  const preflight = useCallback(
    (image: {
      width: number;
      height: number;
      data: Uint8ClampedArray;
    }): Promise<PreflightResult> => {
      const worker = landmarkRef.current;
      if (!worker) return Promise.resolve(runPreflight(image));
      return new Promise((resolve) => {
        const onMsg = (ev: MessageEvent) => {
          if (ev.data?.type === "preflight:result") {
            worker.removeEventListener("message", onMsg);
            resolve(ev.data.result as PreflightResult);
          }
        };
        worker.addEventListener("message", onMsg);
        worker.postMessage({ type: "preflight", image });
      });
    },
    [],
  );

  const buildMasks = useCallback(
    (image: {
      width: number;
      height: number;
      data: Uint8ClampedArray;
    }): Promise<MaskSummary> => {
      const worker = segRef.current;
      if (!worker) {
        const region = segment(image);
        const set = buildMaskSet(region, 6);
        return Promise.resolve(summariseMaskSet(set, 6));
      }
      return new Promise((resolve) => {
        const onMsg = (ev: MessageEvent) => {
          if (ev.data?.type === "segment:result") {
            worker.removeEventListener("message", onMsg);
            resolve(ev.data.summary as MaskSummary);
          }
        };
        worker.addEventListener("message", onMsg);
        worker.postMessage({ type: "segment", image, expansionRadius: 6 });
      });
    },
    [],
  );

  return { preflight, buildMasks };
}

/** Extract RGBA ImageData from an image element or video frame via a canvas. */
export function extractImageData(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  maxW = 640,
): { width: number; height: number; data: Uint8ClampedArray } | null {
  const sw =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : source.width;
  const sh =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : source.height;
  if (!sw || !sh) return null;
  const scale = Math.min(1, maxW / sw);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: imageData.data };
}
