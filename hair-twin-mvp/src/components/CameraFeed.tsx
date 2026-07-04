import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

interface CameraFeedProps {
  isActive: boolean;
  onCameraError?: (message: string) => void;
}

export interface CameraFeedHandle {
  captureFrame: () => string | null;
  triggerCaptureSignal: () => void;
}

const CameraFeed = forwardRef<CameraFeedHandle, CameraFeedProps>(({ isActive, onCameraError }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [signal, setSignal] = useState<"idle" | "captured">("idle");

  useImperativeHandle(ref, () => ({
    captureFrame: () => {
      if (!videoRef.current || !videoRef.current.videoWidth) return null;

      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");

      if (!ctx) return null;

      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoRef.current, 0, 0);

      return canvas.toDataURL("image/jpeg", 0.92);
    },
    triggerCaptureSignal: () => {
      setSignal("captured");
      window.setTimeout(() => setSignal("idle"), 900);
    }
  }));

  useEffect(() => {
    let activeStream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        activeStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: "user"
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = activeStream;
        }
      } catch (error) {
        console.error("Camera access failed:", error);
        onCameraError?.("카메라 권한을 받지 못했습니다. 이미지 업로드나 샘플 고객으로 계속 진행할 수 있습니다.");
      }
    };

    if (isActive) {
      void startCamera();
    } else if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }

    return () => {
      activeStream?.getTracks().forEach((track) => track.stop());
    };
  }, [isActive, onCameraError]);

  return (
    <div className="camera-feed">
      <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
      <div className="camera-grid" />
      <div className={`face-guide ${signal === "captured" ? "is-captured" : ""}`}>
        <div className="guide-ring" />
        <div className="guide-shoulders" />
        <span>{signal === "captured" ? "캡처 완료" : "얼굴과 헤어라인을 가이드 안에 맞춰주세요"}</span>
      </div>
    </div>
  );
});

CameraFeed.displayName = "CameraFeed";

export default CameraFeed;
