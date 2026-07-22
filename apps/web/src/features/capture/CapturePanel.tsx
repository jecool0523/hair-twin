"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Upload, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PreflightResult } from "@/lib/domain/types";
import type { RegionMap } from "@/lib/domain/masks";
import { useVision, extractImageData } from "./useVision";

/**
 * What capture hands to the console. The photo travels as raw Blob bytes (sent
 * as multipart), never as a base64 data URL in JSON. `previewUrl` is a local
 * object URL for on-screen display only and is never uploaded.
 */
export interface CapturePayload {
  blob: Blob;
  previewUrl: string;
  preflight: PreflightResult;
  regionMap: RegionMap;
}

type CameraState = "idle" | "requesting" | "streaming" | "denied" | "unsupported";

/**
 * Client-side pre-checks. These exist to fail fast with a friendly message —
 * the server re-validates the real bytes regardless (lib/media/image-probe.ts).
 */
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function CapturePanel({
  onConfirm,
  busy,
}: {
  onConfirm: (p: CapturePayload) => void;
  busy?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [captured, setCaptured] = useState<CapturePayload | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { preflight, buildRegionMap } = useVision();

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraState("unsupported");
      return;
    }
    setCameraState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 960 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraState("streaming");
    } catch {
      setCameraState("denied");
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const analyzeAndSet = useCallback(
    async (source: HTMLImageElement, blob: Blob, previewUrl: string) => {
      setAnalyzing(true);
      setLocalError(null);
      try {
        const img = extractImageData(source);
        if (!img) {
          setLocalError("이미지를 읽지 못했습니다. 다른 파일을 사용해 주세요.");
          URL.revokeObjectURL(previewUrl);
          return;
        }
        const pre = await preflight(img);
        const regionMap = await buildRegionMap(img);
        setCaptured((prev) => {
          if (prev) URL.revokeObjectURL(prev.previewUrl);
          return { blob, previewUrl, preflight: pre, regionMap };
        });
      } finally {
        setAnalyzing(false);
      }
    },
    [preflight, buildRegionMap],
  );

  const captureFromVideo = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror to match the user's expectation (front camera), like the MVP.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    // toBlob keeps the frame as bytes; there is no base64 round-trip.
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob(r, "image/jpeg", 0.9),
    );
    if (!blob) {
      setLocalError("촬영에 실패했습니다. 다시 시도해 주세요.");
      return;
    }
    const previewUrl = URL.createObjectURL(blob);
    const imgEl = new Image();
    imgEl.onload = () => void analyzeAndSet(imgEl, blob, previewUrl);
    imgEl.src = previewUrl;
  }, [analyzeAndSet]);

  const onFile = useCallback(
    (file: File) => {
      setLocalError(null);
      if (!ALLOWED_TYPES.includes(file.type)) {
        setLocalError("PNG, JPEG, WebP 이미지만 업로드할 수 있습니다.");
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        setLocalError(
          `이미지가 너무 큽니다. ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하로 다시 시도해 주세요.`,
        );
        return;
      }
      // The File is already bytes; read it as an object URL, not base64.
      const previewUrl = URL.createObjectURL(file);
      const imgEl = new Image();
      imgEl.onerror = () => {
        setLocalError("이미지를 열 수 없습니다. 다른 파일을 사용해 주세요.");
        URL.revokeObjectURL(previewUrl);
      };
      imgEl.onload = () => void analyzeAndSet(imgEl, file, previewUrl);
      imgEl.src = previewUrl;
    },
    [analyzeAndSet],
  );

  const reset = () => {
    setCaptured((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setLocalError(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" /> 고객 촬영
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {localError && (
          <div className="flex items-start gap-2 rounded-md border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/5 p-3 text-sm text-[hsl(var(--danger))]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{localError}</span>
          </div>
        )}
        {!captured && (
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black/90">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full scale-x-[-1] object-cover"
            />
            {/* Face guide overlay (migrated idea from CameraFeed) */}
            {cameraState === "streaming" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-2/3 w-1/2 rounded-[50%] border-2 border-white/60" />
                <span className="absolute bottom-3 text-xs text-white/80">
                  얼굴과 헤어라인을 가이드에 맞춰주세요
                </span>
              </div>
            )}
            {cameraState !== "streaming" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/80">
                {cameraState === "idle" && (
                  <>
                    <p>웹캠으로 촬영하거나 이미지를 업로드할 수 있습니다.</p>
                    <Button onClick={startCamera}>카메라 켜기</Button>
                  </>
                )}
                {cameraState === "requesting" && <p>카메라 권한 요청 중…</p>}
                {cameraState === "denied" && (
                  <div className="space-y-2">
                    <AlertTriangle className="mx-auto h-6 w-6 text-[hsl(var(--warning))]" />
                    <p>
                      카메라 권한을 받지 못했습니다. 아래에서 이미지를 업로드해
                      계속 진행하세요.
                    </p>
                    <Button variant="outline" size="sm" onClick={startCamera}>
                      다시 시도
                    </Button>
                  </div>
                )}
                {cameraState === "unsupported" && (
                  <p>
                    이 브라우저는 카메라를 지원하지 않습니다. 이미지를 업로드해
                    진행하세요.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {captured && (
          <div className="space-y-3">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black/90">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={captured.previewUrl}
                alt="촬영 미리보기"
                className="h-full w-full object-cover"
              />
            </div>
            <PreflightSummary preflight={captured.preflight} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {cameraState === "streaming" && !captured && (
            <Button onClick={captureFromVideo} disabled={analyzing}>
              {analyzing ? "분석 중…" : "촬영"}
            </Button>
          )}
          <label className="inline-flex">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
            <span className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-5 text-sm hover:bg-muted">
              <Upload className="h-4 w-4" /> 이미지 업로드
            </span>
          </label>
          {captured && (
            <>
              <Button variant="ghost" onClick={reset}>
                <RefreshCw className="h-4 w-4" /> 다시 촬영
              </Button>
              <Button
                variant={captured.preflight.passed ? "primary" : "secondary"}
                disabled={busy || analyzing}
                onClick={() => onConfirm(captured)}
              >
                {busy
                  ? "업로드 중…"
                  : captured.preflight.passed
                    ? "이 사진으로 진행"
                    : "품질 경고 무시하고 진행"}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PreflightSummary({ preflight }: { preflight: PreflightResult }) {
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        {preflight.passed ? (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" /> 촬영 품질 양호
          </Badge>
        ) : (
          <Badge tone="warning">
            <AlertTriangle className="h-3 w-3" /> 촬영 품질 확인 필요
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          엔진: {preflight.engine === "mediapipe" ? "MediaPipe" : "휴리스틱(폴백)"}
          {" · "}얼굴 {preflight.faceCount}개
        </span>
      </div>
      {preflight.issues.length > 0 ? (
        <ul className="list-inside list-disc space-y-1 text-muted-foreground">
          {preflight.issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          얼굴/프레이밍/조명 기준을 통과했습니다.
        </p>
      )}
    </div>
  );
}
