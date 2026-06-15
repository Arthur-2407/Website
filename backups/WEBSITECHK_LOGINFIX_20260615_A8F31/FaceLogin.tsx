import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FaUserLock, FaVideoSlash, FaShieldAlt, FaExclamationTriangle, FaEye, FaCheckCircle } from 'react-icons/fa';
import { MdSecurity, MdFaceRetouchingNatural } from 'react-icons/md';
import FaceCamera from '@components/camera/FaceCamera';
import { authApi, FaceLoginData, FaceLoginResponse, PreLoginCheckResponse } from '@api/authApi';
import { useAuth } from '@contexts/AuthContext';
import { useNotification } from '@contexts/NotificationContext';
import { locationService } from '@services/locationService';
import { AxiosResponse } from 'axios';
import { useAsyncCoordinator } from '@hooks/useAsyncCoordinator';

interface CapturedFrame {
  data: string;
  timestamp: number;
}

// WEBSITECHK_FACE_LOGIN_UX — Silent background authentication
// Minimum frames required before auto-triggering authentication
const MIN_FRAMES_FOR_AUTH = 10;
// Processing timeout
const PROCESSING_TIMEOUT_MS = 30_000;
// Auto-auth trigger delay after min frames collected (ms) — gives a natural feel
const AUTO_AUTH_DELAY_MS = 500;

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
  const [isCameraStopped, setIsCameraStopped] = useState<boolean>(false);
  const [livenessStatus, setLivenessStatus] = useState<'idle' | 'scanning' | 'success' | 'failed'>('idle');
  const [spoofDetected, setSpoofDetected] = useState<boolean>(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  // Pre-login data fetched from backend to determine auth requirements (no hardcoding)
  const [preLoginData, setPreLoginData] = useState<PreLoginCheckResponse | null>(null);
  const [isCheckingId, setIsCheckingId] = useState<boolean>(false);
  const [autoAuthTriggered, setAutoAuthTriggered] = useState<boolean>(false);

  // Refs for timeout/abort management
  const processingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const autoAuthTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prefill from navigation state
  useEffect(() => {
    if (locationState.state?.employeeId) {
      setEmployeeId(locationState.state.employeeId);
    }
    if (locationState.state?.requirePassword) {
      setRequirePassword(true);
    }
  }, [locationState.state]);

  // Get user location silently
  useEffect(() => {
    locationService.getCurrentPosition()
      .then(loc => setLocation({ latitude: loc.latitude, longitude: loc.longitude }))
      .catch(() => setLocationError('Location unavailable'));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (processingTimeoutRef.current) clearTimeout(processingTimeoutRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (autoAuthTimerRef.current) clearTimeout(autoAuthTimerRef.current);
    };
  }, []);

  // Check pre-login data to determine password requirement — NO hardcoding
  useEffect(() => {
    const checkEmployeeId = async () => {
      if (!employeeId || employeeId.length < 2) {
        setPreLoginData(null);
        setRequirePassword(locationState.state?.requirePassword || false);
        return;
      }
      setIsCheckingId(true);
      try {
        const res = await authApi.preLoginCheck({ employeeId });
        const data = res.data;
        setPreLoginData(data);
        // Require password only if backend says role needs face+password
        const needsPassword = data.required_method === 'face_and_password' || locationState.state?.requirePassword;
        setRequirePassword(!!needsPassword);
      } catch {
        // On error, default to requiring password only if explicitly told via state
        setRequirePassword(locationState.state?.requirePassword || false);
      } finally {
        setIsCheckingId(false);
      }
    };

    const debounce = setTimeout(checkEmployeeId, 600);
    return () => clearTimeout(debounce);
  }, [employeeId, locationState.state]);

  // Handle frame capture — keeps a rolling buffer of last 20 frames
  const handleFrameCapture = useCallback((frame: string) => {
    const base64Data = frame.replace('data:image/jpeg;base64,', '');
    setFrames(prev => [
      ...prev.slice(-19),
      { data: base64Data, timestamp: Date.now() },
    ]);
  }, []);

  const resetProcessingState = useCallback(() => {
    setIsProcessing(false);
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
  }, []);

  // Core authentication logic
  const handleFaceLogin = useCallback(async (currentFrames: CapturedFrame[]) => {
    if (!employeeId) {
      showError('Please enter your Employee ID');
      return;
    }
    if (requirePassword && !password) {
      showError('Password is required for your role');
      return;
    }
    if (currentFrames.length < MIN_FRAMES_FOR_AUTH) {
      showError('Positioning face... please wait');
      return;
    }
    if (isProcessing) return;

    setIsProcessing(true);
    setLivenessStatus('scanning');

    processingTimeoutRef.current = setTimeout(() => {
      resetProcessingState();
      setLivenessStatus('failed');
      showError('Authentication timed out. Please try again.');
    }, PROCESSING_TIMEOUT_MS);

    if (abortControllerRef.current) abortControllerRef.current.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const loginData: FaceLoginData = {
        frames: currentFrames.map((f: CapturedFrame) => f.data),
        employeeId,
        password: requirePassword ? password : undefined,
        location: location || undefined,
      };

      const loginPromise = authApi.faceLogin(loginData, abortController.signal);

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

      if (abortController.signal.aborted) return;

      if (response.data.success && response.data.authenticated) {
        setLivenessStatus('success');
        showSuccess('Authentication successful!');
        if (response.data.tokens && response.data.employee) {
          login(response.data.tokens, response.data.employee);
          setTimeout(() => navigate('/dashboard'), 800);
        }
      } else {
        setLivenessStatus('failed');
        setAutoAuthTriggered(false); // Allow retry
        if (response.data.spoofDetected) {
          setSpoofDetected(true);
          showError('Security alert: Spoof detection triggered. Please try again with your face.');
        } else {
          showError(response.data.message || 'Face authentication failed. Please try again.');
        }
      }
    } catch (error: any) {
      if (error?.name === 'CanceledError' || abortController.signal.aborted) return;
      setLivenessStatus('failed');
      setAutoAuthTriggered(false);
      showError(error.response?.data?.message || 'Login failed. Please try again.');
    } finally {
      resetProcessingState();
      setFrames([]);
    }
  }, [employeeId, password, requirePassword, location, isProcessing, coordinator, login, navigate, showError, showSuccess, resetProcessingState]);

  // Auto-trigger authentication when enough frames have been collected silently
  useEffect(() => {
    if (
      frames.length >= MIN_FRAMES_FOR_AUTH &&
      !isProcessing &&
      !autoAuthTriggered &&
      employeeId &&
      livenessStatus !== 'success' &&
      !isCameraStopped &&
      !(requirePassword && !password)
    ) {
      setAutoAuthTriggered(true);
      // Small delay for natural UX
      autoAuthTimerRef.current = setTimeout(() => {
        handleFaceLogin(frames);
      }, AUTO_AUTH_DELAY_MS);
    }
  }, [frames, isProcessing, autoAuthTriggered, employeeId, livenessStatus, isCameraStopped, requirePassword, password, handleFaceLogin]);

  // Reset auto-auth trigger when employee ID or password changes
  useEffect(() => {
    setAutoAuthTriggered(false);
    setLivenessStatus('idle');
    setFrames([]);
  }, [employeeId, password]);

  const handleStopCamera = () => {
    setIsCameraStopped(true);
    if (autoAuthTimerRef.current) clearTimeout(autoAuthTimerRef.current);
  };

  const statusConfig = {
    idle: { color: 'text-slate-400', bg: 'bg-slate-800', label: 'Position your face in the frame', icon: MdFaceRetouchingNatural },
    scanning: { color: 'text-blue-400', bg: 'bg-blue-900/40', label: 'Verifying identity...', icon: MdSecurity },
    success: { color: 'text-emerald-400', bg: 'bg-emerald-900/30', label: 'Authentication successful!', icon: FaCheckCircle },
    failed: { color: 'text-red-400', bg: 'bg-red-900/30', label: 'Verification failed — try again', icon: FaExclamationTriangle },
  };

  const currentStatus = statusConfig[livenessStatus];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-950 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-4xl"
      >
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          <div className="md:flex">
            {/* ── Left Panel: Camera (Auto-Start) ── */}
            <div className="md:w-1/2 bg-slate-900/80 p-6 flex flex-col">
              {/* Header */}
              <div className="text-center mb-5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 mb-3">
                  <MdFaceRetouchingNatural className="text-blue-400 text-2xl" />
                </div>
                <h2 className="text-xl font-bold text-white">Face Authentication</h2>
                <p className="text-slate-400 text-sm mt-1">Look directly at the camera</p>
              </div>

              {/* Camera View */}
              <div className="flex-1 relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 aspect-square max-w-sm mx-auto w-full">
                {!isCameraStopped ? (
                  <FaceCamera
                    onCapture={handleFrameCapture}
                    showControls={false}
                    autoCapture={true}
                    captureInterval={100}
                    className="w-full h-full"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900">
                    <FaVideoSlash className="text-slate-600 text-4xl mb-3" />
                    <p className="text-slate-500 text-sm">Camera stopped</p>
                    <button
                      onClick={() => { setIsCameraStopped(false); setAutoAuthTriggered(false); setLivenessStatus('idle'); }}
                      className="mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                    >
                      Restart Camera
                    </button>
                  </div>
                )}

                {/* Live scanning overlay */}
                <AnimatePresence>
                  {livenessStatus === 'scanning' && !isCameraStopped && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-blue-900/20 border-2 border-blue-500 rounded-2xl flex items-center justify-center"
                    >
                      <div className="text-center">
                        <div className="w-10 h-10 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                        <p className="text-blue-300 text-sm font-medium">Verifying...</p>
                      </div>
                    </motion.div>
                  )}
                  {livenessStatus === 'success' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="absolute inset-0 bg-emerald-900/30 border-2 border-emerald-500 rounded-2xl flex items-center justify-center"
                    >
                      <div className="text-center">
                        <FaCheckCircle className="text-emerald-400 text-4xl mx-auto mb-2" />
                        <p className="text-emerald-300 text-sm font-medium">Authenticated!</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Stop Camera button — only control shown */}
              {!isCameraStopped && (
                <div className="mt-4 text-center">
                  <button
                    onClick={handleStopCamera}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-xl border border-slate-700 transition-colors"
                  >
                    <FaVideoSlash className="text-slate-400" />
                    Stop Camera
                  </button>
                </div>
              )}

              {/* Security indicators */}
              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="bg-slate-800/60 rounded-xl p-3 text-center border border-slate-700/50">
                  <FaShieldAlt className="mx-auto text-emerald-500 text-lg mb-1" />
                  <p className="text-xs text-slate-400">Anti-Spoof</p>
                </div>
                <div className="bg-slate-800/60 rounded-xl p-3 text-center border border-slate-700/50">
                  <FaUserLock className="mx-auto text-blue-500 text-lg mb-1" />
                  <p className="text-xs text-slate-400">Liveness</p>
                </div>
                <div className="bg-slate-800/60 rounded-xl p-3 text-center border border-slate-700/50">
                  <FaEye className="mx-auto text-purple-500 text-lg mb-1" />
                  <p className="text-xs text-slate-400">Detection</p>
                </div>
              </div>
            </div>

            {/* ── Right Panel: Login Form ── */}
            <div className="md:w-1/2 p-8 bg-white flex flex-col">
              {/* Title */}
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Sign In</h1>
                <p className="text-gray-500 text-sm mt-1">Secure face-based authentication</p>
              </div>

              {/* Status indicator */}
              <motion.div
                key={livenessStatus}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`mb-6 rounded-xl px-4 py-3 flex items-center gap-3 ${currentStatus.bg}`}
              >
                <currentStatus.icon className={`${currentStatus.color} text-lg flex-shrink-0`} />
                <span className={`text-sm font-medium ${currentStatus.color}`}>
                  {currentStatus.label}
                </span>
                {livenessStatus === 'scanning' && (
                  <div className="ml-auto w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                )}
              </motion.div>

              {/* Employee ID */}
              <div className="mb-5">
                <label htmlFor="face-login-employee-id" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Employee ID
                </label>
                <input
                  id="face-login-employee-id"
                  type="text"
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm"
                  placeholder="e.g. EMP001 or ADMIN"
                  autoComplete="username"
                  disabled={isProcessing || livenessStatus === 'success'}
                />
                {isCheckingId && (
                  <p className="text-xs text-blue-500 mt-1 flex items-center gap-1">
                    <span className="inline-block w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Checking account...
                  </p>
                )}
              </div>

              {/* Password — shown only when backend says role requires it */}
              <AnimatePresence>
                {requirePassword && (
                  <motion.div
                    key="password-field"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-5 overflow-hidden"
                  >
                    <label htmlFor="face-login-password" className="block text-sm font-medium text-gray-700 mb-1.5">
                      Password
                      {preLoginData?.role && (
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-semibold ${
                          preLoginData.role === 'admin' ? 'bg-red-100 text-red-700' :
                          preLoginData.role === 'supervisor' ? 'bg-amber-100 text-amber-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {preLoginData.role}
                        </span>
                      )}
                    </label>
                    <input
                      id="face-login-password"
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      disabled={isProcessing || livenessStatus === 'success'}
                    />
                    <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                      <FaShieldAlt className="text-amber-500" />
                      Your role requires password + face verification
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Location indicator (silent) */}
              <div className="mb-5 flex items-center gap-2 text-xs text-gray-500">
                <span className={`inline-block w-2 h-2 rounded-full ${location ? 'bg-green-400' : 'bg-gray-300'}`} />
                {location ? 'Location verified' : locationError || 'Detecting location...'}
              </div>

              {/* Spoof Alert */}
              <AnimatePresence>
                {spoofDetected && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl"
                  >
                    <div className="flex items-start gap-2">
                      <FaExclamationTriangle className="text-red-500 text-lg mt-0.5 flex-shrink-0" />
                      <div>
                        <h3 className="font-semibold text-red-800 text-sm">Security Alert</h3>
                        <p className="text-xs text-red-700 mt-1">
                          Spoof detection triggered. This incident has been logged. Please present your actual face.
                        </p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Retry button — only shows after failure */}
              {livenessStatus === 'failed' && !isProcessing && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onClick={() => {
                    setLivenessStatus('idle');
                    setAutoAuthTriggered(false);
                    setFrames([]);
                    setSpoofDetected(false);
                  }}
                  className="mb-5 w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-xl transition-all text-sm"
                >
                  Try Again
                </motion.button>
              )}

              {/* Info note */}
              <div className="mt-auto pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 text-center">
                  Camera authenticates automatically • No manual action required
                </p>
              </div>

              {/* Back to password login */}
              <div className="mt-4 text-center">
                <button
                  onClick={() => navigate('/login')}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium transition-colors"
                >
                  ← Sign in with password only
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default FaceLogin;