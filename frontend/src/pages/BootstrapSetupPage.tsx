import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FaLock, FaCamera, FaUpload, FaCheckCircle, FaExclamationTriangle,
  FaShieldAlt, FaLightbulb, FaUserShield, FaUser, FaEnvelope,
  FaPhone, FaMapMarkerAlt, FaBriefcase, FaLifeRing, FaArrowRight, FaArrowLeft,
} from 'react-icons/fa';
import FaceCamera from '@components/camera/FaceCamera';
import { authApi } from '@api/authApi';

// WEBSITECHK_BOOTSTRAP_EXPANSION — Full admin configuration center
// Steps: 1=Profile, 2=Recovery, 3=Password, 4=Face

type SetupStep = 1 | 2 | 3 | 4;

interface AdminProfile {
  name: string;
  email: string;
  phone: string;
  address: string;
  designation: string;
}

interface RecoveryInfo {
  recoveryEmail: string;
  recoveryPhone: string;
}

const BootstrapSetupPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<SetupStep>(1);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Recovery Mode states
  const [isRecovery] = useState(() => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('recovery') === 'true';
  });
  const [isOtpVerified, setIsOtpVerified] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState('');

  const handleSendOtp = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    setOtpLoading(true);
    try {
      const res = await authApi.initiateAdminRecovery();
      if (res.data.success) {
        setOtpSent(true);
        setMaskedEmail(res.data.recoveryEmailMasked);
        setSuccessMessage(res.data.message || 'OTP sent successfully.');
      } else {
        setErrorMessage(res.data.error || 'Failed to send OTP.');
      }
    } catch (err: any) {
      setErrorMessage(err.response?.data?.error || err.message || 'Failed to initiate admin recovery.');
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMessage('');
    setSuccessMessage('');
    if (!otp.trim()) {
      setErrorMessage('Please enter the OTP.');
      return;
    }
    setOtpLoading(true);
    try {
      const res = await authApi.verifyAdminRecoveryOtp(otp.trim());
      if (res.data.success) {
        setIsOtpVerified(true);
        setSuccessMessage(res.data.message || 'Identity verified successfully.');
      } else {
        setErrorMessage(res.data.error || 'Failed to verify OTP.');
      }
    } catch (err: any) {
      setErrorMessage(err.response?.data?.error || err.message || 'Failed to verify OTP.');
    } finally {
      setOtpLoading(false);
    }
  };
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Step 1: Admin Profile
  const [profile, setProfile] = useState<AdminProfile>({
    name: '',
    email: '',
    phone: '',
    address: '',
    designation: '',
  });

  // Step 2: Recovery Info
  const [recovery, setRecovery] = useState<RecoveryInfo>({
    recoveryEmail: '',
    recoveryPhone: '',
  });

  // Step 3: Password
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Step 4: Face
  const [frames, setFrames] = useState<string[]>([]);
  const [uploadMode, setUploadMode] = useState<'camera' | 'upload'>('camera');

  // Password validation
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const passwordsMatch = password === confirmPassword && password.length > 0;
  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasNumber;
  const isFaceCaptured = frames.length >= 5;

  // Validation per step
  const isStep1Valid = profile.name.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) &&
    profile.designation.trim().length >= 2;

  const isStep2Valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recovery.recoveryEmail);

  const isStep3Valid = isPasswordValid && passwordsMatch;

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const recoveryParam = urlParams.get('recovery') === 'true';
        const res = await authApi.checkBootstrapStatus(recoveryParam);
        if (res.data.success && !res.data.bootstrapMode) {
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
      const base64Data = frame.replace('data:image/jpeg;base64,', '');
      setFrames(prev => [...prev, base64Data]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      // FIX: FileReader.readAsDataURL() returns 'data:image/jpeg;base64,/9j...'
      // The prefix contains ':' ';' ',' which are invalid base64 characters and crash
      // Python's base64.b64decode() in the Face-AI service. Strip to pure base64 only.
      const base64String = (reader.result as string).split(',')[1] ?? '';
      setFrames(Array.from({ length: 5 }, () => base64String));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async () => {
    setErrorMessage('');
    setSuccessMessage('');

    if (!isStep1Valid || !isStep2Valid || !isStep3Valid || !isFaceCaptured) {
      setErrorMessage('Please complete all steps before submitting.');
      return;
    }

    setIsLoading(true);
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const recoveryParam = urlParams.get('recovery') === 'true';
      const res = await authApi.bootstrapSetup({
        password,
        frames,
        adminName: profile.name,
        adminEmail: profile.email,
        adminPhone: profile.phone,
        adminAddress: profile.address,
        adminDesignation: profile.designation,
        recoveryEmail: recovery.recoveryEmail,
        recoveryPhone: recovery.recoveryPhone,
      }, recoveryParam);

      if (res.data.success) {
        setSuccessMessage(res.data.message || 'Setup completed successfully.');
        setTimeout(() => navigate('/login', { replace: true }), 3000);
      } else {
        setErrorMessage(res.data.error || 'Failed to complete setup');
      }
    } catch (err: any) {
      const isUnavailable = err.response?.status === 503 || err.response?.data?.code === 'FACE_AI_UNAVAILABLE';
      if (isUnavailable) {
        setErrorMessage(
          'Face-AI Service Unavailable: Please start the face-recognition service and ensure it is healthy before completing setup.'
        );
      } else {
        setErrorMessage(err.response?.data?.error || err.message || 'An error occurred during setup.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingStatus) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center font-sans">
        <div className="h-12 w-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400">Verifying bootstrap status...</p>
      </div>
    );
  }

  const steps = [
    { id: 1, label: 'Profile', icon: FaUser },
    { id: 2, label: 'Recovery', icon: FaLifeRing },
    { id: 3, label: 'Password', icon: FaLock },
    { id: 4, label: 'Face', icon: FaCamera },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 font-sans select-none relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-indigo-950/20 blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full bg-violet-950/20 blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-2xl bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl shadow-2xl z-10"
      >
        {/* Header */}
        <div className="p-8 border-b border-slate-800">
          <div className="flex items-center gap-4 mb-2">
            <div className="h-14 w-14 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400 text-2xl flex-shrink-0">
              <FaUserShield />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
                System First-Time Setup
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">
                Configure the administrator account to get started
              </p>
            </div>
          </div>

          {/* Step progress */}
          <div className="flex items-center gap-0 mt-6">
            {steps.map((s, idx) => (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
                    step > s.id ? 'bg-emerald-500 text-white' :
                    step === s.id ? 'bg-indigo-500 text-white ring-4 ring-indigo-500/20' :
                    'bg-slate-800 text-slate-500'
                  }`}>
                    {step > s.id ? <FaCheckCircle className="text-sm" /> : <s.icon className="text-sm" />}
                  </div>
                  <span className={`text-xs mt-1 font-medium ${step === s.id ? 'text-indigo-400' : step > s.id ? 'text-emerald-400' : 'text-slate-600'}`}>
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 mb-4 rounded ${step > s.id ? 'bg-emerald-500' : 'bg-slate-800'}`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <AnimatePresence>
          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mx-6 mt-4 p-4 bg-red-950/30 border border-red-500/30 rounded-xl flex items-start gap-3 text-red-400 text-sm"
            >
              <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
              <span>{errorMessage}</span>
            </motion.div>
          )}
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mx-6 mt-4 p-4 bg-green-950/30 border border-green-500/30 rounded-xl flex items-start gap-3 text-green-400 text-sm"
            >
              <FaCheckCircle className="mt-0.5 flex-shrink-0" />
              <span>{successMessage} Redirecting...</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step Content */}
        <div className="p-8">
          <AnimatePresence mode="wait">
            {isRecovery && !isOtpVerified && (
              <motion.div
                key="otp-step"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="space-y-6"
              >
                <div className="bg-slate-950/40 border border-slate-800 rounded-xl p-6 text-sm text-slate-300 space-y-3">
                  <div className="flex items-center gap-2 text-indigo-400 font-bold">
                    <FaShieldAlt className="text-lg" />
                    <span>Security Verification Required</span>
                  </div>
                  <p>
                    To reset the system administrator's credentials, we must verify you own the recovery email address.
                  </p>
                  {otpSent && (
                    <p className="text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 rounded p-2.5">
                      Verification code has been sent to: <strong>{maskedEmail}</strong>
                    </p>
                  )}
                </div>

                {!otpSent ? (
                  <button
                    onClick={handleSendOtp}
                    disabled={otpLoading}
                    className="w-full py-3.5 bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/10 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
                  >
                    {otpLoading ? 'Sending...' : 'Send Verification OTP'} <FaArrowRight />
                  </button>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                        Verification Code (OTP)
                      </label>
                      <input
                        type="text"
                        value={otp}
                        onChange={e => setOtp(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600 text-center tracking-widest font-mono text-lg"
                        placeholder="Enter 6-digit OTP"
                        maxLength={6}
                      />
                    </div>
                    <div className="flex gap-4">
                      <button
                        onClick={handleSendOtp}
                        disabled={otpLoading}
                        className="flex-1 py-3 bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-200 rounded-xl font-bold transition-all text-sm disabled:opacity-50"
                      >
                        Resend
                      </button>
                      <button
                        onClick={handleVerifyOtp}
                        disabled={otpLoading}
                        className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/10 text-sm disabled:opacity-50"
                      >
                        {otpLoading ? 'Verifying...' : 'Verify & Continue'}
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── STEP 1: Admin Profile ── */}
            {(!isRecovery || isOtpVerified) && step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-6">
                  <FaUser className="text-indigo-400" /> Administrator Profile
                </h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                        Full Name <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <FaUser className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                        <input
                          type="text"
                          value={profile.name}
                          onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600"
                          placeholder="e.g. John Smith"
                        />
                      </div>
                    </div>

                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                        Email Address <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <FaEnvelope className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                        <input
                          type="email"
                          value={profile.email}
                          onChange={e => setProfile(p => ({ ...p, email: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600"
                          placeholder="admin@company.com"
                        />
                      </div>
                    </div>

                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                        Phone Number
                      </label>
                      <div className="relative">
                        <FaPhone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                        <input
                          type="tel"
                          value={profile.phone}
                          onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600"
                          placeholder="+1 555 0100"
                        />
                      </div>
                    </div>

                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                        Designation <span className="text-red-400">*</span>
                      </label>
                      <div className="relative">
                        <FaBriefcase className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                        <input
                          type="text"
                          value={profile.designation}
                          onChange={e => setProfile(p => ({ ...p, designation: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600"
                          placeholder="e.g. System Administrator"
                        />
                      </div>
                    </div>

                    <div className="col-span-2 md:col-span-1">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                        Address
                      </label>
                      <div className="relative">
                        <FaMapMarkerAlt className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                        <input
                          type="text"
                          value={profile.address}
                          onChange={e => setProfile(p => ({ ...p, address: e.target.value }))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600"
                          placeholder="Office address"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── STEP 2: Recovery ── */}
            {(!isRecovery || isOtpVerified) && step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-2">
                  <FaLifeRing className="text-indigo-400" /> Recovery Information
                </h2>
                <p className="text-slate-500 text-sm mb-6">
                  Used for account recovery, OTP verification, and emergency access. Keep this information secure.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Recovery Email <span className="text-red-400">*</span>
                    </label>
                    <div className="relative">
                      <FaEnvelope className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                      <input
                        type="email"
                        value={recovery.recoveryEmail}
                        onChange={e => setRecovery(r => ({ ...r, recoveryEmail: e.target.value }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600"
                        placeholder="recovery@example.com (different from primary)"
                      />
                    </div>
                    <p className="text-xs text-slate-600 mt-1">Should be different from your primary email</p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Recovery Phone
                    </label>
                    <div className="relative">
                      <FaPhone className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm" />
                      <input
                        type="tel"
                        value={recovery.recoveryPhone}
                        onChange={e => setRecovery(r => ({ ...r, recoveryPhone: e.target.value }))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200 placeholder-slate-600"
                        placeholder="+1 555 0199"
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-6 bg-slate-950/50 rounded-xl p-4 border border-amber-500/20 flex items-start gap-3">
                  <FaLightbulb className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-slate-400">
                    This recovery information is used during <strong className="text-slate-300">Admin Reset</strong> workflows.
                    An OTP will be sent to the recovery email to verify your identity before any admin account replacement.
                  </p>
                </div>
              </motion.div>
            )}

            {/* ── STEP 3: Password ── */}
            {(!isRecovery || isOtpVerified) && step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-6">
                  <FaLock className="text-indigo-400" /> Administrator Password
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      New Password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200"
                      placeholder="••••••••"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Confirm Password
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-500 transition-colors text-slate-200"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                {/* Password checklist */}
                <div className="mt-4 bg-slate-950/50 rounded-xl p-4 border border-slate-800/50 space-y-2 text-xs text-slate-400">
                  {[
                    { ok: hasMinLength, label: 'At least 8 characters' },
                    { ok: hasUppercase, label: 'One uppercase letter (A-Z)' },
                    { ok: hasLowercase, label: 'One lowercase letter (a-z)' },
                    { ok: hasNumber, label: 'One number (0-9)' },
                    { ok: passwordsMatch, label: 'Passwords match' },
                  ].map(({ ok, label }) => (
                    <div key={label} className="flex items-center gap-2">
                      <FaCheckCircle className={ok ? 'text-emerald-500' : 'text-slate-700'} />
                      <span className={ok ? 'text-slate-300' : ''}>{label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── STEP 4: Face Enrollment ── */}
            {(!isRecovery || isOtpVerified) && step === 4 && (
              <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2 mb-6">
                  <FaCamera className="text-indigo-400" /> Face Profile Enrollment
                </h2>

                {/* Mode tabs */}
                <div className="flex border-b border-slate-800 mb-5 text-xs font-semibold">
                  {['camera', 'upload'].map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setUploadMode(m as 'camera' | 'upload'); setFrames([]); }}
                      className={`flex-1 pb-3 text-center border-b-2 transition-colors capitalize ${
                        uploadMode === m
                          ? 'border-indigo-500 text-indigo-400'
                          : 'border-transparent text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {m === 'camera' ? '📷 Use Camera' : '📁 Upload Image'}
                    </button>
                  ))}
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
                            Scanning: {frames.length} / 5
                          </div>
                          <p className="text-xs text-slate-400">Keep looking at the camera</p>
                        </div>
                      )}
                      {isFaceCaptured && (
                        <div className="absolute inset-0 bg-emerald-900/30 border-2 border-emerald-500 flex items-center justify-center">
                          <div className="text-center">
                            <FaCheckCircle className="text-emerald-400 text-3xl mx-auto mb-2" />
                            <p className="text-emerald-300 text-sm font-semibold">Face captured!</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Captured: {frames.length} / 5</span>
                      {frames.length > 0 && (
                        <button type="button" onClick={() => setFrames([])} className="text-red-400 hover:text-red-300">
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-xl p-10 bg-slate-950 hover:bg-slate-950/80 transition-colors cursor-pointer group relative">
                      <input type="file" accept="image/*" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                      <FaUpload className="text-slate-600 text-3xl mb-3 group-hover:text-indigo-400 transition-colors" />
                      <p className="text-sm font-semibold text-slate-400 group-hover:text-slate-300 transition-colors">
                        Click to upload face image
                      </p>
                      <p className="text-xs text-slate-600 mt-1">PNG, JPG, or WEBP</p>
                    </label>
                    {isFaceCaptured && (
                      <div className="flex items-center justify-between bg-slate-950 border border-emerald-500/30 p-3 rounded-xl text-xs">
                        <div className="flex items-center gap-2 text-emerald-400 font-medium">
                          <FaCheckCircle /> Image loaded successfully
                        </div>
                        <button type="button" onClick={() => setFrames([])} className="text-red-400 hover:text-red-300">
                          Reset
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 bg-slate-950/40 p-4 border border-slate-800/80 rounded-xl flex items-start gap-3 text-xs text-slate-500">
                  <FaLightbulb className="text-indigo-400 mt-0.5 flex-shrink-0 text-base" />
                  <div>
                    <span className="font-bold text-slate-400">Guidelines: </span>
                    Good lighting, face directly at camera, remove glasses/mask. Face embeddings are stored securely encrypted.
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Footer */}
        {!(isRecovery && !isOtpVerified) && (
          <div className="p-6 border-t border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <FaShieldAlt className="text-indigo-400" />
            No biometric images stored in plaintext
          </div>

          <div className="flex items-center gap-3">
            {step > 1 && (
              <button
                type="button"
                onClick={() => { setStep((step - 1) as SetupStep); setErrorMessage(''); }}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition-colors"
              >
                <FaArrowLeft /> Back
              </button>
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={() => {
                  setErrorMessage('');
                  if (step === 1 && !isStep1Valid) { setErrorMessage('Please fill in required fields (Name, Email, Designation).'); return; }
                  if (step === 2 && !isStep2Valid) { setErrorMessage('Please provide a valid recovery email.'); return; }
                  if (step === 3 && !isStep3Valid) { setErrorMessage('Please set a valid password that meets all requirements.'); return; }
                  setStep((step + 1) as SetupStep);
                }}
                className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 text-white rounded-xl text-sm font-bold shadow-lg transition-all"
              >
                Next <FaArrowRight />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isLoading || !isFaceCaptured}
                className="flex items-center gap-2 px-8 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition-all text-sm"
              >
                {isLoading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Configuring...
                  </>
                ) : (
                  <>Complete Setup <FaCheckCircle /></>
                )}
              </button>
            )}
          </div>
        </div>
      )}
      </motion.div>
    </div>
  );
};

export default BootstrapSetupPage;
