import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FaUserLock, FaCamera, FaShieldAlt, FaExclamationTriangle } from 'react-icons/fa';
import FaceCamera from '@components/camera/FaceCamera';
import LivenessIndicator from '@components/camera/LivenessIndicator';
import { authApi, FaceLoginData, FaceLoginResponse } from '@api/authApi';
import { useAuth } from '@contexts/AuthContext';
import { useNotification } from '@contexts/NotificationContext';
import { locationService } from '@services/locationService';
import { AxiosResponse } from 'axios';
import { useAsyncCoordinator } from '@hooks/useAsyncCoordinator';

interface CapturedFrame {
  data: string;
  timestamp: number;
}

// STABILIZATION: Processing timeout — prevents infinite spinner
const PROCESSING_TIMEOUT_MS = 30_000;
// SECURITY: Minimum frames required for reliable liveness + embedding generation
const MINIMUM_FRAMES_REQUIRED = 15;

const FaceLogin = () => {
  const navigate = useNavigate();
  const locationState = useLocation();
  const { login } = useAuth();
  const { showError, showSuccess } = useNotification();
  const coordinator = useAsyncCoordinator('face-login');
  
  const [employeeId, setEmployeeId] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [requirePassword, setRequirePassword] = useState<boolean>(false);
  const [frames, setFrames] = useState<CapturedFrame[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [livenessStatus, setLivenessStatus] = useState<'idle' | 'detecting' | 'success' | 'failed'>('idle');
  const [spoofDetected, setSpoofDetected] = useState<boolean>(false);
  const [challengeStep, setChallengeStep] = useState<number>(0);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Prefill Employee ID and check password requirement from navigation state
  useEffect(() => {
    if (locationState.state?.employeeId) {
      setEmployeeId(locationState.state.employeeId);
    }
    if (locationState.state?.requirePassword) {
      setRequirePassword(true);
    }
  }, [locationState.state]);

  // Dynamically toggle password field if "admin" or "supervisor" is typed
  useEffect(() => {
    const idLower = employeeId.toLowerCase();
    if (idLower === 'admin' || idLower === 'supervisor' || idLower.includes('admin') || idLower.includes('super')) {
      setRequirePassword(true);
    } else {
      if (!locationState.state?.requirePassword) {
        setRequirePassword(false);
      }
    }
  }, [employeeId, locationState.state]);

  // STABILIZATION: Refs for timeout/abort management
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get user location
  useEffect(() => {
    const getLocation = async () => {
      try {
        const loc = await locationService.getCurrentPosition();
        setLocation({
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
      } catch (err) {
        console.error('Location error:', err);
        setLocationError('Unable to get location. Login may be restricted.');
      }
    };

    getLocation();
  }, []);

  // STABILIZATION: Cleanup timeouts and abort controllers on unmount
  useEffect(() => {
    return () => {
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // Handle frame capture
  const handleFrameCapture = (frame: string) => {
    // Remove data URL prefix
    const base64Data = frame.replace('data:image/jpeg;base64,', '');
    
    setFrames((prev: CapturedFrame[]) => [
      ...prev.slice(-19), // Keep only last 19 frames
      {
        data: base64Data,
        timestamp: Date.now(),
      },
    ]);
  };

  // STABILIZATION: Reset processing state safely
  const resetProcessingState = () => {
    setIsProcessing(false);
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
  };

  // Handle face login with optional step override
  const handleFaceLoginWithStep = async (step?: number) => {
    const effectiveStep = step !== undefined ? step : challengeStep;
    if (!employeeId) {
      showError('Please enter your employee ID');
      return;
    }

    if (frames.length < MINIMUM_FRAMES_REQUIRED) {
      showError(`Not enough frames captured. Please wait for at least ${MINIMUM_FRAMES_REQUIRED} frames.`);
      return;
    }

    // STABILIZATION: Prevent duplicate submissions
    if (isProcessing) {
      console.warn('[FaceLogin] Login already in progress, ignoring duplicate submit.');
      return;
    }

    setIsProcessing(true);
    setLivenessStatus('detecting');

    // STABILIZATION: Set a processing timeout — auto-reset after 30s
    processingTimeoutRef.current = setTimeout(() => {
      console.warn('[FaceLogin] Processing timeout reached, resetting state.');
      resetProcessingState();
      setLivenessStatus('failed');
      showError('Authentication timed out. Please try again.');
    }, PROCESSING_TIMEOUT_MS);

    // STABILIZATION: Create AbortController for this request
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const loginData: FaceLoginData = {
        frames: frames.map((f: CapturedFrame) => f.data),
        employeeId,
        password: requirePassword ? password : undefined,
        challengeType: effectiveStep > 0 ? `challenge_${effectiveStep}` : undefined,
        location: location || undefined,
      };

      const loginPromise = authApi.faceLogin(loginData, abortController.signal);

      // Register task with central async coordinator for global tracing
      coordinator.register(
        'face-login',
        'auth-verification',
        loginPromise,
        abortController,
        () => {
          setIsProcessing(false);
          setLivenessStatus('failed');
        }
      );

      const response: AxiosResponse<FaceLoginResponse> = await loginPromise;

      // STABILIZATION: Check if request was aborted during flight
      if (abortController.signal.aborted) return;

      if (response.data.success && response.data.authenticated) {
        setLivenessStatus('success');
        showSuccess('Authentication successful!');
        
        if (response.data.tokens && response.data.employee) {
          login(response.data.tokens, response.data.employee);
          navigate('/dashboard');
        }
      } else {
        setLivenessStatus('failed');
        
        if (response.data.spoofDetected) {
          setSpoofDetected(true);
          showError('Spoof detection triggered. Login denied for security reasons.');
        } else {
          showError(response.data.message || 'Authentication failed');
        }
      }
    } catch (error: any) {
      if (error?.name === 'CanceledError' || abortController.signal.aborted) return;
      console.error('Login error:', error);
      setLivenessStatus('failed');
      showError(error.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      resetProcessingState();
      // STABILIZATION: Clear frame buffer after attempt to prevent stale frame resubmission
      setFrames([]);
    }
  };

  // Handle challenge response — pass step value directly to avoid stale closure
  const handleChallenge = (step: number) => {
    setChallengeStep(step);
    handleFaceLoginWithStep(step);
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-blue-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="md:flex">
          {/* Left Panel - Camera */}
          <div className="md:w-1/2 bg-gray-900 p-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center justify-center">
                <FaCamera className="mr-2" />
                Face Authentication
              </h2>
              <p className="text-gray-400 mt-2">
                Position your face in the frame for verification
              </p>
            </div>

            <div className="aspect-square max-w-md mx-auto">
              <FaceCamera
                onCapture={handleFrameCapture}
                className="w-full h-full"
                autoCapture={true}
                captureInterval={100}
              />
            </div>

            {/* Security indicators */}
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="bg-gray-800 p-3 rounded-lg text-center">
                <FaShieldAlt className="mx-auto text-green-500 text-xl" />
                <p className="text-xs text-gray-400 mt-1">Anti-Spoof</p>
              </div>
              <div className="bg-gray-800 p-3 rounded-lg text-center">
                <FaUserLock className="mx-auto text-blue-500 text-xl" />
                <p className="text-xs text-gray-400 mt-1">Liveness</p>
              </div>
              <div className="bg-gray-800 p-3 rounded-lg text-center">
                <FaCamera className="mx-auto text-purple-500 text-xl" />
                <p className="text-xs text-gray-400 mt-1">Detection</p>
              </div>
            </div>
          </div>

          {/* Right Panel - Login Form */}
          <div className="md:w-1/2 p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-800">Employee Login</h1>
              <p className="text-gray-600 mt-2">
                Secure face authentication system
              </p>
            </div>

            {/* Employee ID Input */}
            <div className="mb-6">
              <label htmlFor="employeeId" className="block text-sm font-medium text-gray-700 mb-2">
                Employee ID
              </label>
              <input
                type="text"
                id="employeeId"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Enter your employee ID"
              />
            </div>

            {/* Password Input (Admin/Supervisor) */}
            {requirePassword && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mb-6"
              >
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your password"
                  required={requirePassword}
                />
              </motion.div>
            )}

            {/* Location Status */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Location Status
                </label>
                {location ? (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Detected
                  </span>
                ) : (
                  <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                    {locationError ? 'Error' : 'Detecting...'}
                  </span>
                )}
              </div>
              {location ? (
                <p className="text-sm text-gray-600">
                  Latitude: {location.latitude.toFixed(6)}, Longitude: {location.longitude.toFixed(6)}
                </p>
              ) : (
                <p className="text-sm text-gray-600">
                  {locationError || 'Getting your location...'}
                </p>
              )}
            </div>

            {/* Liveness Indicator */}
            <div className="mb-6">
              <LivenessIndicator
                status={livenessStatus}
                blinkCount={Math.min(frames.length / 5, 2)}
                confidence={frames.length > 0 ? Math.min(frames.length / 20, 1) : undefined}
              />
            </div>

            {/* Frame count */}
            <div className="mb-6">
              <div className="flex justify-between text-sm mb-1">
                <span>Frames Captured</span>
                <span>{frames.length}/20</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((frames.length / 20) * 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Spoof Alert */}
            {spoofDetected && (
              <div className="mb-6 p-4 bg-red-100 border border-red-300 rounded-lg">
                <div className="flex items-start">
                  <FaExclamationTriangle className="text-red-500 text-xl mr-2 mt-0.5" />
                  <div>
                    <h3 className="font-medium text-red-800">Security Alert</h3>
                    <p className="text-sm text-red-700 mt-1">
                      Spoof detection has been triggered. This incident has been logged and reported to security.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Challenge Buttons */}
            {challengeStep === 0 && (
              <div className="mb-6">
                <button
                  onClick={() => handleChallenge(1)}
                  disabled={isProcessing}
                  className="w-full mb-3 px-4 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all disabled:opacity-50"
                >
                  Start Challenge Verification
                </button>
              </div>
            )}

            <button
              onClick={() => handleFaceLoginWithStep()}
              disabled={isProcessing || !employeeId || frames.length < MINIMUM_FRAMES_REQUIRED}
              className={`w-full px-4 py-3 rounded-lg transition-all ${
                isProcessing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700 text-white'
              }`}
            >
              {isProcessing ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </span>
              ) : (
                'Authenticate with Face'
              )}
            </button>

            {/* Back to regular login */}
            <div className="mt-6 text-center">
              <button
                onClick={() => navigate('/login')}
                className="text-blue-600 hover:text-blue-800 text-sm"
              >
                Or sign in with password
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default FaceLogin;