import { useRef, useEffect, useState } from 'react';
import { useCamera } from '@hooks/useCamera';
import { motion } from 'framer-motion';
import { FaCamera, FaVideo, FaVideoSlash } from 'react-icons/fa';

interface FaceCameraProps {
  onCapture?: (frame: string) => void;
  onStreamChange?: (stream: MediaStream | null) => void;
  className?: string;
  showControls?: boolean;
  autoCapture?: boolean;
  captureInterval?: number; // milliseconds
}

const FaceCamera = ({
  onCapture,
  onStreamChange,
  className = '',
  showControls = true,
  autoCapture = false,
  captureInterval = 200,
}: FaceCameraProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  // STABILIZATION: Ref to hold latest captureFrame so the interval closure is never stale
  const captureFrameRef = useRef<() => Promise<string | null>>(async () => null);
  const onCaptureRef = useRef(onCapture);
  const {
    stream,
    error,
    isStreaming,
    startCamera,
    stopCamera,
    captureFrame,
  } = useCamera();

  const [isAutoCapturing, setIsAutoCapturing] = useState(autoCapture);

  // STABILIZATION: Sync isAutoCapturing state when the autoCapture prop changes.
  // useState only initialises from the prop once; parent components that flip
  // autoCapture (e.g. BootstrapSetupPage setting it to false after 5 frames)
  // must be reflected so capturing stops in the camera loop.
  useEffect(() => {
    setIsAutoCapturing(autoCapture);
  }, [autoCapture]);

  // Keep refs up-to-date
  captureFrameRef.current = captureFrame;
  onCaptureRef.current = onCapture;

  // STABILIZATION: Refs for startCamera/stopCamera to avoid stale closures in effects
  const startCameraRef = useRef(startCamera);
  const stopCameraRef = useRef(stopCamera);
  startCameraRef.current = startCamera;
  stopCameraRef.current = stopCamera;

  // STABILIZATION: Auto-start camera on mount when autoCapture is true.
  // Uses refs to ensure cleanup always calls the latest stopCamera,
  // preventing stream leaks during StrictMode double-mounts.
  useEffect(() => {
    if (autoCapture) {
      startCameraRef.current();
    }
    // Cleanup: stop camera on unmount
    return () => {
      stopCameraRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps — only run on mount/unmount
  }, []);

  // Setup video stream
  useEffect(() => {
    if (stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      if (onStreamChange) {
        onStreamChange(stream);
      }
    }
  }, [stream, onStreamChange]);

  // Auto capture frames — uses throttled requestAnimationFrame to prevent thread blocks
  useEffect(() => {
    let animationFrameId: number | null = null;
    let lastCaptureTime = 0;

    const processFrame = async () => {
      if (!isAutoCapturing || !isStreaming) return;

      const now = Date.now();
      if (now - lastCaptureTime >= captureInterval) {
        lastCaptureTime = now;
        try {
          const frame = await captureFrameRef.current();
          if (frame && onCaptureRef.current) {
            onCaptureRef.current(frame);
          }
        } catch (err) {
          // STABILIZATION: Swallow errors in capture loop to prevent loop death
          console.warn('[FaceCamera] Frame capture error (non-fatal):', err);
        }
      }

      animationFrameId = requestAnimationFrame(processFrame);
    };

    if (isAutoCapturing && isStreaming) {
      animationFrameId = requestAnimationFrame(processFrame);
    }

    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    };
  }, [isAutoCapturing, isStreaming, captureInterval]);

  // Toggle auto capture
  const toggleAutoCapture = () => {
    setIsAutoCapturing(!isAutoCapturing);
  };

  // Manual capture
  const handleManualCapture = async () => {
    const frame = await captureFrame();
    if (frame && onCapture) {
      onCapture(frame);
    }
  };

  // Toggle camera
  const toggleCamera = async () => {
    if (isStreaming) {
      stopCamera();
    } else {
      await startCamera();
    }
  };

  return (
    <div className={`relative ${className}`}>
      {/* Video Preview */}
      <div className="relative bg-gray-900 rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
          style={{ transform: 'scaleX(-1)' }} // Mirror effect
        />
        
        {/* Camera overlay */}
        <div className="absolute inset-0 border-4 border-white rounded-lg pointer-events-none" />
        
        {/* Face detection indicator */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-blue-500 rounded-full w-64 h-64 opacity-70" />
        </div>

        {/* STABILIZATION: Show "Starting camera..." prompt when not yet streaming */}
        {!isStreaming && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-80">
            <div className="text-center">
              <div className="h-8 w-8 rounded-full border-4 border-blue-200 border-t-blue-500 animate-spin mx-auto mb-3" />
              <p className="text-gray-300 text-sm">Starting camera...</p>
            </div>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-2 p-2 bg-red-100 text-red-700 rounded-md">
          {error}
          <button
            onClick={() => startCamera()}
            className="ml-2 text-sm underline text-red-800 hover:text-red-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* Controls */}
      {showControls && (
        <div className="mt-3 flex justify-center space-x-4">
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={toggleCamera}
            className={`flex items-center px-4 py-2 rounded-md ${
              isStreaming
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {isStreaming ? <FaVideoSlash className="mr-2" /> : <FaVideo className="mr-2" />}
            {isStreaming ? 'Stop Camera' : 'Start Camera'}
          </motion.button>

          {isStreaming && (
            <>
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={handleManualCapture}
                className="flex items-center px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md"
              >
                <FaCamera className="mr-2" />
                Capture Frame
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={toggleAutoCapture}
                className={`flex items-center px-4 py-2 rounded-md ${
                  isAutoCapturing
                    ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                    : 'bg-purple-500 hover:bg-purple-600 text-white'
                }`}
              >
                {isAutoCapturing ? 'Stop Auto Capture' : 'Start Auto Capture'}
              </motion.button>
            </>
          )}
        </div>
      )}

    </div>
  );
};

export default FaceCamera;