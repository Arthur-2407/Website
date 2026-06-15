import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FaUser, FaLock, FaFingerprint, FaBuilding, FaShieldAlt,
  FaArrowRight, FaExclamationTriangle, FaCheckCircle, FaSpinner,
  FaEnvelope,
} from 'react-icons/fa';
import { useAuth } from '@contexts/AuthContext';
import { useNotification } from '@contexts/NotificationContext';
import type { User } from '@contexts/AuthContext';
import api from '@services/api';
import { authApi } from '@api/authApi';

// ────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────
interface PreLoginData {
  exists: boolean;
  role: 'admin' | 'supervisor' | 'employee' | null;
  has_password: boolean;
  has_face: boolean;
  required_method: 'face_and_password' | 'password_or_face' | 'password';
  missing_credentials: string[];
  needs_recovery: boolean;
  account_locked: boolean;
  locked_until: string | null;
}

type LoginStep = 'id_entry' | 'checking' | 'password' | 'face_required' | 'locked' | 'recovery_needed';

// ────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────
const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { showError, showSuccess } = useNotification();

  const [step, setStep] = useState<LoginStep>('id_entry');
  const [employeeId, setEmployeeId] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [preLoginData, setPreLoginData] = useState<PreLoginData | null>(null);
  const [idError, setIdError] = useState('');
  const [adminContact, setAdminContact] = useState<{ name: string; email: string | null; mailtoLink: string | null } | null>(null);

  // ── Bootstrap check + admin contact info (loaded once on mount) ──
  useEffect(() => {
    const checkBootstrap = async () => {
      try {
        const res = await api.get<{ success: boolean; bootstrapMode: boolean }>('/auth/bootstrap/status');
        if (res.data.success && res.data.bootstrapMode) {
          navigate('/setup/admin-face', { replace: true });
        }
      } catch (err) {
        console.error('Failed to check bootstrap status', err);
      }
    };
    const loadAdminContact = async () => {
      try {
        const res = await authApi.getAdminContactInfo();
        setAdminContact(res.data);
      } catch {
        // Non-fatal — contact link just won't be shown
      }
    };
    checkBootstrap();
    loadAdminContact();
  }, [navigate]);

  // ── Step 1: Check Employee ID and determine login method ──
  const handleCheckEmployeeId = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId.trim()) { setIdError('Please enter your Employee ID'); return; }
    setIdError('');
    setStep('checking');
    setIsLoading(true);

    try {
      const res = await api.post<PreLoginData & { success: boolean }>('/auth/pre-login-check', { employeeId });
      const data = res.data;
      setPreLoginData(data);

      if (data.account_locked) {
        setStep('locked');
        return;
      }

      if (!data.exists) {
        // Employee doesn't exist — show password step (will fail gracefully at login)
        setStep('password');
        return;
      }

      if (data.role === 'admin' && !data.has_face) {
        showError('Administrator face profile missing. Redirecting to setup center...');
        setTimeout(() => {
          navigate('/setup/admin-face', { replace: true });
        }, 1500);
        return;
      }

      if (data.needs_recovery) {
        setStep('recovery_needed');
        return;
      }

      // Route to appropriate step based on required method
      if (data.required_method === 'face_and_password') {
        // Admin or Supervisor: Need password first, then face
        setStep('password');
      } else {
        // Employee: either method — show both options
        setStep('password');
      }
    } catch (err: any) {
      setStep('password'); // Fallback to password if check fails
    } finally {
      setIsLoading(false);
    }
  }, [employeeId]);

  // ── Step 2: Password login ──
  const handlePasswordLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await api.post<{
        success: boolean;
        tokens: { accessToken: string; refreshToken: string };
        employee: User;
        message?: string;
        code?: string;
      }>('/auth/login', { employeeId, password });

      if (response.data.success) {
        login(response.data.tokens, response.data.employee);
        showSuccess('Login successful!');
        navigate('/dashboard');
      } else {
        showError(response.data.message || 'Login failed. Please try again.');
      }
    } catch (error: any) {
      if (error.response?.status === 403 && error.response?.data?.code === 'FACE_AUTHENTICATION_REQUIRED') {
        // Admin/Supervisor: password was correct but face is also needed
        showSuccess('Password verified. Face authentication required...');
        setTimeout(() => {
          navigate('/face-login', { state: { employeeId, password, requirePassword: true, passwordVerified: true } });
        }, 1000);
      } else if (error.response?.status === 423) {
        setStep('locked');
        setPreLoginData((d) => d ? { ...d, account_locked: true, locked_until: error.response?.data?.lockedUntil } : d);
      } else {
        showError(error.response?.data?.message || 'Login failed. Please check your credentials.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [employeeId, password, login, navigate, showError, showSuccess]);

  // ── Navigate to face login (for employees who prefer face-only) ──
  const goToFaceLogin = useCallback(() => {
    navigate('/face-login', { state: { employeeId } });
  }, [navigate, employeeId]);

  // ── Role badge ──
  const roleBadge = preLoginData?.role ? (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
      preLoginData.role === 'admin' ? 'bg-red-100 text-red-800' :
      preLoginData.role === 'supervisor' ? 'bg-yellow-100 text-yellow-800' :
      'bg-green-100 text-green-800'
    }`}>
      {preLoginData.role.charAt(0).toUpperCase() + preLoginData.role.slice(1)}
    </span>
  ) : null;

  // ── Login method indicator ──
  const loginMethodInfo = preLoginData ? (
    preLoginData.required_method === 'face_and_password' ? (
      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
        <FaShieldAlt className="text-amber-500 flex-shrink-0" />
        <span>Your role requires <strong>password + face verification</strong> for enhanced security.</span>
      </div>
    ) : (
      <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
        <FaCheckCircle className="text-blue-500 flex-shrink-0" />
        <span>You may sign in with <strong>password</strong> or <strong>face authentication</strong>.</span>
      </div>
    )
  ) : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        {/* Card */}
        <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600/80 to-indigo-700/80 p-8 text-center">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            >
              <FaBuilding className="mx-auto text-5xl text-white drop-shadow-lg" />
            </motion.div>
            <h1 className="text-2xl font-bold text-white mt-4 tracking-tight">Enterprise Attendance</h1>
            <p className="text-blue-200 mt-1 text-sm">Secure Employee Management Platform</p>
          </div>

          <div className="p-8 bg-white">
            <AnimatePresence mode="wait">
              {/* ── Step: ID Entry ── */}
              {step === 'id_entry' && (
                <motion.div key="id" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                  <h2 className="text-xl font-bold text-gray-800 mb-1">Welcome Back</h2>
                  <p className="text-gray-500 text-sm mb-6">Enter your Employee ID to continue</p>
                  <form onSubmit={handleCheckEmployeeId}>
                    <div className="mb-5">
                      <label htmlFor="employeeId" className="block text-sm font-medium text-gray-700 mb-1.5">Employee ID</label>
                      <div className="relative">
                        <FaUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          id="employeeId"
                          type="text"
                          value={employeeId}
                          onChange={(e) => { setEmployeeId(e.target.value); setIdError(''); }}
                          className={`w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors ${idError ? 'border-red-400' : 'border-gray-300'}`}
                          placeholder="e.g. EMP001 or ADMIN"
                          autoFocus
                          autoComplete="username"
                          required
                        />
                      </div>
                      {idError && <p className="mt-1.5 text-xs text-red-500">{idError}</p>}
                    </div>
                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-lg transition-all disabled:opacity-60"
                    >
                      Continue <FaArrowRight />
                    </button>
                  </form>

                  <div className="mt-6 relative">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                    <div className="relative flex justify-center text-xs"><span className="px-2 bg-white text-gray-500">Or sign in with face</span></div>
                  </div>
                  <button
                    onClick={() => navigate('/face-login')}
                    className="mt-4 w-full flex items-center justify-center gap-2 py-3 px-4 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <FaFingerprint className="text-blue-500" /> Face Authentication
                  </button>
                </motion.div>
              )}

              {/* ── Step: Checking ── */}
              {step === 'checking' && (
                <motion.div key="checking" className="text-center py-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <FaSpinner className="mx-auto text-3xl text-blue-500 animate-spin mb-3" />
                  <p className="text-gray-600">Verifying employee ID...</p>
                </motion.div>
              )}

              {/* ── Step: Account Locked ── */}
              {step === 'locked' && (
                <motion.div key="locked" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-6">
                  <FaExclamationTriangle className="mx-auto text-4xl text-red-500 mb-3" />
                  <h3 className="text-lg font-bold text-gray-800 mb-2">Account Locked</h3>
                  <p className="text-gray-600 text-sm mb-2">Too many failed attempts. Your account is temporarily locked.</p>
                  {preLoginData?.locked_until && (
                    <p className="text-xs text-gray-500">Locked until: {new Date(preLoginData.locked_until).toLocaleString()}</p>
                  )}
                  <button
                    onClick={() => { setStep('id_entry'); setPassword(''); }}
                    className="mt-6 text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >← Try different account</button>
                </motion.div>
              )}

              {/* ── Step: Recovery Needed ── */}
              {step === 'recovery_needed' && (
                <motion.div key="recovery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4">
                  <FaExclamationTriangle className="mx-auto text-4xl text-amber-500 mb-3 block text-center w-full" />
                  <h3 className="text-lg font-bold text-gray-800 mb-2 text-center">Credentials Missing</h3>
                  <p className="text-gray-600 text-sm mb-4 text-center">
                    Some required credentials for your account are missing:
                  </p>
                  {preLoginData?.missing_credentials && (
                    <ul className="list-disc list-inside text-sm text-red-600 mb-4 bg-red-50 rounded-lg p-3">
                      {preLoginData.missing_credentials.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  )}
                  <p className="text-xs text-gray-500 text-center mb-4">Please contact your administrator to recover your credentials, or submit a recovery request below.</p>
                  <button
                    onClick={() => navigate('/recovery-request', { state: { employeeId } })}
                    className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium text-sm transition-colors"
                  >
                    Request Credential Recovery
                  </button>
                  <button
                    onClick={() => { setStep('id_entry'); setPassword(''); }}
                    className="mt-3 w-full text-gray-600 hover:text-gray-800 text-sm"
                  >← Back</button>
                </motion.div>
              )}

              {/* ── Step: Password ── */}
              {step === 'password' && (
                <motion.div key="password" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="flex items-center justify-between mb-1">
                    <h2 className="text-xl font-bold text-gray-800">Sign In</h2>
                    {roleBadge}
                  </div>
                  <p className="text-gray-500 text-sm mb-4">
                    {employeeId && <span className="font-medium text-gray-700">{employeeId}</span>}
                  </p>

                  {loginMethodInfo}

                  <form onSubmit={handlePasswordLogin}>
                    <div className="mb-5">
                      <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                      <div className="relative">
                        <FaLock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          id="password"
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                          placeholder="Enter your password"
                          autoFocus
                          autoComplete="current-password"
                          required
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-semibold rounded-lg transition-all disabled:opacity-60"
                    >
                      {isLoading ? <><FaSpinner className="animate-spin" /> Signing in...</> : 'Sign In'}
                    </button>
                  </form>

                  {/* Employee can also use face-only */}
                  {preLoginData?.required_method === 'password_or_face' && (
                    <div className="mt-4">
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                        <div className="relative flex justify-center text-xs"><span className="px-2 bg-white text-gray-500">Or</span></div>
                      </div>
                      <button
                        onClick={goToFaceLogin}
                        className="mt-4 w-full flex items-center justify-center gap-2 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <FaFingerprint className="text-blue-500" /> Use Face Authentication Instead
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => { setStep('id_entry'); setPassword(''); }}
                    className="mt-4 w-full text-gray-500 hover:text-gray-700 text-sm text-center"
                  >← Use a different ID</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-gray-100 text-center">
              {adminContact?.email ? (
                <p className="text-xs text-gray-500">
                  Need an account?{' '}
                  <a
                    href={adminContact.mailtoLink || `mailto:${adminContact.email}`}
                    className="font-medium text-blue-600 hover:text-blue-500 inline-flex items-center gap-1"
                  >
                    <FaEnvelope className="text-xs" />
                    Contact {adminContact.name || 'administrator'}
                  </a>
                </p>
              ) : (
                <p className="text-xs text-gray-500">
                  Need an account?{' '}
                  <a href="mailto:admin@company.com" className="font-medium text-blue-600 hover:text-blue-500">
                    Contact administrator
                  </a>
                </p>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LoginPage;
