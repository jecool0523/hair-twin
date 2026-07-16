"use client";
import type { SessionView } from "../dto";
import type { StylistVerdict } from "../domain/types";

/**
 * Requests never hang forever: a slow salon network must surface as a readable
 * error the stylist can retry, not an indefinite spinner. Uploads get a longer
 * budget than plain reads because they carry image bytes.
 */
const DEFAULT_TIMEOUT_MS = 15_000;
const UPLOAD_TIMEOUT_MS = 45_000;

async function req<T>(
  url: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    // Content-Type is decided per request, never globally: a FormData body must
    // set its own multipart boundary, and forcing application/json on it would
    // corrupt the upload.
    const headers = new Headers(init?.headers);
    if (init?.body !== undefined && !(init.body instanceof FormData)) {
      if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }
    }
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(
        `네트워크 응답이 ${Math.round(timeoutMs / 1000)}초 안에 오지 않았습니다. 연결을 확인하고 다시 시도해 주세요.`,
        0,
      );
    }
    throw new ApiError(
      "네트워크에 연결할 수 없습니다. 연결을 확인하고 다시 시도해 주세요.",
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => ({}))) as
    | T
    | { error?: string; detail?: unknown };
  if (!res.ok) {
    const message =
      (body as { error?: string }).error ?? `요청 실패 (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export class ApiError extends Error {
  status: number;
  /** 0 means the request never reached the server (timeout/offline). */
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const api = {
  startSession: (input: { stylistName: string; customerAlias: string }) =>
    req<{ sessionId: string; stage: string }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  getSession: (id: string) => req<SessionView>(`/api/sessions/${id}`),

  consent: (
    id: string,
    input: {
      captureConsented: true;
      saveImagesConsented: boolean;
      saveReportConsented: boolean;
      wordingVersion: string;
    },
  ) =>
    req<{ stage: string }>(`/api/sessions/${id}/consent`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /**
   * Upload the capture as multipart/form-data: raw image bytes plus the region
   * map derived from that same image. No base64, no JSON image transport.
   * The server decides the real format/dimensions and derives mask coverage.
   */
  uploadSource: (
    id: string,
    input: {
      blob: Blob;
      regionMap: { width: number; height: number; data: Uint8Array };
      preflight: {
        faceCount: number;
        passed: boolean;
        engine: "mediapipe" | "heuristic";
      };
    },
  ) => {
    const form = new FormData();
    const ext = input.blob.type === "image/png" ? "png" : "jpg";
    form.append("image", input.blob, `capture.${ext}`);
    form.append(
      "regionMap",
      new Blob([new Uint8Array(input.regionMap.data)], {
        type: "application/octet-stream",
      }),
      "region-map.bin",
    );
    form.append("regionMapWidth", String(input.regionMap.width));
    form.append("regionMapHeight", String(input.regionMap.height));
    form.append("preflight", JSON.stringify(input.preflight));
    return req<{
      sourceImageId: string;
      maskContractId: string;
      sourceUrl: string;
      width: number;
      height: number;
      expiresAt?: string;
    }>(
      `/api/sessions/${id}/source`,
      { method: "POST", body: form },
      UPLOAD_TIMEOUT_MS, // carries image bytes
    );
  },

  createJob: (
    id: string,
    input: {
      styleId: string;
      candidateCount: number;
      maskContractId: string;
    },
  ) =>
    req<{ jobId: string; status: string }>(`/api/sessions/${id}/jobs`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  retryJob: (jobId: string) =>
    req<{ jobId: string; status: string; attempts: number }>(
      `/api/jobs/${jobId}/retry`,
      { method: "POST" },
    ),

  setVerdict: (candidateId: string, verdict: StylistVerdict) =>
    req<{ candidateId: string; verdict: StylistVerdict }>(
      `/api/candidates/${candidateId}/verdict`,
      { method: "POST", body: JSON.stringify({ verdict }) },
    ),

  saveNote: (
    id: string,
    note: {
      memoKo: string;
      feasibility: "easy" | "moderate" | "hard" | "";
      estimatedPrice: string;
      estimatedTime: string;
      careNotesKo: string;
    },
  ) =>
    req<{ note: unknown }>(`/api/sessions/${id}/note`, {
      method: "POST",
      body: JSON.stringify(note),
    }),

  decide: (id: string, action: "save" | "discard", candidateIds: string[]) =>
    req<{ stage: string }>(`/api/sessions/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ action, candidateIds }),
    }),
};
