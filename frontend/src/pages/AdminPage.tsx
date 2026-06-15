import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FaUsers,
  FaUserPlus,
  FaUserSlash,
  FaBuilding,
  FaClock,
  FaSearch,
  FaShieldAlt,
  FaTimes,
  FaCheck,
  FaLink,
  FaUnlink,
  FaChevronDown,
  FaChevronRight,
  FaLock,
  FaCamera,
  FaTrash,
  FaSync,
  FaExclamationTriangle,
  FaCheckCircle,
} from 'react-icons/fa';
import { adminApi, Employee, Supervisor, WorkTiming } from '@api/adminApi';
import { faceManagementApi, FaceChangeRequest, FaceAuditLog } from '@api/faceManagementApi';
import FaceCamera from '@components/camera/FaceCamera';
import { useNotification } from '@contexts/NotificationContext';
import { useAuth } from '@contexts/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'hierarchy' | 'employees' | 'supervisors' | 'timings' | 'mfa' | 'approvals' | 'system';

interface CreateEmployeeForm {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  department: string;
  position: string;
  role: 'employee' | 'supervisor' | 'admin';
  supervisorId: string;
  hireDate: string;
  password: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const INITIAL_FORM: CreateEmployeeForm = {
  employeeId: '',
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
  department: '',
  position: '',
  role: 'employee',
  supervisorId: '',
  hireDate: new Date().toISOString().split('T')[0],
  password: '',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const RoleBadge: React.FC<{ role: string }> = ({ role }) => {
  const colors: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-800',
    supervisor: 'bg-blue-100 text-blue-800',
    employee: 'bg-gray-100 text-gray-700',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[role] || colors.employee}`}>
      {role}
    </span>
  );
};

const StatusDot: React.FC<{ active: boolean }> = ({ active }) => (
  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${active ? 'bg-green-500' : 'bg-gray-400'}`} />
);

// ─── System Settings Tab Sub-component ───────────────────────────────────────────

const SystemSettingsTab: React.FC = () => {
  const { showSuccess, showError } = useNotification();
  const [activeConfigTab, setActiveConfigTab] = useState<'general' | 'reset'>('general');

  // General Config Form States
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminAddress, setAdminAddress] = useState('');
  const [adminDesignation, setAdminDesignation] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [adminEmployeeId, setAdminEmployeeId] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Reset Wizard States
  const [resetStep, setResetStep] = useState<1 | 2 | 3>(1);
  const [currentPassword, setCurrentPassword] = useState('');
  const [verifyFrames, setVerifyFrames] = useState<string[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState('');

  // Step 2 OTP States
  const [otpCode, setOtpCode] = useState('');
  const [isOtpVerifying, setIsOtpVerifying] = useState(false);

  // Step 3 Replacement States
  const [newName, setNewName] = useState('');
  const [newEmpId, setNewEmpId] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newDesignation, setNewDesignation] = useState('');
  const [newRecoveryEmail, setNewRecoveryEmail] = useState('');
  const [newRecoveryPhone, setNewRecoveryPhone] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [newFaceFrames, setNewFaceFrames] = useState<string[]>([]);
  const [isReplacing, setIsReplacing] = useState(false);

  // Fetch current config on load
  const loadConfig = async () => {
    setIsFetching(true);
    try {
      const res = await adminApi.getConfiguration();
      if (res.data.success && res.data.data) {
        const config = res.data.data;
        setAdminName(config.adminName || '');
        setAdminEmail(config.adminEmail || '');
        setAdminPhone(config.adminPhone || '');
        setAdminAddress(config.adminAddress || '');
        setAdminDesignation(config.adminDesignation || '');
        setRecoveryEmail(config.recoveryEmail || '');
        setRecoveryPhone(config.recoveryPhone || '');
        setAdminEmployeeId(config.adminEmployeeId || '');
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to load system configuration.');
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await adminApi.updateConfiguration({
        adminName,
        adminEmail,
        adminPhone,
        adminAddress,
        adminDesignation,
        recoveryEmail,
        recoveryPhone
      });
      if (res.data.success) {
        showSuccess(res.data.message || 'Configuration updated successfully.');
        loadConfig();
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to save configuration.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCaptureVerifyFrame = (frame: string) => {
    const base64Data = frame.replace('data:image/jpeg;base64,', '');
    setVerifyFrames(prev => [...prev.slice(-19), base64Data]);
  };

  const handleCaptureNewFaceFrame = (frame: string) => {
    const base64Data = frame.replace('data:image/jpeg;base64,', '');
    setNewFaceFrames(prev => [...prev.slice(-19), base64Data]);
  };

  // Step 1: Password & Face verification
  const handleInitiateReset = async () => {
    if (!currentPassword) {
      showError('Please enter your current password.');
      return;
    }
    if (verifyFrames.length < 5) {
      showError('Please look at the camera to capture face frames.');
      return;
    }

    setIsVerifying(true);
    try {
      const res = await adminApi.initiateAdminReset({
        password: currentPassword,
        frames: verifyFrames
      });
      if (res.data.success) {
        setMaskedEmail(res.data.recoveryEmailMasked || 'configured recovery email');
        showSuccess('Verification successful. OTP has been sent.');
        setResetStep(2);
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Verification failed. Check password and face.');
    } finally {
      setIsVerifying(false);
    }
  };

  // Step 2: OTP verification
  const handleVerifyOtp = async () => {
    if (!otpCode || otpCode.length < 6) {
      showError('Please enter a valid 6-digit OTP code.');
      return;
    }

    setIsOtpVerifying(true);
    try {
      const res = await adminApi.verifyAdminResetOtp({ otp: otpCode });
      if (res.data.success) {
        showSuccess('OTP verified successfully. You may now update credentials.');
        setResetStep(3);
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Invalid or expired OTP.');
    } finally {
      setIsOtpVerifying(false);
    }
  };

  // Step 3: Replace Admin Details
  const handleReplaceAdmin = async () => {
    if (!newName || !newEmpId || !newEmail || !newPassword) {
      showError('Name, Employee ID, Email, and Password are required.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      showError('Passwords do not match.');
      return;
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      showError('Password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, and one number.');
      return;
    }
    if (newFaceFrames.length < 10) {
      showError('Please capture at least 10 face frames of the new administrator.');
      return;
    }

    setIsReplacing(true);
    try {
      const res = await adminApi.replaceAdmin({
        adminName: newName,
        adminEmployeeId: newEmpId,
        adminEmail: newEmail,
        adminPhone: newPhone,
        adminAddress: newAddress,
        adminDesignation: newDesignation,
        recoveryEmail: newRecoveryEmail,
        recoveryPhone: newRecoveryPhone,
        password: newPassword,
        frames: newFaceFrames
      });
      if (res.data.success) {
        showSuccess('Administrator replaced successfully. Logging out...');
        setTimeout(() => {
          window.location.href = '/login';
        }, 3000);
      }
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to replace administrator.');
    } finally {
      setIsReplacing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => setActiveConfigTab('general')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeConfigTab === 'general' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          General Settings
        </button>
        <button
          onClick={() => setActiveConfigTab('reset')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeConfigTab === 'reset' ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Admin Reset Wizard
        </button>
      </div>

      {isFetching ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin mx-auto" />
        </div>
      ) : activeConfigTab === 'general' ? (
        <form onSubmit={handleSaveConfig} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Administrator Profile Settings</h3>
            <p className="text-sm text-gray-500">Configure global administrator contact details and recovery paths.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Admin Employee ID (Read-only)</label>
              <input
                type="text"
                value={adminEmployeeId}
                disabled
                className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Full Name</label>
              <input
                type="text"
                value={adminName}
                onChange={e => setAdminName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g. John Doe"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Primary Email</label>
              <input
                type="email"
                value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="admin@company.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Phone Number</label>
              <input
                type="tel"
                value={adminPhone}
                onChange={e => setAdminPhone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="+1 (555) 0100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Designation</label>
              <input
                type="text"
                value={adminDesignation}
                onChange={e => setAdminDesignation(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="System Administrator"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Office Address</label>
              <input
                type="text"
                value={adminAddress}
                onChange={e => setAdminAddress(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Office HQ"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Recovery Email</label>
              <input
                type="email"
                value={recoveryEmail}
                onChange={e => setRecoveryEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="recovery@company.com"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Recovery Phone</label>
              <input
                type="tel"
                value={recoveryPhone}
                onChange={e => setRecoveryPhone(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="+1 (555) 0199"
              />
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-gray-100">
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm disabled:opacity-50 flex items-center gap-2 shadow-sm"
            >
              {isSaving ? (
                <>
                  <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Settings'
              )}
            </button>
          </div>
        </form>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h3 className="text-lg font-bold text-red-600 flex items-center gap-2">
              <FaShieldAlt className="text-red-500" />
              Administrator Reset & Identity Replacement Wizard
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Follow this secure multi-step verification to fully replace the administrator credentials, identity, password, and registered face.
            </p>
          </div>

          {/* Steps Indicator */}
          <div className="flex items-center justify-between max-w-lg mx-auto mb-8">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                resetStep >= 1 ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-400'
              }`}>1</div>
              <span className="text-xs mt-1 text-gray-600 font-medium">Verify Identity</span>
            </div>
            <div className={`flex-1 h-0.5 mx-2 ${resetStep >= 2 ? 'bg-red-600' : 'bg-gray-200'}`} />
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                resetStep >= 2 ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-400'
              }`}>2</div>
              <span className="text-xs mt-1 text-gray-600 font-medium">Recovery OTP</span>
            </div>
            <div className={`flex-1 h-0.5 mx-2 ${resetStep >= 3 ? 'bg-red-600' : 'bg-gray-200'}`} />
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                resetStep >= 3 ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-400'
              }`}>3</div>
              <span className="text-xs mt-1 text-gray-600 font-medium">Replace Admin</span>
            </div>
          </div>

          <div className="max-w-xl mx-auto">
            {resetStep === 1 && (
              <div className="space-y-6">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3 text-amber-800 text-sm">
                  <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="font-semibold">Security Warning:</span> Starting the reset wizard requires verifying your current administrator password and biometrics. An OTP will then be dispatched to your recovery email.
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">Current Admin Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter current password"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">Liveness Face Capture</label>
                    <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative max-h-56 mx-auto">
                      <FaceCamera
                        onCapture={handleCaptureVerifyFrame}
                        className="w-full h-full"
                        autoCapture={true}
                        captureInterval={200}
                        showControls={false}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-2">
                      <span>Verification frames buffer:</span>
                      <span className="font-semibold text-blue-600">{verifyFrames.length}/20</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    onClick={handleInitiateReset}
                    disabled={isVerifying || !currentPassword || verifyFrames.length < 5}
                    className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-lg shadow-sm disabled:opacity-50 flex items-center gap-2"
                  >
                    {isVerifying ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      'Verify & Send OTP'
                    )}
                  </button>
                </div>
              </div>
            )}

            {resetStep === 2 && (
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3 text-blue-800 text-sm">
                  <FaCheckCircle className="mt-0.5 flex-shrink-0" />
                  <div>
                    An OTP was sent to your recovery email: <span className="font-bold">{maskedEmail}</span>. The code will expire in 5 minutes.
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-1">One-Time Password (OTP)</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest text-center text-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="123456"
                  />
                </div>

                <div className="flex justify-between pt-4">
                  <button
                    onClick={() => setResetStep(1)}
                    className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleVerifyOtp}
                    disabled={isOtpVerifying || otpCode.length < 6}
                    className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-lg disabled:opacity-50 flex items-center gap-2"
                  >
                    {isOtpVerifying ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Verifying OTP...
                      </>
                    ) : (
                      'Verify OTP'
                    )}
                  </button>
                </div>
              </div>
            )}

            {resetStep === 3 && (
              <div className="space-y-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-sm">
                  <span className="font-semibold">Final Step:</span> Input the credentials and details for the new Master System Administrator and register their face.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">New Admin Full Name *</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="e.g. John Smith"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">New Admin Employee ID *</label>
                    <input
                      type="text"
                      value={newEmpId}
                      onChange={e => setNewEmpId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="e.g. admin"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">New Admin Email *</label>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={e => setNewEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="admin@company.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">New Admin Phone</label>
                    <input
                      type="tel"
                      value={newPhone}
                      onChange={e => setNewPhone(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="+1 555 0100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">New Recovery Email</label>
                    <input
                      type="email"
                      value={newRecoveryEmail}
                      onChange={e => setNewRecoveryEmail(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="recovery@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">New Recovery Phone</label>
                    <input
                      type="tel"
                      value={newRecoveryPhone}
                      onChange={e => setNewRecoveryPhone(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="+1 555 0199"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">New Designation</label>
                    <input
                      type="text"
                      value={newDesignation}
                      onChange={e => setNewDesignation(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="System Administrator"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Office Address</label>
                    <input
                      type="text"
                      value={newAddress}
                      onChange={e => setNewAddress(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="Office HQ"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">New Admin Password *</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="At least 8 chars, 1 uppercase, 1 lowercase, 1 number"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Confirm New Password *</label>
                    <input
                      type="password"
                      value={newPasswordConfirm}
                      onChange={e => setNewPasswordConfirm(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-gray-600 mb-2">New Admin Face Registration *</label>
                  <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden relative max-h-56 mx-auto">
                    <FaceCamera
                      onCapture={handleCaptureNewFaceFrame}
                      className="w-full h-full"
                      autoCapture={true}
                      captureInterval={150}
                      showControls={false}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500 mt-2">
                    <span>Captured frames (minimum 10):</span>
                    <span className="font-semibold text-blue-600">{newFaceFrames.length}/20</span>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={handleReplaceAdmin}
                    disabled={isReplacing || newFaceFrames.length < 10 || !newPassword || newPassword !== newPasswordConfirm}
                    className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-lg shadow-md disabled:opacity-50 flex items-center gap-2"
                  >
                    {isReplacing ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Replacing Administrator...
                      </>
                    ) : (
                      'Confirm Replacement'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const AdminPage: React.FC = () => {
  const { user } = useAuth();
  const { showSuccess, showError } = useNotification();

  // Data state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [unassignedEmployees, setUnassignedEmployees] = useState<Employee[]>([]);
  const [workTimings, setWorkTimings] = useState<WorkTiming[]>([]);
  const [loading, setLoading] = useState(true);

  // Direct Face Management State
  const [selectedEmpForFace, setSelectedEmpForFace] = useState<Employee | null>(null);
  const [isDirectFaceModalOpen, setIsDirectFaceModalOpen] = useState(false);
  const [directFaceFrames, setDirectFaceFrames] = useState<{ data: string; timestamp: number }[]>([]);
  const [isDirectFaceSubmitting, setIsDirectFaceSubmitting] = useState(false);

  // Approvals queue states
  const [pendingRequests, setPendingRequests] = useState<FaceChangeRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<FaceAuditLog[]>([]);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [actionNotes, setActionNotes] = useState<string>('');

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>('hierarchy');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [expandedSupervisors, setExpandedSupervisors] = useState<Set<number>>(new Set());

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateEmployeeForm>(INITIAL_FORM);
  const [formLoading, setFormLoading] = useState(false);

  // Assignment modal
  const [_assignTarget, setAssignTarget] = useState<{ supervisorId: number; supervisorName: string } | null>(null);

  // Fetch all data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [empResult, hierarchyResult, timingsResult, pendingResult, logsResult] = await Promise.allSettled([
        adminApi.getEmployees({ limit: 200 }),
        adminApi.getHierarchy(),
        adminApi.getWorkTimings(),
        faceManagementApi.getPendingRequests(),
        faceManagementApi.getHistory(),
      ]);

      if (empResult.status === 'fulfilled') {
        setEmployees(empResult.value.data.data || []);
      }

      if (hierarchyResult.status === 'fulfilled') {
        const data = hierarchyResult.value.data.data;
        setSupervisors(data.supervisors || []);
        setUnassignedEmployees(data.unassignedEmployees || []);
      }

      if (timingsResult.status === 'fulfilled') {
        setWorkTimings(timingsResult.value.data.data || []);
      }

      if (pendingResult.status === 'fulfilled' && pendingResult.value.data.success) {
        setPendingRequests(pendingResult.value.data.data);
      }

      if (logsResult.status === 'fulfilled' && logsResult.value.data.success) {
        setAuditLogs(logsResult.value.data.data);
      }
    } catch (err) {
      console.error('Admin data fetch error:', err);
      showError('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const handleDirectFaceFrameCapture = (frame: string) => {
    const base64Data = frame.replace('data:image/jpeg;base64,', '');
    setDirectFaceFrames((prev) => [
      ...prev.slice(-19),
      {
        data: base64Data,
        timestamp: Date.now(),
      },
    ]);
  };

  const handleSubmitDirectFace = async () => {
    if (!selectedEmpForFace) return;
    if (directFaceFrames.length < 10) {
      showError('Please capture at least 10 frames before submitting.');
      return;
    }

    try {
      setIsDirectFaceSubmitting(true);
      const response = await faceManagementApi.adminRegister(
        selectedEmpForFace.employee_id,
        directFaceFrames.map(f => f.data)
      );

      if (response.data.success) {
        showSuccess(`Face profile registered successfully for ${selectedEmpForFace.first_name}`);
        setIsDirectFaceModalOpen(false);
        setSelectedEmpForFace(null);
        setDirectFaceFrames([]);
        fetchData();
      } else {
        showError(response.data.message || 'Failed to register face.');
      }
    } catch (err: any) {
      showError(err.response?.data?.message || 'Error occurred during registration.');
    } finally {
      setIsDirectFaceSubmitting(false);
    }
  };

  const handleDirectFaceDelete = async (emp: Employee) => {
    if (!window.confirm(`Are you sure you want to delete the face profile for ${emp.first_name} ${emp.last_name}?`)) return;
    try {
      const response = await faceManagementApi.adminDelete(emp.employee_id);
      if (response.data.success) {
        showSuccess(`Face profile deleted for ${emp.first_name} ${emp.last_name}`);
        fetchData();
      } else {
        showError(response.data.message || 'Failed to delete face.');
      }
    } catch (err: any) {
      showError(err.response?.data?.message || 'Error occurred during deletion.');
    }
  };

  const handleApprove = async (id: number) => {
    try {
      setApprovingId(id);
      const response = await faceManagementApi.approveRequest(id, actionNotes);
      if (response.data.success) {
        showSuccess('Face change request approved and applied successfully!');
        setActionNotes('');
        setApprovingId(null);
        fetchData();
      }
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to approve request');
      setApprovingId(null);
    }
  };

  const handleReject = async (id: number) => {
    try {
      setRejectingId(id);
      const response = await faceManagementApi.rejectRequest(id, actionNotes);
      if (response.data.success) {
        showSuccess('Face change request rejected successfully!');
        setActionNotes('');
        setRejectingId(null);
        fetchData();
      }
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to reject request');
      setRejectingId(null);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filter employees
  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = !searchQuery
      || `${emp.first_name} ${emp.last_name} ${emp.employee_id} ${emp.email}`.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDept = !filterDept || emp.department === filterDept;
    const matchesRole = !filterRole || emp.role === filterRole;
    return matchesSearch && matchesDept && matchesRole;
  });

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();

  // Toggle supervisor expansion in hierarchy
  const toggleSupervisor = (id: number) => {
    setExpandedSupervisors(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Create employee handler
  const handleCreateEmployee = async () => {
    if (!createForm.employeeId || !createForm.firstName || !createForm.lastName || !createForm.email) {
      showError('Employee ID, name, and email are required');
      return;
    }

    setFormLoading(true);
    try {
      await adminApi.createEmployee({
        employeeId: createForm.employeeId,
        firstName: createForm.firstName,
        lastName: createForm.lastName,
        email: createForm.email,
        phoneNumber: createForm.phoneNumber || undefined,
        department: createForm.department,
        position: createForm.position,
        role: createForm.role,
        supervisorId: createForm.supervisorId ? parseInt(createForm.supervisorId) : undefined,
        hireDate: createForm.hireDate,
        password: createForm.password || undefined,
      });
      showSuccess(`Employee ${createForm.firstName} ${createForm.lastName} created successfully`);
      setShowCreateModal(false);
      setCreateForm(INITIAL_FORM);
      fetchData();
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to create employee');
    } finally {
      setFormLoading(false);
    }
  };

  // Deactivate employee
  const handleDeactivate = async (emp: Employee) => {
    if (!window.confirm(`Deactivate ${emp.first_name} ${emp.last_name}? They will no longer be able to log in.`)) return;
    try {
      await adminApi.deactivateEmployee(emp.employee_id);
      showSuccess(`${emp.first_name} ${emp.last_name} has been deactivated`);
      fetchData();
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to deactivate employee');
    }
  };

  // Tabs configuration
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'hierarchy', label: 'Org Hierarchy', icon: <FaBuilding /> },
    { id: 'employees', label: 'All Employees', icon: <FaUsers /> },
    { id: 'supervisors', label: 'Supervisors', icon: <FaShieldAlt /> },
    { id: 'timings', label: 'Work Timings', icon: <FaClock /> },
    { id: 'mfa', label: 'MFA Status', icon: <FaLock /> },
    { id: 'approvals', label: 'Face Approvals', icon: <FaCheck /> },
    { id: 'system', label: 'System Settings', icon: <FaSync /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FaShieldAlt className="text-blue-600" />
              Admin Management Portal
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Logged in as <span className="font-medium text-gray-700">{user?.firstName} {user?.lastName}</span>
            </p>
          </div>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 font-medium text-sm"
            id="create-employee-btn"
          >
            <FaUserPlus />
            Add Employee
          </motion.button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-1 py-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                id={`admin-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="text-center">
              <div className="h-12 w-12 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin mx-auto" />
              <p className="mt-4 text-gray-500 text-sm">Loading admin data...</p>
            </div>
          </div>
        ) : (
          <>
            {/* ── ORG HIERARCHY TAB ── */}
            {activeTab === 'hierarchy' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-gray-900">Organizational Hierarchy</h2>
                  <div className="text-sm text-gray-500">
                    {supervisors.length} supervisors · {unassignedEmployees.length} unassigned employees
                  </div>
                </div>

                {/* Supervisors with their teams */}
                {supervisors.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <FaUsers className="mx-auto text-4xl text-gray-300 mb-3" />
                    <p className="text-gray-500">No supervisors found. Add a supervisor to build the hierarchy.</p>
                  </div>
                ) : (
                  supervisors.map(sup => (
                    <div key={sup.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                      <div
                        className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors"
                        onClick={() => toggleSupervisor(sup.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-semibold text-sm">
                            {sup.first_name[0]}{sup.last_name[0]}
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{sup.first_name} {sup.last_name}</p>
                            <p className="text-sm text-gray-500">{sup.department} · {sup.employee_id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-600 bg-blue-50 px-3 py-1 rounded-full">
                            {(sup.assigned_employees || []).length} team member{(sup.assigned_employees || []).length !== 1 ? 's' : ''}
                          </span>
                          <RoleBadge role={sup.role} />
                          {expandedSupervisors.has(sup.id) ? (
                            <FaChevronDown className="text-gray-400" />
                          ) : (
                            <FaChevronRight className="text-gray-400" />
                          )}
                        </div>
                      </div>

                      <AnimatePresence>
                        {expandedSupervisors.has(sup.id) && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-gray-100">
                              {(sup.assigned_employees || []).length === 0 ? (
                                <div className="px-6 py-4 text-sm text-gray-500 italic">
                                  No employees assigned to this supervisor
                                </div>
                              ) : (
                                <div className="divide-y divide-gray-100">
                                  {(sup.assigned_employees || []).map(emp => (
                                    <div
                                      key={emp.id}
                                      className="px-6 py-3 flex items-center justify-between hover:bg-gray-50 pl-14"
                                    >
                                      <div className="flex items-center gap-2">
                                        <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-xs font-medium">
                                          {emp.first_name[0]}{emp.last_name[0]}
                                        </div>
                                        <div>
                                          <p className="text-sm font-medium text-gray-900">{emp.first_name} {emp.last_name}</p>
                                          <p className="text-xs text-gray-500">{emp.employee_id} · {emp.position}</p>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <StatusDot active={emp.is_active} />
                                        <span className="text-xs text-gray-500">{emp.is_active ? 'Active' : 'Inactive'}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))
                )}

                {/* Unassigned employees */}
                {unassignedEmployees.length > 0 && (
                  <div className="bg-white rounded-xl border border-amber-200 shadow-sm">
                    <div className="px-6 py-4 border-b border-amber-100 flex items-center gap-2">
                      <FaUnlink className="text-amber-500" />
                      <h3 className="font-semibold text-gray-900">Unassigned Employees</h3>
                      <span className="ml-auto text-sm text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                        {unassignedEmployees.length} employee{unassignedEmployees.length !== 1 ? 's' : ''} need assignment
                      </span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {unassignedEmployees.map(emp => (
                        <div key={emp.id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50">
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-700 text-xs font-medium">
                              {emp.first_name[0]}{emp.last_name[0]}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">{emp.first_name} {emp.last_name}</p>
                              <p className="text-xs text-gray-500">{emp.employee_id} · {emp.department} · {emp.position}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setAssignTarget({ supervisorId: 0, supervisorName: '' })}
                            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                          >
                            <FaLink className="text-xs" />
                            Assign
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── EMPLOYEES TAB ── */}
            {activeTab === 'employees' && (
              <div className="space-y-5">
                {/* Search & Filters */}
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="flex-1 min-w-64 relative">
                    <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                    <input
                      id="employee-search"
                      type="text"
                      placeholder="Search by name, ID, or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <select
                    id="filter-department"
                    value={filterDept}
                    onChange={(e) => setFilterDept(e.target.value)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Departments</option>
                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select
                    id="filter-role"
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Roles</option>
                    <option value="employee">Employee</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <span className="text-sm text-gray-500 ml-auto">
                    {filteredEmployees.length} of {employees.length} employees
                  </span>
                </div>

                {/* Employee Table */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Face Auth</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredEmployees.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center text-gray-500 text-sm">
                              No employees found matching your filters
                            </td>
                          </tr>
                        ) : (
                          filteredEmployees.map((emp) => (
                            <motion.tr
                              key={emp.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="hover:bg-gray-50"
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-semibold">
                                    {emp.first_name[0]}{emp.last_name[0]}
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">{emp.first_name} {emp.last_name}</p>
                                    <p className="text-xs text-gray-500">{emp.employee_id} · {emp.email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">{emp.department}</td>
                              <td className="px-4 py-3"><RoleBadge role={emp.role} /></td>
                              <td className="px-4 py-3">
                                {emp.face_enrolled ? (
                                  <span className="flex items-center gap-1 text-green-600 text-xs">
                                    <FaCheck /> Enrolled
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">Not enrolled</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`flex items-center gap-1 text-xs font-medium ${emp.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                                  <StatusDot active={emp.is_active} />
                                  {emp.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  {emp.is_active && (
                                    <>
                                      <button
                                        onClick={() => {
                                          setSelectedEmpForFace(emp);
                                          setDirectFaceFrames([]);
                                          setIsDirectFaceModalOpen(true);
                                        }}
                                        className="p-1.5 text-blue-500 hover:bg-blue-50 rounded transition-colors"
                                        title={emp.face_enrolled ? "Replace face profile" : "Enroll face profile"}
                                      >
                                        <FaCamera className="text-sm" />
                                      </button>
                                      {emp.face_enrolled && (
                                        <button
                                          onClick={() => handleDirectFaceDelete(emp)}
                                          className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                                          title="Delete face profile"
                                        >
                                          <FaTrash className="text-sm" />
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {emp.is_active && emp.employee_id !== 'admin' && (
                                    <button
                                      onClick={() => handleDeactivate(emp)}
                                      className="p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                                      title="Deactivate employee"
                                    >
                                      <FaUserSlash className="text-sm" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </motion.tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── SUPERVISORS TAB ── */}
            {activeTab === 'supervisors' && (
              <div className="space-y-5">
                <h2 className="text-lg font-semibold text-gray-900">Supervisor Management</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {supervisors.length === 0 ? (
                    <div className="col-span-3 bg-white rounded-xl border border-gray-200 p-12 text-center">
                      <FaUsers className="mx-auto text-4xl text-gray-300 mb-3" />
                      <p className="text-gray-500">No supervisors configured yet.</p>
                      <button
                        onClick={() => { setCreateForm({ ...INITIAL_FORM, role: 'supervisor' }); setShowCreateModal(true); }}
                        className="mt-3 text-sm text-blue-600 hover:underline font-medium"
                      >
                        Create first supervisor →
                      </button>
                    </div>
                  ) : (
                    supervisors.map(sup => (
                      <div key={sup.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                              {sup.first_name[0]}{sup.last_name[0]}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900">{sup.first_name} {sup.last_name}</p>
                              <p className="text-xs text-gray-500">{sup.employee_id}</p>
                            </div>
                          </div>
                          <RoleBadge role={sup.role} />
                        </div>
                        <div className="space-y-1 text-sm">
                          <p className="text-gray-600"><span className="font-medium">Dept:</span> {sup.department}</p>
                          <p className="text-gray-600"><span className="font-medium">Position:</span> {sup.position}</p>
                          <p className="text-gray-600"><span className="font-medium">Email:</span> {sup.email}</p>
                          <p className="text-gray-600">
                            <span className="font-medium">Team:</span> {(sup.assigned_employees || []).length} employees
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ── WORK TIMINGS TAB ── */}
            {activeTab === 'timings' && (
              <div className="space-y-5">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-gray-900">Work Timings Configuration</h2>
                </div>

                {workTimings.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <FaClock className="mx-auto text-4xl text-gray-300 mb-3" />
                    <p className="text-gray-500">No work timings configured.</p>
                    <p className="text-sm text-gray-400 mt-1">The system will use default 9:00 AM - 6:00 PM schedule.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Scope</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work Start</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work End</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lunch Break</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {workTimings.map(timing => (
                          <tr key={timing.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {timing.employee_id ? `Employee #${timing.employee_id}` : timing.department || 'Default (All)'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-700 font-mono">{timing.work_start_time}</td>
                            <td className="px-4 py-3 text-sm text-gray-700 font-mono">{timing.work_end_time}</td>
                            <td className="px-4 py-3 text-sm text-gray-700">
                              {timing.lunch_start_time && timing.lunch_end_time
                                ? `${timing.lunch_start_time} – ${timing.lunch_end_time}`
                                : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${timing.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                                {timing.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── MFA STATUS TAB ── */}
            {activeTab === 'mfa' && (
              <div className="space-y-5">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-semibold text-gray-900">MFA Status</h2>
                  <div className="text-sm text-gray-500">
                    Manage Multi-Factor Authentication status for all employees
                  </div>
                </div>

                {/* Search & Filters */}
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="flex-1 min-w-64 relative">
                    <FaSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                    <input
                      id="mfa-employee-search"
                      type="text"
                      placeholder="Search by name, ID, or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <select
                    id="mfa-filter-department"
                    value={filterDept}
                    onChange={(e) => setFilterDept(e.target.value)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Departments</option>
                    {departments.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select
                    id="mfa-filter-role"
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                    className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Roles</option>
                    <option value="employee">Employee</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <span className="text-sm text-gray-500 ml-auto">
                    {filteredEmployees.length} of {employees.length} employees
                  </span>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Department</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">MFA Enabled</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredEmployees.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-12 text-center text-gray-500 text-sm">
                              No employees found matching your filters
                            </td>
                          </tr>
                        ) : (
                          filteredEmployees.map((emp) => (
                            <motion.tr
                              key={emp.id}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="hover:bg-gray-50"
                            >
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 text-xs font-semibold">
                                    {emp.first_name[0]}{emp.last_name[0]}
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">{emp.first_name} {emp.last_name}</p>
                                    <p className="text-xs text-gray-500">{emp.employee_id} · {emp.email}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">{emp.department}</td>
                              <td className="px-4 py-3"><RoleBadge role={emp.role} /></td>
                              <td className="px-4 py-3">
                                {emp.mfa_enabled ? (
                                  <span className="flex items-center gap-1 text-green-600 text-xs font-semibold">
                                    <FaCheck /> Enabled
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">Disabled</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {emp.mfa_enabled ? (
                                  <button
                                    onClick={async () => {
                                      if (!window.confirm(`Reset/Disable MFA for ${emp.first_name} ${emp.last_name}?`)) return;
                                      try {
                                        await adminApi.resetEmployeeMfa(emp.employee_id);
                                        showSuccess(`MFA reset successfully for ${emp.first_name} ${emp.last_name}`);
                                        fetchData();
                                      } catch (err: any) {
                                        showError(err.response?.data?.message || 'Failed to reset MFA');
                                      }
                                    }}
                                    className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded text-xs font-medium transition-colors"
                                  >
                                    Reset MFA
                                  </button>
                                ) : (
                                  <span className="text-xs text-gray-400 italic">No action needed</span>
                                )}
                              </td>
                            </motion.tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ── FACE APPROVALS TAB ── */}
            {activeTab === 'approvals' && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Pending Face Change Requests</h2>
                      <p className="text-gray-500 text-sm mt-0.5">Review and approve biometric face registration requests from supervisors and employees.</p>
                    </div>
                    <button
                      onClick={fetchData}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors"
                    >
                      <FaSync className="text-xs animate-spin-hover" /> Refresh
                    </button>
                  </div>

                  {pendingRequests.length === 0 ? (
                    <div className="py-12 text-center text-gray-500">
                      <FaCheck className="mx-auto text-4xl text-green-300 mb-3" />
                      <p>No pending face change requests.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {pendingRequests.map((request) => (
                        <div key={request.id} className="p-6 flex flex-col md:flex-row md:items-center md:justify-between hover:bg-gray-50 transition-colors">
                          <div className="mb-4 md:mb-0">
                            <div className="flex items-center space-x-3">
                              <span className="font-semibold text-gray-900">{request.first_name} {request.last_name}</span>
                              <span className="text-xs text-gray-500">({request.employee_id})</span>
                              <span className={`px-2 py-0.5 text-xs rounded-full font-bold ${
                                request.request_type === 'ADD' 
                                  ? 'bg-green-100 text-green-800' 
                                  : request.request_type === 'DELETE' 
                                    ? 'bg-red-100 text-red-800' 
                                    : 'bg-blue-100 text-blue-800'
                              }`}>
                                {request.request_type} FACE
                              </span>
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              Department: {request.department} &bull; Requested on {new Date(request.created_at).toLocaleDateString()}
                            </div>
                            {request.requester_employee_id && request.requester_employee_id !== request.employee_id && (
                              <div className="text-xs text-indigo-600 mt-1">
                                Requested by: {request.requester_first_name} {request.requester_last_name} ({request.requester_employee_id})
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
                            {approvingId === request.id || rejectingId === request.id ? (
                              <div className="flex flex-col space-y-2 w-full sm:w-64">
                                <input
                                  type="text"
                                  placeholder="Add notes/reason (optional)..."
                                  value={actionNotes}
                                  onChange={(e) => setActionNotes(e.target.value)}
                                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-full focus:ring-1 focus:ring-blue-500"
                                />
                                <div className="flex justify-end space-x-2">
                                  <button
                                    onClick={() => {
                                      setApprovingId(null);
                                      setRejectingId(null);
                                      setActionNotes('');
                                    }}
                                    className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-lg font-medium"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => approvingId === request.id ? handleApprove(request.id) : handleReject(request.id)}
                                    className={`px-3 py-1 text-white text-xs rounded-lg font-medium ${
                                      approvingId === request.id ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                                    }`}
                                  >
                                    Confirm
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setApprovingId(request.id);
                                    setRejectingId(null);
                                  }}
                                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectingId(request.id);
                                    setApprovingId(null);
                                  }}
                                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Audit log trail */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-xl font-bold text-gray-900">Face Change Audit Logs</h2>
                    <p className="text-gray-500 text-sm mt-0.5">Historical records of all biometric profile alterations.</p>
                  </div>

                  {auditLogs.length === 0 ? (
                    <div className="py-12 text-center text-gray-500">
                      No face audit logs found.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target Employee</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Performed By</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Device & IP</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {auditLogs.map((log) => (
                            <tr key={log.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm text-gray-900">
                                <div>
                                  <p className="font-medium">{log.first_name} {log.last_name}</p>
                                  <p className="text-xs text-gray-500">{log.employee_id}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                  log.action === 'ADD' 
                                    ? 'bg-green-100 text-green-800' 
                                    : log.action === 'DELETE' 
                                      ? 'bg-red-100 text-red-800' 
                                      : 'bg-blue-100 text-blue-800'
                                }`}>
                                  {log.action}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">
                                {log.perf_employee_id ? (
                                  <div>
                                    <p className="font-medium">{log.perf_first_name} {log.perf_last_name}</p>
                                    <p className="text-xs text-gray-500">{log.perf_employee_id}</p>
                                  </div>
                                ) : (
                                  'System'
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">
                                {new Date(log.timestamp).toLocaleString()}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-500">
                                <div>
                                  <p className="font-mono text-xs">{log.ip_address}</p>
                                  <p className="text-xs max-w-xs truncate" title={log.device_info}>{log.device_info}</p>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── SYSTEM SETTINGS TAB ── */}
            {activeTab === 'system' && (
              <SystemSettingsTab />
            )}
          </>
        )}
      </main>

      {/* ── CREATE EMPLOYEE MODAL ── */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <FaUserPlus className="text-blue-600" />
                  Create New Employee
                </h3>
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Employee ID *</label>
                    <input
                      id="new-employee-id"
                      type="text"
                      placeholder="e.g. EMP001"
                      value={createForm.employeeId}
                      onChange={(e) => setCreateForm(f => ({ ...f, employeeId: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Role *</label>
                    <select
                      id="new-employee-role"
                      value={createForm.role}
                      onChange={(e) => setCreateForm(f => ({ ...f, role: e.target.value as any }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="employee">Employee</option>
                      <option value="supervisor">Supervisor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">First Name *</label>
                    <input
                      id="new-first-name"
                      type="text"
                      value={createForm.firstName}
                      onChange={(e) => setCreateForm(f => ({ ...f, firstName: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Last Name *</label>
                    <input
                      id="new-last-name"
                      type="text"
                      value={createForm.lastName}
                      onChange={(e) => setCreateForm(f => ({ ...f, lastName: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
                    <input
                      id="new-email"
                      type="email"
                      value={createForm.email}
                      onChange={(e) => setCreateForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
                    <input
                      id="new-department"
                      type="text"
                      list="dept-list"
                      value={createForm.department}
                      onChange={(e) => setCreateForm(f => ({ ...f, department: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                    <datalist id="dept-list">
                      {departments.map(d => <option key={d} value={d} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Position</label>
                    <input
                      id="new-position"
                      type="text"
                      value={createForm.position}
                      onChange={(e) => setCreateForm(f => ({ ...f, position: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {createForm.role === 'employee' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Assign Supervisor</label>
                      <select
                        id="new-supervisor"
                        value={createForm.supervisorId}
                        onChange={(e) => setCreateForm(f => ({ ...f, supervisorId: e.target.value }))}
                        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">None (unassigned)</option>
                        {supervisors.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.first_name} {s.last_name} ({s.department})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Hire Date</label>
                    <input
                      id="new-hire-date"
                      type="date"
                      value={createForm.hireDate}
                      onChange={(e) => setCreateForm(f => ({ ...f, hireDate: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Phone Number</label>
                    <input
                      id="new-phone"
                      type="tel"
                      value={createForm.phoneNumber}
                      onChange={(e) => setCreateForm(f => ({ ...f, phoneNumber: e.target.value }))}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Initial Password <span className="text-gray-400">(leave blank to auto-generate)</span>
                    </label>
                    <input
                      id="new-password"
                      type="password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Leave blank to auto-generate"
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  id="submit-create-employee"
                  onClick={handleCreateEmployee}
                  disabled={formLoading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {formLoading ? (
                    <>
                      <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <FaUserPlus />
                      Create Employee
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── DIRECT FACE REGISTRATION MODAL (ADMIN BYPASS) ── */}
      <AnimatePresence>
        {isDirectFaceModalOpen && selectedEmpForFace && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <FaCamera className="text-blue-600" />
                  Direct Face Registration: {selectedEmpForFace.first_name} {selectedEmpForFace.last_name}
                </h3>
                <button
                  onClick={() => {
                    setIsDirectFaceModalOpen(false);
                    setSelectedEmpForFace(null);
                    setDirectFaceFrames([]);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="p-6">
                <p className="text-sm text-gray-600 mb-4">
                  Enroll face directly. Biometric updates will be applied instantly, skipping the approval workflow.
                </p>

                <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden mb-4 relative max-h-64">
                  <FaceCamera
                    onCapture={handleDirectFaceFrameCapture}
                    className="w-full h-full"
                    autoCapture={true}
                    captureInterval={150}
                    showControls={false}
                  />
                </div>

                {/* Progress Bar */}
                <div className="mb-6">
                  <div className="flex justify-between text-sm mb-1 text-gray-700">
                    <span>Captured Frames</span>
                    <span className="font-semibold">{directFaceFrames.length}/20</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min((directFaceFrames.length / 20) * 100, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => {
                      setIsDirectFaceModalOpen(false);
                      setSelectedEmpForFace(null);
                      setDirectFaceFrames([]);
                    }}
                    className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitDirectFace}
                    disabled={isDirectFaceSubmitting || directFaceFrames.length < 10}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isDirectFaceSubmitting ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminPage;
