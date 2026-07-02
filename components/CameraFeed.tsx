import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState } from 'react';

interface CameraFeedProps {
  isActive: boolean;
  onPostureDetected?: () => void; // Callback if we were doing real detection
}

export interface CameraFeedHandle {
  captureFrame: () => string | null;
  triggerPoseSuccess: () => void;
}

const CameraFeed = forwardRef<CameraFeedHandle, CameraFeedProps>(({ isActive }, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [poseState, setPoseState] = useState<'IDLE' | 'SUCCESS'>('IDLE');

  useImperativeHandle(ref, () => ({
    captureFrame: () => {
      if (!videoRef.current) return null;
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      // Mirror image horizontally on canvas to match user expectation
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoRef.current, 0, 0);
      
      return canvas.toDataURL('image/jpeg', 0.9);
    },
    triggerPoseSuccess: () => {
        setPoseState('SUCCESS');
        setTimeout(() => setPoseState('IDLE'), 1000);
    }
  }));

  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            facingMode: 'user'
          },
          audio: false
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
      }
    };

    if (isActive) {
      startCamera();
    } else {
      // Stop tracks if not active
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isActive]);

  return (
    <div className="absolute inset-0 w-full h-full bg-black overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover transform -scale-x-100" // Mirror effect
      />
      
      {/* Glass Scan Grid Effect (Subtle) */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:50px_50px] pointer-events-none"></div>

      {/* Posture Guide Overlay */}
      {isActive && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none transition-colors duration-300">
           <svg 
            viewBox="0 0 200 400" 
            className={`h-[80%] w-auto transition-all duration-500 ${poseState === 'SUCCESS' ? 'stroke-green-400 drop-shadow-[0_0_15px_rgba(74,222,128,0.8)]' : 'stroke-white/30 border-dashed'}`}
            fill="none" 
            strokeWidth="2"
            strokeDasharray={poseState === 'SUCCESS' ? "0" : "8 4"}
           >
              {/* Simplified Human Silhouette */}
              <path d="M100,30 
                       C120,30 135,45 135,65 
                       C135,80 125,90 115,95 
                       L140,110 
                       C155,120 160,140 160,180 
                       L155,250 
                       L170,380 
                       L130,380 
                       L120,260 
                       L110,260 
                       L100,260 
                       L90,260 
                       L80,260 
                       L70,380 
                       L30,380 
                       L45,250 
                       L40,180 
                       C40,140 45,120 60,110 
                       L85,95 
                       C75,90 65,80 65,65 
                       C65,45 80,30 100,30 Z" 
              />
           </svg>
           {poseState === 'IDLE' && (
             <div className="absolute top-1/4 text-white/50 text-sm font-light tracking-widest uppercase animate-pulse">
               Align Body within Guide
             </div>
           )}
           {poseState === 'SUCCESS' && (
             <div className="absolute top-1/4 text-green-400 text-lg font-bold tracking-widest uppercase animate-bounce">
               Perfect Posture
             </div>
           )}
        </div>
      )}
    </div>
  );
});

CameraFeed.displayName = 'CameraFeed';
export default CameraFeed;
