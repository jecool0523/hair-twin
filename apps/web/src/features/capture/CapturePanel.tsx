"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Upload, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PreflightResult } from "@/lib/domain/types";
import type { MaskSummary } from "@/lib/domain/masks";
import { useVision, extractImageData } from "./useVision";

export interface CapturePayload {
  dataUrl: string;
  width: number;
  height: number;
  preflight: PreflightResult;
  maskSummary: MaskSummary;
}

type CameraState = "idle" | "requesting" | "streaming" | "denied" | "unsupported";

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
  const { preflight, buildMasks } = useVision();

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
    async (
      source: HTMLVideoElement | HTMLImageElement,
      dataUrl: string,
      width: number,
      height: number,
    ) => {
      setAnalyzing(true);
      try {
        const img = extractImageData(source);
        if (!img) return;
        const pre = await preflight(img);
        const masks = await buildMasks(img);
        setCaptured({ dataUrl, width, height, preflight: pre, maskSummary: masks });
      } finally {
        setAnalyzing(false);
      }
    },
    [preflight, buildMasks],
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
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const imgEl = new Image();
    imgEl.onload = () =>
      analyzeAndSet(imgEl, dataUrl, canvas.width, canvas.height);
    imgEl.src = dataUrl;
  }, [analyzeAndSet]);

  const onFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        const imgEl = new Image();
        imgEl.onload = () =>
          analyzeAndSet(imgEl, dataUrl, imgEl.naturalWidth, imgEl.naturalHeight);
        imgEl.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [analyzeAndSet],
  );

  const reset = () => setCaptured(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-primary" /> 고객 촬영
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
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
                src={captured.dataUrl}
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
