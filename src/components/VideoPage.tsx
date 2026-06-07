import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { X, Camera, Monitor, MonitorStop, RotateCw, Square } from 'lucide-react';

interface VideoPageProps {
  onClose: () => void;
  isCameraActive: boolean;
  toggleCamera: () => void;
  facingMode: 'user' | 'environment';
  onSwitchCamera: (mode: 'user' | 'environment') => void;
  cameraStream: MediaStream | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isActive: boolean;
  sendVideoToLive: (base64Data: string) => void;
  sendTextToLive: (text: string) => void;
  onScreenShareChange: (sharing: boolean) => void;
}

export function VideoPage({
  onClose,
  isCameraActive,
  toggleCamera,
  facingMode,
  onSwitchCamera,
  cameraStream,
  canvasRef,
  isActive,
  sendVideoToLive,
  sendTextToLive,
  onScreenShareChange,
}: VideoPageProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localCanvasRef = useRef<HTMLCanvasElement>(null);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeout = useRef<any>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenIntervalRef = useRef<any>(null);
  const [elapsed, setElapsed] = useState(0);
  const isRecording = isCameraActive || isSharingScreen;

  useEffect(() => {
    if (localVideoRef.current && cameraStream && !isSharingScreen) {
      localVideoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, isSharingScreen]);

  useEffect(() => {
    if (!isActive) {
      const el = localVideoRef.current;
      if (el) el.srcObject = null;
    }
  }, [isActive]);

  useEffect(() => {
    return () => {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
        screenIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isRecording) {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleToggle = () => {
    if (isSharingScreen) return;
    setIsConnecting(true);
    toggleCamera();
    setTimeout(() => setIsConnecting(false), 800);
  };

  const handleSwapCamera = () => {
    if (!isCameraActive || isSharingScreen) return;
    const next = facingMode === 'user' ? 'environment' : 'user';
    onSwitchCamera(next);
  };

  const canScreenShare = typeof navigator !== 'undefined' && 'getDisplayMedia' in navigator.mediaDevices;

  const toggleScreenShare = async () => {
    if (isSharingScreen) {
      // Stop screen share or camera fallback
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
      }
      if (screenIntervalRef.current) {
        clearInterval(screenIntervalRef.current);
        screenIntervalRef.current = null;
      }
      setIsSharingScreen(false);
      onScreenShareChange(false);
      if (canScreenShare) {
        sendTextToLive("The user stopped sharing their screen.");
      } else {
        sendTextToLive("The user stopped sharing their view from the rear camera.");
      }
      if (localVideoRef.current && isCameraActive && cameraStream) {
        localVideoRef.current.srcObject = cameraStream;
      } else if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
      }
      return;
    }

    if (!canScreenShare) {
      // Mobile fallback: use rear camera instead of screen share
      // This works on all devices — point the phone at whatever you want to show
      if (!(isCameraActive && facingMode === 'environment')) {
        onSwitchCamera('environment');
      }
      // Camera is now (or already was) showing the rear view, which works as mobile "screen share"

      setIsSharingScreen(true);
      onScreenShareChange(true);
      sendTextToLive("The user is now sharing their view with you through their rear camera. They're pointing their phone at whatever they want to show you. React naturally - look at what they're showing you, comment on it casually, help them with what you see. Keep it conversational like you're looking over their shoulder.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      });
      screenStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      onScreenShareChange(true);

      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        setIsSharingScreen(false);
        screenStreamRef.current = null;
        if (screenIntervalRef.current) {
          clearInterval(screenIntervalRef.current);
          screenIntervalRef.current = null;
        }
        onScreenShareChange(false);
        sendTextToLive("The user stopped sharing their screen.");
        if (localVideoRef.current && isCameraActive && cameraStream) {
          localVideoRef.current.srcObject = cameraStream;
        } else if (localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
      });

      setIsSharingScreen(true);
      sendTextToLive("The user is now sharing their screen with you. You can see their screen. React naturally - look at what they're showing you, comment on it casually, help them with what you see. Keep it conversational like you're looking over their shoulder.");

      screenIntervalRef.current = setInterval(() => {
        if (!localCanvasRef.current || !localVideoRef.current || !isActive) return;
        const video = localVideoRef.current;
        const canvas = localCanvasRef.current;

        if (video.videoWidth > 0 && video.videoHeight > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.4);
            const base64Data = dataUrl.split(',')[1];
            sendVideoToLive(base64Data);
          }
        }
      }, 300);
    } catch (err) {
      console.error('Screen sharing error:', err);
    }
  };

  const handleTap = () => {
    setShowControls(prev => {
      if (prev) {
        if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
        return true;
      }
      return true;
    });

    if (controlsTimeout.current) clearTimeout(controlsTimeout.current);
    controlsTimeout.current = setTimeout(() => setShowControls(false), 3000);
  };

  useEffect(() => {
    controlsTimeout.current = setTimeout(() => setShowControls(false), 4000);
    return () => clearTimeout(controlsTimeout.current);
  }, []);

  const hasStream = isCameraActive || isSharingScreen;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] flex flex-col h-[100dvh]"
      onClick={handleTap}
    >
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={localCanvasRef} className="hidden" />

      <header
        className={`absolute top-0 left-0 right-0 z-20 px-3 sm:px-5 py-3 sm:py-4 flex items-center justify-between transition-all duration-500 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}
      >
        <button
          onClick={onClose}
          className="p-2.5 rounded-full bg-white/5 backdrop-blur-2xl border border-white/10 text-white hover:bg-white/10 active:scale-95 transition-all"
          aria-label="Close video"
          title="Close video"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          {isRecording && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-2xl border border-white/10">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
              <span className="text-[11px] text-white font-['SF_Pro_Text',system-ui,sans-serif] font-semibold tabular-nums tracking-wider">
                {formatTime(elapsed)}
              </span>
              {isSharingScreen && (
                <span className="text-[9px] text-orange-300 font-semibold uppercase tracking-wider ml-1">
                  Share
                </span>
              )}
            </div>
          )}
        </div>

        <div className="w-9" />
      </header>

      <div className="flex-1 flex items-center justify-center relative video-viewport-dark">
        {hasStream ? (
          <video
            ref={localVideoRef}
            className={`w-full h-full ${isSharingScreen ? 'object-contain' : 'object-cover'} ${isCameraActive && facingMode === 'user' ? '-scale-x-100' : ''}`}
            autoPlay
            playsInline
            muted
          />
        ) : (
          <div className="flex flex-col items-center gap-6 text-center px-8">
            <div className="w-20 h-20 rounded-full bg-white/5 backdrop-blur-2xl border border-white/10 flex items-center justify-center">
              <Camera className="w-9 h-9 text-white/30" />
            </div>
            <div>
              <p className="text-white/50 text-base font-['SF_Pro_Text',system-ui,sans-serif] font-medium mb-1 tracking-tight">Camera Off</p>
              <p className="text-white/20 text-sm font-['SF_Pro_Text',system-ui,sans-serif]">Enable your camera or share your screen</p>
            </div>
          </div>
        )}

        <div
          className={`absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none transition-opacity duration-300 ${
            showControls ? 'opacity-100' : 'opacity-0'
          }`}
        />
      </div>

      <footer
        className={`absolute bottom-0 left-0 right-0 z-20 pb-10 px-6 flex items-center justify-center gap-6 transition-all duration-500 ${
          showControls ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        <button
          onClick={handleSwapCamera}
          disabled={!isCameraActive || isSharingScreen}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 ${
            !isCameraActive || isSharingScreen
              ? 'bg-white/5 border border-white/5 text-white/20 opacity-50 cursor-not-allowed'
              : 'bg-white/5 backdrop-blur-2xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/20'
          }`}
          title="Switch camera"
        >
          <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        <button
          onClick={handleToggle}
          disabled={isConnecting || isSharingScreen}
          className={`w-14 h-14 sm:w-[68px] sm:h-[68px] rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 shadow-xl ${
            isSharingScreen
              ? 'bg-white/5 border border-white/5 text-white/20 opacity-50 cursor-not-allowed'
              : isCameraActive
                ? 'bg-red-500/20 border-2 border-red-500/40 text-red-500 hover:bg-red-500/30'
                : 'bg-white/10 backdrop-blur-2xl border border-white/15 text-white/80 hover:bg-white/15 hover:text-white'
          }`}
          title={isCameraActive ? 'Stop recording' : 'Start camera'}
        >
          {isCameraActive ? (
            <Square className="w-4 h-4 sm:w-5 sm:h-5 fill-current" />
          ) : (
            <Camera className="w-5 h-5 sm:w-6 sm:h-6" />
          )}
        </button>

        <button
          onClick={toggleScreenShare}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 ${
            isSharingScreen
              ? 'bg-[#d0a78b]/20 border-2 border-[#d0a78b]/40 text-[#d0a78b] hover:bg-[#d0a78b]/30'
              : 'bg-white/5 backdrop-blur-2xl border border-white/10 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/20'
          }`}
          title={isSharingScreen ? 'Stop sharing' : canScreenShare ? 'Share screen' : 'Share via camera'}
        >
          {isSharingScreen ? (
            <MonitorStop className="w-4 h-4 sm:w-5 sm:h-5" />
          ) : (
            <Monitor className="w-4 h-4 sm:w-5 sm:h-5" />
          )}
        </button>
      </footer>
    </motion.div>
  );
}
