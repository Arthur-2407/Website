import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FaLock, FaCamera, FaUpload, FaCheckCircle, FaExclamationTriangle, FaShieldAlt, FaLightbulb, FaUserShield } from 'react-icons/fa';
import FaceCamera from '@components/camera/FaceCamera';
import { authApi } from '@api/authApi';

const BootstrapSetupPage = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [frames, setFrames] = useState<string[]>([]);
  const [uploadMode, setUploadMode] = useState<'camera' | 'upload'>('camera');
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Password rules validation
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;
  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasNumber;

  // Face capture state
  const isFaceCaptured = frames.length >= 5;

  useEffect(() => {
    // Check bootstrap status on mount
    const checkStatus = async () => {
      try {
        const res = await authApi.checkBootstrapStatus();
        if (res.data.success && !res.data.bootstrapMode) {
          // If bootstrap mode is not active, redirect to login
          navigate('/login', { replace: true });
        }
      } catch (err) {
        console.error('Failed to verify bootstrap status', err);
      } finally {
        setIsCheckingStatus(false);
      }
    };
    checkStatus();
  }, [navigate]);

  const handleFrameCapture = (frame: string) => {
    if (frames.length < 5) {
      setFrames((prev) => [...prev, frame]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // For bootstrapping, duplicate the uploaded frame 5 times to simulate the multi-frame structure
      setFrames(Array.from({ length: 5 }, () => base64String));
    };
    reader.readAsDataURL(file);
  };

  const handleResetFrames = () => {
    setFrames([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!isPasswordValid) {
      setErrorMessage('Please ensure your password meets all safety requirements.');
      return;
    }

    if (!passwordsMatch) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (!isFaceCaptured) {
      setErrorMessage('Please capture at least 5 face frames or upload a face profile picture.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authApi.bootstrapSetup({ password, frames });
      if (res.data.success) {
        setSuccessMessage(res.data.message || 'Setup completed successfully.');
        setTimeout(() => {
          navigate('/login', { replace: true });
        }, 3000);
      } else {
        setErrorMessage(res.data.error || 'Failed to complete setup');
      }
    } catch (err: any) {
      setErrorMessage(
        err.response?.data?.error || err.message || 'An error occurred during bootstrap setup.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingStatus) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center font-sans">
        <div className="h-12 w-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400">Initializing Bootstrap Mode verification...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans select-none relative overflow-hidden">
      {/* Background elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-950/20 blur-3xl" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-violet-950/20 blur-3xl" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-4xl bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 z-10"
      >
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-16 w-16 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400 text-3xl mb-4 shadow-inner">
            <FaUserShield />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
            System First-Time Setup
          </h1>
          <p className="text-slate-400 mt-2 text-sm sm:text-base max-w-lg">
            This system is currently running in **Bootstrap Mode** because no administrator face credential is enrolled. Please complete the security setup below.
          </p>
        </div>

        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-6 p-4 bg-red-950/30 border border-red-500/30 rounded-xl flex items-start space-x-3 text-red-400 text-sm"
          >
            <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
            <span>{errorMessage}</span>
          </motion.div>
        )}

        {successMessage && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-6 p-4 bg-green-950/30 border border-green-500/30 rounded-xl flex items-start space-x-3 text-green-400 text-sm"
          >
            <FaCheckCircle className="mt-0.5 flex-shrink-0" />
            <span>{successMessage} Redirecting to login...</span>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Column 1: Password Configuration */}
          <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center text-slate-200">
              <FaLock className="mr-2 text-indigo-400" />
              1. Administrator Password
            </h2>
            <p className="text-xs text-slate-500">
              Create a strong password for recovery and multi-factor authentication checkups.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  New Admin Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {/* Password Validation Checklist */}
            <div className="bg-slate-950/50 rounded-xl p-4 border border-slate-800/50 space-y-2 text-xs text-slate-400">
              <div className="flex items-center">
                <FaCheckCircle className={`mr-2 ${hasMinLength ? 'text-green-500' : 'text-slate-700'}`} />
                <span>At least 8 characters long</span>
              </div>
              <div className="flex items-center">
                <FaCheckCircle className={`mr-2 ${hasUppercase ? 'text-green-500' : 'text-slate-700'}`} />
                <span>At least one uppercase letter (A-Z)</span>
              </div>
              <div className="flex items-center">
                <FaCheckCircle className={`mr-2 ${hasLowercase ? 'text-green-500' : 'text-slate-700'}`} />
                <span>At least one lowercase letter (a-z)</span>
              </div>
              <div className="flex items-center">
                <FaCheckCircle className={`mr-2 ${hasNumber ? 'text-green-500' : 'text-slate-700'}`} />
                <span>At least one number (0-9)</span>
              </div>
              <div className="flex items-center border-t border-slate-800/80 pt-2 mt-2">
                <FaCheckCircle className={`mr-2 ${passwordsMatch ? 'text-green-500' : 'text-slate-700'}`} />
                <span>Passwords match</span>
              </div>
            </div>
          </div>

          {/* Column 2: Face Enrollment */}
          <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center text-slate-200">
              <FaCamera className="mr-2 text-indigo-400" />
              2. Administrator Face Profile
            </h2>

            <div className="flex border-b border-slate-800 mb-4 text-xs font-semibold">
              <button
                type="button"
                className={`flex-1 pb-3 text-center border-b-2 transition-colors ${
                  uploadMode === 'camera'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
                onClick={() => setUploadMode('camera')}
              >
                Use Camera
              </button>
              <button
                type="button"
                className={`flex-1 pb-3 text-center border-b-2 transition-colors ${
                  uploadMode === 'upload'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
                onClick={() => setUploadMode('upload')}
              >
                Upload Image File
              </button>
            </div>

            {uploadMode === 'camera' ? (
              <div className="space-y-4">
                <div className="relative aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                  <FaceCamera
                    onCapture={handleFrameCapture}
                    showControls={false}
                    autoCapture={frames.length < 5}
                    captureInterval={300}
                    className="w-full h-full"
                  />
                  {frames.length > 0 && frames.length < 5 && (
                    <div className="absolute inset-0 bg-slate-950/60 flex flex-col items-center justify-center">
                      <div className="text-indigo-400 text-xl font-bold mb-1 animate-pulse">
                        Scanning Face: {frames.length} / 5
                      </div>
                      <p className="text-xs text-slate-400">Keep looking at the camera</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Captured Frames: {frames.length} / 5</span>
                  {frames.length > 0 && (
                    <button
                      type="button"
                      onClick={handleResetFrames}
                      className="text-red-400 hover:underline"
                    >
                      Clear & Reset
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-xl p-8 bg-slate-950 hover:bg-slate-950/80 transition-colors relative cursor-pointer group">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                  <FaUpload className="text-slate-600 text-3xl mb-3 group-hover:text-indigo-400 transition-colors" />
                  <p className="text-sm font-semibold text-slate-400 group-hover:text-slate-300 transition-colors">
                    Click to upload face image
                  </p>
                  <p className="text-xs text-slate-600 mt-1">PNG, JPG, or WEBP formats</p>
                </div>

                {isFaceCaptured && (
                  <div className="flex items-center justify-between bg-slate-950 border border-slate-800 p-3 rounded-xl text-xs">
                    <div className="flex items-center text-green-400 font-medium">
                      <FaCheckCircle className="mr-2" />
                      Face profile image loaded
                    </div>
                    <button
                      type="button"
                      onClick={handleResetFrames}
                      className="text-red-400 hover:underline"
                    >
                      Reset File
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Quality & Safety Check Indicator */}
            <div className="bg-slate-950/40 p-4 border border-slate-800/80 rounded-xl flex items-start space-x-3 text-xs text-slate-500">
              <FaLightbulb className="text-indigo-400 mt-0.5 flex-shrink-0 text-base" />
              <div className="space-y-1">
                <span className="font-bold text-slate-400">Face Scan Guidelines:</span>
                <p>Ensure good lighting, stand directly in front of the camera, and remove masks/glasses. The system will extract your face embeddings securely and discard raw images immediately.</p>
              </div>
            </div>
          </div>

          {/* Submit Button Section */}
          <div className="md:col-span-2 border-t border-slate-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center text-xs text-slate-500">
              <FaShieldAlt className="mr-2 text-indigo-400" />
              Data protection check: No raw biometric images are stored permanently in production.
            </div>
            <button
              type="submit"
              disabled={isLoading || !isPasswordValid || !passwordsMatch || !isFaceCaptured}
              className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg hover:shadow-indigo-500/20 transition-all text-sm flex items-center justify-center space-x-2"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Configuring administrator...</span>
                </>
              ) : (
                <span>Complete Setup</span>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default BootstrapSetupPage;
