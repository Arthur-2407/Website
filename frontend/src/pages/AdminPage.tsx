import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FaUsers,
  FaUserPlus,
  FaUserSlash,
  FaUserCheck,
  FaUserMinus,
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
  FaKey,
  FaMapMarkerAlt,
} from 'react-icons/fa';
import { adminApi, Employee, Supervisor, WorkTiming, EmployeeLocation, EmployeeLocationRow } from '@api/adminApi';
import { faceManagementApi, FaceChangeRequest, FaceAuditLog } from '@api/faceManagementApi';
import { leaveApi, LeaveRequest } from '@api/leaveApi';
import FaceCamera from '@components/camera/FaceCamera';
import { useNotification } from '@contexts/NotificationContext';
import { useAuth } from '@contexts/AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tab = 'hierarchy' | 'employees' | 'supervisors' | 'timings' | 'mfa' | 'approvals' | 'leaves' | 'system';

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

  useEffect(() => {
    const handleMapMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'MAP_LOCATION_SELECTED') {
        const { name, latitude, longitude } = event.data;
        if (name) setLocationName(name);
        if (latitude) setLocationLat(String(latitude));
        if (longitude) setLocationLng(String(longitude));
      }
    };
    window.addEventListener('message', handleMapMessage);
    return () => {
      window.removeEventListener('message', handleMapMessage);
    };
  }, []);

  // Data state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [supervisors, setSupervisors] = useState<Supervisor[]>([]);
  const [unassignedEmployees, setUnassignedEmployees] = useState<Employee[]>([]);
  const [workTimings, setWorkTimings] = useState<WorkTiming[]>([]);
  const [loading, setLoading] = useState(true);

  // Timing configuration modal states
  const [isAssignTimingModalOpen, setIsAssignTimingModalOpen] = useState(false);
  const [timingModalType, setTimingModalType] = useState<'permanent' | 'temporary'>('permanent');
  const [selectedEmployeeIdForTiming, setSelectedEmployeeIdForTiming] = useState<string>('');
  const [timingWorkStart, setTimingWorkStart] = useState('09:00');
  const [timingWorkEnd, setTimingWorkEnd] = useState('18:00');
  const [timingLunchStart, setTimingLunchStart] = useState('12:00');
  const [timingLunchEnd, setTimingLunchEnd] = useState('13:00');
  const [timingStartDate, setTimingStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [timingEndDate, setTimingEndDate] = useState(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  const [timingSubmitting, setTimingSubmitting] = useState(false);

  const handleAssignWorkTiming = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmployeeIdForTiming) {
      showError('Please select an employee');
      return;
    }
    if (!timingWorkStart || !timingWorkEnd) {
      showError('Work start and end times are required');
      return;
    }
    if (timingModalType === 'temporary' && (!timingStartDate || !timingEndDate)) {
      showError('Start and end dates are required for temporary work timings');
      return;
    }

    setTimingSubmitting(true);
    try {
      const payload = {
        employeeId: parseInt(selectedEmployeeIdForTiming, 10),
        workStartTime: timingWorkStart.includes(':') && timingWorkStart.split(':').length === 2 ? `${timingWorkStart}:00` : timingWorkStart,
        workEndTime: timingWorkEnd.includes(':') && timingWorkEnd.split(':').length === 2 ? `${timingWorkEnd}:00` : timingWorkEnd,
        lunchStartTime: timingLunchStart ? (timingLunchStart.includes(':') && timingLunchStart.split(':').length === 2 ? `${timingLunchStart}:00` : timingLunchStart) : undefined,
        lunchEndTime: timingLunchEnd ? (timingLunchEnd.includes(':') && timingLunchEnd.split(':').length === 2 ? `${timingLunchEnd}:00` : timingLunchEnd) : undefined,
        isTemporary: timingModalType === 'temporary',
        startDate: timingModalType === 'temporary' ? timingStartDate : null,
        endDate: timingModalType === 'temporary' ? timingEndDate : null
      };

      const response = await adminApi.createWorkTiming(payload);
      if (response.status === 201 || response.data.success) {
        showSuccess(`Successfully assigned ${timingModalType} work timing`);
        setIsAssignTimingModalOpen(false);
        // Refresh work timings
        const updatedTimings = await adminApi.getWorkTimings();
        setWorkTimings(updatedTimings.data.data || []);
      }
    } catch (err: any) {
      console.error(err);
      showError(err.response?.data?.error || 'Failed to assign work timing');
    } finally {
      setTimingSubmitting(false);
    }
  };

  const handleDeleteWorkTiming = async (id: number) => {
    if (!window.confirm('Are you sure you want to remove this work timing configuration?')) return;
    try {
      const response = await adminApi.deleteWorkTiming(id);
      if (response.status === 200 || response.data.success) {
        showSuccess('Successfully deleted work timing configuration');
        // Refresh work timings
        const updatedTimings = await adminApi.getWorkTimings();
        setWorkTimings(updatedTimings.data.data || []);
      }
    } catch (err: any) {
      console.error(err);
      showError(err.response?.data?.error || 'Failed to delete work timing configuration');
    }
  };

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
  const [pendingLeaveRequests, setPendingLeaveRequests] = useState<LeaveRequest[]>([]);
  const [approvingLeaveId, setApprovingLeaveId] = useState<number | null>(null);
  const [rejectingLeaveId, setRejectingLeaveId] = useState<number | null>(null);
  const [leaveActionReason, setLeaveActionReason] = useState<string>('');

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
  const [assignTargetEmployee, setAssignTargetEmployee] = useState<Employee | null>(null);
  const [selectedSupervisorId, setSelectedSupervisorId] = useState<string>('');
  const [assignLoading, setAssignLoading] = useState(false);

  const handleAssignSupervisor = async () => {
    if (!assignTargetEmployee) return;
    if (!selectedSupervisorId) {
      showError('Please select a supervisor');
      return;
    }

    setAssignLoading(true);
    try {
      const response = await adminApi.updateEmployee(assignTargetEmployee.id, {
        supervisorId: parseInt(selectedSupervisorId, 10)
      });

      if (response.data.success || response.status === 200) {
        showSuccess(`Successfully assigned ${assignTargetEmployee.first_name} ${assignTargetEmployee.last_name} to supervisor`);
        setAssignTargetEmployee(null);
        setSelectedSupervisorId('');
        fetchData();
      }
    } catch (err: any) {
      console.error(err);
      showError(err.response?.data?.error || 'Failed to assign supervisor');
    } finally {
      setAssignLoading(false);
    }
  };

  // Change Password Modal States
  const [selectedEmpForPassword, setSelectedEmpForPassword] = useState<Employee | null>(null);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Location Assignment Modal States
  const [selectedEmpForLocation, setSelectedEmpForLocation] = useState<Employee | null>(null);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<EmployeeLocation | null>(null);
  const [locationName, setLocationName] = useState('');
  const [locationLat, setLocationLat] = useState('');
  const [locationLng, setLocationLng] = useState('');
  const [locationRadius, setLocationRadius] = useState('500');
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationFetching, setLocationFetching] = useState(false);

  // Bulk location rows: keyed by employee numeric id for O(1) lookup in table
  const [employeeLocationRows, setEmployeeLocationRows] = useState<Record<number, EmployeeLocationRow>>({}); 
  const [locationRowsLoading, setLocationRowsLoading] = useState(false);

  // Fetch ALL employee locations from bulk endpoint — call after tab switch & after mutations
  const fetchAllLocations = async () => {
    setLocationRowsLoading(true);
    try {
      const res = await adminApi.getAllEmployeeLocations();
      const rows = res.data.data || [];
      const map: Record<number, EmployeeLocationRow> = {};
      rows.forEach((row) => { map[row.id] = row; });
      setEmployeeLocationRows(map);
    } catch (err) {
      console.error('Failed to load employee locations:', err);
    } finally {
      setLocationRowsLoading(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!selectedEmpForPassword) return;
    if (!newPassword || newPassword.trim() === '') {
      showError('Password cannot be empty');
      return;
    }

    setPasswordLoading(true);
    try {
      const response = await adminApi.updateEmployee(selectedEmpForPassword.id, {
        password: newPassword
      });

      if (response.data.success || response.status === 200) {
        showSuccess(`Successfully updated password for ${selectedEmpForPassword.first_name} ${selectedEmpForPassword.last_name}`);
        setIsPasswordModalOpen(false);
        setSelectedEmpForPassword(null);
        setNewPassword('');
        fetchData();
      }
    } catch (err: any) {
      console.error(err);
      showError(err.response?.data?.error || 'Failed to update password');
    } finally {
      setPasswordLoading(false);
    }
  };

  const openLocationModal = async (emp: Employee) => {
    setSelectedEmpForLocation(emp);
    setLocationName('');
    setLocationLat('');
    setLocationLng('');
    setLocationRadius('500');
    setCurrentLocation(null);
    setIsLocationModalOpen(true);
    setLocationFetching(true);
    try {
      const res = await adminApi.getEmployeeLocation(emp.id);
      if (res.data.data) {
        const loc = res.data.data;
        setCurrentLocation(loc);
        setLocationName(loc.name);
        setLocationLat(String(loc.latitude));
        setLocationLng(String(loc.longitude));
        setLocationRadius(String(loc.radius_meters));
      }
    } catch (err) {
      console.error('Failed to fetch employee location:', err);
    } finally {
      setLocationFetching(false);
    }
  };

  const handleAssignLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEmpForLocation) return;
    const lat = parseFloat(locationLat);
    const lng = parseFloat(locationLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showError('Please enter valid latitude (-90 to 90) and longitude (-180 to 180) values');
      return;
    }
    if (!locationName.trim()) {
      showError('Location name is required');
      return;
    }
    setLocationLoading(true);
    try {
      await adminApi.assignEmployeeLocation(selectedEmpForLocation.id, {
        name: locationName.trim(),
        latitude: lat,
        longitude: lng,
        radiusMeters: parseInt(locationRadius, 10) || 500,
      });
      showSuccess(`Work location assigned to ${selectedEmpForLocation.first_name} ${selectedEmpForLocation.last_name}`);
      setIsLocationModalOpen(false);
      setSelectedEmpForLocation(null);
      fetchData();
      fetchAllLocations(); // refresh real-time location table
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to assign location');
    } finally {
      setLocationLoading(false);
    }
  };

  const handleRemoveLocation = async () => {
    if (!selectedEmpForLocation) return;
    if (!window.confirm(`Remove work location for ${selectedEmpForLocation.first_name} ${selectedEmpForLocation.last_name}? They will fall back to the global office location.`)) return;
    setLocationLoading(true);
    try {
      await adminApi.removeEmployeeLocation(selectedEmpForLocation.id);
      showSuccess('Work location removed successfully');
      setIsLocationModalOpen(false);
      setSelectedEmpForLocation(null);
      fetchData();
      fetchAllLocations(); // refresh real-time location table
    } catch (err: any) {
      showError(err.response?.data?.error || 'Failed to remove location');
    } finally {
      setLocationLoading(false);
    }
  };

  // Fetch all data
  const fetchData = async () => {
    setLoading(true);
    try {
      const [empResult, hierarchyResult, timingsResult, pendingResult, logsResult, leaveResult] = await Promise.allSettled([
        adminApi.getEmployees({ limit: 200 }),
        adminApi.getHierarchy(),
        adminApi.getWorkTimings(),
        faceManagementApi.getPendingRequests(),
        faceManagementApi.getHistory(),
        leaveApi.getTeamRequests(200),
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

      if (leaveResult.status === 'fulfilled') {
        setPendingLeaveRequests((leaveResult.value.data || []).filter((r: LeaveRequest) => r.status === 'pending'));
      }
    } catch (err) {
      console.error('Admin data fetch error:', err);
      showError('Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const fetchLeaveRequests = async () => {
    try {
      const response = await leaveApi.getTeamRequests(200);
      setPendingLeaveRequests((response.data || []).filter((r: LeaveRequest) => r.status === 'pending'));
    } catch (err) {
      console.error('Failed to fetch pending leave requests:', err);
    }
  };

  const handleApproveLeave = async (id: number) => {
    try {
      setApprovingLeaveId(id);
      const response = await leaveApi.approveRequest(id);
      if (response.status === 200 || response.data) {
        showSuccess('Leave request approved successfully!');
        setApprovingLeaveId(null);
        fetchLeaveRequests();
      }
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to approve leave request');
      setApprovingLeaveId(null);
    }
  };

  const handleRejectLeave = async (id: number) => {
    if (!leaveActionReason.trim()) {
      showError('Please provide a rejection reason');
      return;
    }
    try {
      setRejectingLeaveId(id);
      const response = await leaveApi.rejectRequest(id, leaveActionReason);
      if (response.status === 200 || response.data) {
        showSuccess('Leave request rejected successfully!');
        setLeaveActionReason('');
        setRejectingLeaveId(null);
        fetchLeaveRequests();
      }
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to reject leave request');
      setRejectingLeaveId(null);
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
    fetchAllLocations();
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
      await adminApi.updateEmployee(emp.id, { isActive: false });
      showSuccess(`${emp.first_name} ${emp.last_name} has been deactivated`);
      fetchData();
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to deactivate employee');
    }
  };

  // Activate employee
  const handleActivate = async (emp: Employee) => {
    try {
      await adminApi.updateEmployee(emp.id, { isActive: true });
      showSuccess(`${emp.first_name} ${emp.last_name} has been activated successfully`);
      fetchData();
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to activate employee');
    }
  };

  // Remove employee (hard delete)
  const handleRemoveEmployee = async (emp: Employee) => {
    if (!window.confirm(`Are you sure you want to PERMANENTLY remove employee ${emp.first_name} ${emp.last_name} and all their records from the database? This action cannot be undone.`)) return;
    try {
      await adminApi.deactivateEmployee(emp.id);
      showSuccess(`Employee ${emp.first_name} ${emp.last_name} removed successfully`);
      fetchData();
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to remove employee');
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
    { id: 'leaves', label: 'Leave Approvals', icon: <FaClock /> },
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
                            onClick={() => {
                              setAssignTargetEmployee(emp);
                              setSelectedSupervisorId('');
                            }}
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
                                  {emp.employee_id !== 'admin' && (
                                    <>
                                      <button
                                        onClick={() => openLocationModal(emp)}
                                        className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                                        title="Assign work location"
                                      >
                                        <FaMapMarkerAlt className="text-sm" />
                                      </button>
                                      <button
                                        onClick={() => {
                                          setSelectedEmpForPassword(emp);
                                          setNewPassword('');
                                          setIsPasswordModalOpen(true);
                                        }}
                                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                        title="Change password"
                                      >
                                        <FaKey className="text-sm" />
                                      </button>
                                      {emp.is_active ? (
                                        <button
                                          onClick={() => handleDeactivate(emp)}
                                          className="p-1.5 text-orange-500 hover:bg-orange-50 rounded transition-colors"
                                          title="Deactivate employee"
                                        >
                                          <FaUserSlash className="text-sm" />
                                        </button>
                                      ) : (
                                        <button
                                          onClick={() => handleActivate(emp)}
                                          className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                                          title="Activate employee"
                                        >
                                          <FaUserCheck className="text-sm" />
                                        </button>
                                      )}
                                      <button
                                        onClick={() => handleRemoveEmployee(emp)}
                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                                        title="Remove employee"
                                      >
                                        <FaUserMinus className="text-sm" />
                                      </button>
                                    </>
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
              <div className="space-y-8">
                {/* Permanent Timings Section */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">Work Timings Configuration</h2>
                      <p className="text-sm text-gray-500">Configure permanent working hours for employees and supervisors.</p>
                    </div>
                    <button
                      onClick={() => {
                        setTimingModalType('permanent');
                        setSelectedEmployeeIdForTiming('');
                        setTimingWorkStart('09:00');
                        setTimingWorkEnd('18:00');
                        setTimingLunchStart('12:00');
                        setTimingLunchEnd('13:00');
                        setIsAssignTimingModalOpen(true);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 shadow"
                    >
                      <FaClock />
                      Assign Permanent Shift
                    </button>
                  </div>

                  {workTimings.filter(t => !t.is_temporary).length === 0 ? (
                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
                      <FaClock className="mx-auto text-4xl text-gray-300 mb-3" />
                      <p className="text-gray-900 font-semibold text-base">No work timings configured.</p>
                      <p className="text-sm text-gray-500 mt-1">The system will use default 9:00 AM - 6:00 PM schedule.</p>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work Hours</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lunch Break</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {workTimings.filter(t => !t.is_temporary).map(timing => (
                            <tr key={timing.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                {timing.first_name ? (
                                  <div>
                                    <p className="font-semibold">{timing.first_name} {timing.last_name}</p>
                                    <p className="text-xs text-gray-500 font-mono">{timing.employee_code}</p>
                                  </div>
                                ) : (
                                  timing.employee_id ? `Employee #${timing.employee_id}` : timing.department || 'Default (All)'
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                                {timing.work_start_time} – {timing.work_end_time}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                                {timing.lunch_start_time && timing.lunch_end_time
                                  ? `${timing.lunch_start_time} – ${timing.lunch_end_time}`
                                  : '—'}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <button
                                  onClick={() => handleDeleteWorkTiming(timing.id)}
                                  className="text-red-600 hover:text-red-800 font-medium flex items-center gap-1"
                                >
                                  <FaTrash /> Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Temporary Timings Section */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">Temporary Work Timings</h2>
                      <p className="text-sm text-gray-500">Configure temporary work timings with active date ranges.</p>
                    </div>
                    <button
                      onClick={() => {
                        setTimingModalType('temporary');
                        setSelectedEmployeeIdForTiming('');
                        setTimingWorkStart('09:00');
                        setTimingWorkEnd('18:00');
                        setTimingLunchStart('12:00');
                        setTimingLunchEnd('13:00');
                        setTimingStartDate(new Date().toISOString().split('T')[0]);
                        setTimingEndDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
                        setIsAssignTimingModalOpen(true);
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 shadow"
                    >
                      <FaClock />
                      Assign Temporary Shift
                    </button>
                  </div>

                  {workTimings.filter(t => t.is_temporary).length === 0 ? (
                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
                      <FaClock className="mx-auto text-4xl text-gray-300 mb-3" />
                      <p className="text-gray-900 font-semibold text-base">No temporary work timings configured.</p>
                      <p className="text-sm text-gray-500 mt-1">Standard permanent shifts or default schedule will be used.</p>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Range</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work Hours</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lunch Break</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {workTimings.filter(t => t.is_temporary).map(timing => (
                            <tr key={timing.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                {timing.first_name ? (
                                  <div>
                                    <p className="font-semibold">{timing.first_name} {timing.last_name}</p>
                                    <p className="text-xs text-gray-500 font-mono">{timing.employee_code}</p>
                                  </div>
                                ) : (
                                  timing.employee_id ? `Employee #${timing.employee_id}` : timing.department || 'Default (All)'
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">
                                <span className="px-2.5 py-1 text-xs font-medium bg-purple-50 text-purple-700 rounded-full border border-purple-100">
                                  {timing.start_date ? new Date(timing.start_date).toLocaleDateString() : ''} – {timing.end_date ? new Date(timing.end_date).toLocaleDateString() : ''}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                                {timing.work_start_time} – {timing.work_end_time}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                                {timing.lunch_start_time && timing.lunch_end_time
                                  ? `${timing.lunch_start_time} – ${timing.lunch_end_time}`
                                  : '—'}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <button
                                  onClick={() => handleDeleteWorkTiming(timing.id)}
                                  className="text-red-600 hover:text-red-800 font-medium flex items-center gap-1"
                                >
                                  <FaTrash /> Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Location Assignment Overview Section */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">Employee Work Location Assignment</h2>
                      <p className="text-sm text-gray-500">Assign individual GPS work locations to employees and supervisors. These locations override the global office geo-fence during attendance check-in/check-out.</p>
                    </div>
                    {locationRowsLoading && (
                      <div className="text-xs text-blue-500 flex items-center gap-1">
                        <div className="h-3 w-3 rounded-full border border-blue-300 border-t-blue-500 animate-spin" />
                        <span>Updating...</span>
                      </div>
                    )}
                  </div>

                  {employees.filter(e => e.employee_id !== 'admin').length === 0 ? (
                    <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
                      <FaMapMarkerAlt className="mx-auto text-4xl text-gray-300 mb-3" />
                      <p className="text-gray-900 font-semibold text-base">No employees found.</p>
                      <p className="text-sm text-gray-500 mt-1">Add employees first to assign work locations.</p>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-xl overflow-hidden">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Employee</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assigned Location</th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {employees.filter(e => e.employee_id !== 'admin').map(emp => (
                            <tr key={emp.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                <div>
                                  <p className="font-semibold">{emp.first_name} {emp.last_name}</p>
                                  <p className="text-xs text-gray-500 font-mono">{emp.employee_id}</p>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">
                                <RoleBadge role={emp.role} />
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-700">
                                {employeeLocationRows[emp.id] ? (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                                    <FaMapMarkerAlt className="text-green-500" />
                                    {employeeLocationRows[emp.id].location_name}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                                    <FaMapMarkerAlt className="text-gray-400" />
                                    Global Office (Default)
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <button
                                  onClick={() => openLocationModal(emp)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
                                >
                                  <FaMapMarkerAlt />
                                  Assign Location
                                </button>
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

            {/* ── LEAVE APPROVALS TAB ── */}
            {activeTab === 'leaves' && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Pending Leave Approvals</h2>
                      <p className="text-gray-500 text-sm mt-0.5">Review and approve or reject leave requests submitted by employees.</p>
                    </div>
                    <button
                      onClick={fetchLeaveRequests}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition-colors"
                    >
                      <FaSync className="text-xs" /> Refresh
                    </button>
                  </div>

                  {pendingLeaveRequests.length === 0 ? (
                    <div className="py-12 text-center text-gray-500">
                      <FaCheckCircle className="mx-auto text-4xl text-green-300 mb-3" />
                      <p>No pending leave requests.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {pendingLeaveRequests.map((request) => (
                        <div key={request.id} className="p-6 flex flex-col md:flex-row md:items-center md:justify-between hover:bg-gray-50 transition-colors">
                          <div className="mb-4 md:mb-0">
                            <div className="flex items-center space-x-3">
                              <span className="font-semibold text-gray-900">
                                {request.employee?.first_name} {request.employee?.last_name}
                              </span>
                              <span className="text-xs text-gray-500 font-normal">({request.employee?.employee_id})</span>
                              <span className="px-2 py-0.5 text-xs rounded-full font-bold bg-yellow-100 text-yellow-800 uppercase">
                                {request.leave_type}
                              </span>
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              <strong>Period:</strong> {new Date(request.start_date).toLocaleDateString()} to {new Date(request.end_date).toLocaleDateString()} ({request.total_days} {request.total_days === 1 ? 'day' : 'days'})
                            </div>
                            <div className="text-sm text-gray-700 mt-2 italic bg-gray-50 p-2 rounded border border-gray-100">
                              "{request.reason}"
                            </div>
                            <div className="text-xs text-gray-400 mt-2">
                              Submitted on {new Date(request.created_at).toLocaleDateString()}
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
                            {rejectingLeaveId === request.id ? (
                              <div className="flex flex-col space-y-2 w-full sm:w-64">
                                <input
                                  type="text"
                                  placeholder="Rejection reason (required)..."
                                  value={leaveActionReason}
                                  onChange={(e) => setLeaveActionReason(e.target.value)}
                                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-full focus:ring-1 focus:ring-blue-500"
                                />
                                <div className="flex justify-end space-x-2">
                                  <button
                                    onClick={() => {
                                      setRejectingLeaveId(null);
                                      setLeaveActionReason('');
                                    }}
                                    className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs rounded-lg font-medium"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleRejectLeave(request.id)}
                                    className="px-3 py-1 text-white text-xs rounded-lg font-medium bg-red-600 hover:bg-red-700"
                                  >
                                    Confirm Reject
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <button
                                  disabled={approvingLeaveId === request.id}
                                  onClick={() => handleApproveLeave(request.id)}
                                  className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
                                >
                                  {approvingLeaveId === request.id ? 'Approving...' : 'Approve'}
                                </button>
                                <button
                                  onClick={() => {
                                    setRejectingLeaveId(request.id);
                                    setLeaveActionReason('');
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
              </div>
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

      {/* ── ASSIGN SUPERVISOR MODAL ── */}
      <AnimatePresence>
        {assignTargetEmployee && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setAssignTargetEmployee(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <FaLink className="text-blue-600" />
                  Assign Supervisor
                </h3>
                <button
                  onClick={() => setAssignTargetEmployee(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                    Employee
                  </label>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="font-semibold text-gray-900">
                      {assignTargetEmployee.first_name} {assignTargetEmployee.last_name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      ID: {assignTargetEmployee.employee_id} · Dept: {assignTargetEmployee.department} · Role: {assignTargetEmployee.position}
                    </p>
                  </div>
                </div>

                <div>
                  <label htmlFor="assign-supervisor-select" className="block text-xs font-medium text-gray-700 mb-1">
                    Select Supervisor *
                  </label>
                  <select
                    id="assign-supervisor-select"
                    value={selectedSupervisorId}
                    onChange={(e) => setSelectedSupervisorId(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  >
                    <option value="">-- Choose a Supervisor --</option>
                    {supervisors.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.first_name} {s.last_name} ({s.department})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => setAssignTargetEmployee(null)}
                    className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAssignSupervisor}
                    disabled={assignLoading || !selectedSupervisorId}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {assignLoading ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Assigning...
                      </>
                    ) : (
                      'Confirm Assignment'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── CHANGE PASSWORD MODAL ── */}
      <AnimatePresence>
        {isPasswordModalOpen && selectedEmpForPassword && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) { setIsPasswordModalOpen(false); setSelectedEmpForPassword(null); setNewPassword(''); } }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <FaKey className="text-blue-600" />
                  Change Password
                </h3>
                <button
                  onClick={() => {
                    setIsPasswordModalOpen(false);
                    setSelectedEmpForPassword(null);
                    setNewPassword('');
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                    Employee
                  </label>
                  <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="font-semibold text-gray-900">
                      {selectedEmpForPassword.first_name} {selectedEmpForPassword.last_name}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      ID: {selectedEmpForPassword.employee_id} · Dept: {selectedEmpForPassword.department}
                    </p>
                  </div>
                </div>

                <div>
                  <label htmlFor="new-password-input" className="block text-xs font-medium text-gray-700 mb-1">
                    New Password *
                  </label>
                  <input
                    id="new-password-input"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    onClick={() => {
                      setIsPasswordModalOpen(false);
                      setSelectedEmpForPassword(null);
                      setNewPassword('');
                    }}
                    className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdatePassword}
                    disabled={passwordLoading || !newPassword}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {passwordLoading ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Updating...
                      </>
                    ) : (
                      'Update Password'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ASSIGN WORK TIMING MODAL ── */}
      <AnimatePresence>
        {isAssignTimingModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setIsAssignTimingModalOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <FaClock className="text-blue-600" />
                  Assign {timingModalType === 'permanent' ? 'Permanent' : 'Temporary'} Work Timing
                </h3>
                <button
                  onClick={() => setIsAssignTimingModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  <FaTimes />
                </button>
              </div>

              <form onSubmit={handleAssignWorkTiming} className="p-6 space-y-4">
                <div>
                  <label htmlFor="timing-employee-select" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    Select Employee/Supervisor *
                  </label>
                  <select
                    id="timing-employee-select"
                    value={selectedEmployeeIdForTiming}
                    onChange={(e) => setSelectedEmployeeIdForTiming(e.target.value)}
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    required
                  >
                    <option value="">-- Choose Employee --</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.first_name} {emp.last_name} ({emp.employee_id} - {emp.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="timing-work-start" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                      Work Start *
                    </label>
                    <input
                      id="timing-work-start"
                      type="time"
                      value={timingWorkStart}
                      onChange={(e) => setTimingWorkStart(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="timing-work-end" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                      Work End *
                    </label>
                    <input
                      id="timing-work-end"
                      type="time"
                      value={timingWorkEnd}
                      onChange={(e) => setTimingWorkEnd(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="timing-lunch-start" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                      Lunch Start
                    </label>
                    <input
                      id="timing-lunch-start"
                      type="time"
                      value={timingLunchStart}
                      onChange={(e) => setTimingLunchStart(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="timing-lunch-end" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                      Lunch End
                    </label>
                    <input
                      id="timing-lunch-end"
                      type="time"
                      value={timingLunchEnd}
                      onChange={(e) => setTimingLunchEnd(e.target.value)}
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                    />
                  </div>
                </div>

                {timingModalType === 'temporary' && (
                  <div className="grid grid-cols-2 gap-4 p-3 bg-purple-50/50 rounded-xl border border-purple-100">
                    <div>
                      <label htmlFor="timing-start-date" className="block text-xs font-semibold text-purple-700 uppercase tracking-wider mb-1">
                        Start Date *
                      </label>
                      <input
                        id="timing-start-date"
                        type="date"
                        value={timingStartDate}
                        onChange={(e) => setTimingStartDate(e.target.value)}
                        className="w-full text-sm border border-purple-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="timing-end-date" className="block text-xs font-semibold text-purple-700 uppercase tracking-wider mb-1">
                        End Date *
                      </label>
                      <input
                        id="timing-end-date"
                        type="date"
                        value={timingEndDate}
                        onChange={(e) => setTimingEndDate(e.target.value)}
                        className="w-full text-sm border border-purple-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                        required
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setIsAssignTimingModalOpen(false)}
                    className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={timingSubmitting}
                    className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {timingSubmitting ? (
                      <>
                        <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Assigning...
                      </>
                    ) : (
                      'Confirm Assignment'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── ASSIGN LOCATION MODAL ── */}
      <AnimatePresence>
        {isLocationModalOpen && selectedEmpForLocation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) { setIsLocationModalOpen(false); setSelectedEmpForLocation(null); } }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gradient-to-r from-green-50 to-emerald-50">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <FaMapMarkerAlt className="text-green-600" />
                  Assign Work Location
                </h3>
                <button
                  onClick={() => { setIsLocationModalOpen(false); setSelectedEmpForLocation(null); }}
                  className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-white/60"
                >
                  <FaTimes />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Employee Info */}
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="font-semibold text-gray-900">{selectedEmpForLocation.first_name} {selectedEmpForLocation.last_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">ID: {selectedEmpForLocation.employee_id} · {selectedEmpForLocation.department} · {selectedEmpForLocation.role}</p>
                </div>

                {/* Current location status */}
                {locationFetching ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <div className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin" />
                    Loading current location...
                  </div>
                ) : currentLocation ? (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-1">Currently Assigned Location</p>
                    <p className="text-sm font-medium text-green-900">{currentLocation.name}</p>
                    <p className="text-xs text-green-700 font-mono mt-0.5">
                      {currentLocation.latitude.toFixed(6)}, {currentLocation.longitude.toFixed(6)} · Radius: {currentLocation.radius_meters}m
                    </p>
                    <a
                      href={`https://maps.google.com/maps?q=${currentLocation.latitude},${currentLocation.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"
                    >
                      <FaMapMarkerAlt className="text-xs" /> View on Google Maps
                    </a>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-0.5">No Personal Location Assigned</p>
                    <p className="text-xs text-amber-600">This employee uses the global office geo-fence. Assign a personal location below.</p>
                  </div>
                )}

                {/* Google Maps hint */}
                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg">
                  <p className="text-xs font-semibold text-blue-700 mb-1">📍 How to get coordinates</p>
                  <p className="text-xs text-blue-600">1. Open <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="underline font-medium">Google Maps</a> and navigate to the work location.</p>
                  <p className="text-xs text-blue-600">2. Right-click the exact point → click the coordinates shown.</p>
                  <p className="text-xs text-blue-600">3. Paste the latitude and longitude values in the fields below.</p>
                </div>

                <form onSubmit={handleAssignLocation} className="space-y-4">
                  <div>
                    <label htmlFor="loc-name" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">Location Name *</label>
                    <input
                      id="loc-name"
                      type="text"
                      value={locationName}
                      onChange={(e) => setLocationName(e.target.value)}
                      placeholder="e.g. Head Office, Branch Office, Site A"
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                      required
                    />
                  </div>

                  <div className="flex justify-between items-center mb-1">
                    <span className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">Coordinates</span>
                    <button
                      type="button"
                      onClick={() => {
                        const lat = locationLat || '20.136994';
                        const lng = locationLng || '85.635407';
                        const name = encodeURIComponent(locationName || '');
                        const width = 950;
                        const height = 650;
                        const left = (window.screen.width - width) / 2;
                        const top = (window.screen.height - height) / 2;
                        window.open(
                          `/map-picker.html?lat=${lat}&lng=${lng}&name=${name}`,
                          'MapPicker',
                          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`
                        );
                      }}
                      className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-semibold transition-colors py-1 px-2 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-100"
                    >
                      <FaMapMarkerAlt className="text-xs" />
                      Select on Google Maps
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="loc-lat" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Latitude *</label>
                      <input
                        id="loc-lat"
                        type="number"
                        step="any"
                        value={locationLat}
                        onChange={(e) => setLocationLat(e.target.value)}
                        placeholder="e.g. 20.136994"
                        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white font-mono"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="loc-lng" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">Longitude *</label>
                      <input
                        id="loc-lng"
                        type="number"
                        step="any"
                        value={locationLng}
                        onChange={(e) => setLocationLng(e.target.value)}
                        placeholder="e.g. 85.635407"
                        className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white font-mono"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="loc-radius" className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">Geo-Fence Radius (meters)</label>
                    <input
                      id="loc-radius"
                      type="number"
                      min="10"
                      max="5000"
                      value={locationRadius}
                      onChange={(e) => setLocationRadius(e.target.value)}
                      placeholder="100"
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2.5 focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                    />
                    <p className="text-xs text-gray-400 mt-1">Employees within this radius of the assigned location will be marked as "Within Fence". Default: 100m.</p>
                  </div>

                  {/* Live preview of Google Maps link */}
                  {locationLat && locationLng && !isNaN(parseFloat(locationLat)) && !isNaN(parseFloat(locationLng)) && (
                    <div className="p-2 bg-gray-50 rounded-lg border border-gray-200">
                      <a
                        href={`https://maps.google.com/maps?q=${locationLat},${locationLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-medium"
                      >
                        <FaMapMarkerAlt /> Verify on Google Maps: {parseFloat(locationLat).toFixed(6)}, {parseFloat(locationLng).toFixed(6)}
                      </a>
                    </div>
                  )}

                  <div className="flex justify-between gap-3 pt-4 border-t border-gray-100">
                    <div>
                      {currentLocation && (
                        <button
                          type="button"
                          onClick={handleRemoveLocation}
                          disabled={locationLoading}
                          className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 flex items-center gap-1.5"
                        >
                          <FaTrash className="text-xs" />
                          Remove Location
                        </button>
                      )}
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setIsLocationModalOpen(false); setSelectedEmpForLocation(null); }}
                        className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={locationLoading || locationFetching}
                        className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {locationLoading ? (
                          <>
                            <div className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>{currentLocation ? 'Update Location' : 'Assign Location'}</>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminPage;
