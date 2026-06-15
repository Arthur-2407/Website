import React, { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FaUser, FaInfoCircle, FaShieldAlt, FaArrowLeft, FaCheckCircle, FaExclamationTriangle, FaSpinner } from 'react-icons/fa';
import api from '@services/api';

const RecoveryRequestPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Try to pre-fill the employeeId from location state
  const stateEmployeeId = location.state?.employeeId || '';

  const [employeeId, setEmployeeId] = useState(stateEmployeeId);
  const [requestType, setRequestType] = useState('password_reset');
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!employeeId.trim()) {
      setErrorMessage('Please enter your Employee ID.');
      return;
    }

    if (!reason.trim()) {
      setErrorMessage('Please provide a reason or details for your recovery request.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await api.post<{
        success: boolean;
        message: string;
        recoveryId: number;
        expiresAt: string;
      }>('/auth/recovery/request', {
        employeeId: employeeId.trim(),
        requestType,
        reason: reason.trim(),
      });

      if (response.data.success) {
        setSuccessMessage(response.data.message || 'Recovery request submitted successfully.');
      } else {
        setErrorMessage(response.data.message || 'Failed to submit recovery request.');
      }
    } catch (error: any) {
      setErrorMessage(
        error.response?.data?.message || error.message || 'An error occurred while submitting your request.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-600/80 to-amber-700/80 p-6 text-center">
          <FaShieldAlt className="mx-auto text-4xl text-white drop-shadow-lg" />
          <h1 className="text-xl font-bold text-white mt-3 tracking-tight">Account Recovery</h1>
          <p className="text-amber-100 mt-1 text-xs">Request credential reset from system administrators</p>
        </div>

        <div className="p-6 bg-white">
          {successMessage ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-6"
            >
              <FaCheckCircle className="mx-auto text-5xl text-green-500 mb-4" />
              <h3 className="text-lg font-bold text-gray-800 mb-2">Request Submitted</h3>
              <p className="text-gray-600 text-sm mb-6 px-4">
                {successMessage}
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-semibold text-sm transition-colors"
              >
                <FaArrowLeft /> Back to Login
              </Link>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {errorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2.5 text-xs text-red-600">
                  <FaExclamationTriangle className="mt-0.5 flex-shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <div>
                <label htmlFor="employeeId" className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  Employee ID
                </label>
                <div className="relative">
                  <FaUser className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm" />
                  <input
                    id="employeeId"
                    type="text"
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                    placeholder="Enter your Employee ID"
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="requestType" className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  Type of Reset Needed
                </label>
                <select
                  id="requestType"
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors bg-white"
                >
                  <option value="password_reset">Reset Password Credential</option>
                  <option value="face_reset">Reset Face Embedding Credential</option>
                  <option value="full_credential_reset">Reset Both Password & Face Credentials</option>
                </select>
              </div>

              <div>
                <label htmlFor="reason" className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">
                  Reason / Description
                </label>
                <textarea
                  id="reason"
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                  placeholder="Explain why you need this reset (e.g. forgot password, face scan fails repeatedly, device change, etc.)"
                  required
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2 text-xs text-amber-800">
                <FaInfoCircle className="mt-0.5 flex-shrink-0" />
                <span>
                  Admin approval is required to restore access. Please verify your identity with your supervisor after submitting.
                </span>
              </div>

              <div className="pt-2 flex flex-col gap-3">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded-lg transition-all disabled:opacity-60 text-sm shadow-md"
                >
                  {isLoading ? (
                    <>
                      <FaSpinner className="animate-spin" /> Submitting Request...
                    </>
                  ) : (
                    'Submit Recovery Request'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="w-full text-center text-xs text-gray-500 hover:text-gray-700 py-1 transition-colors"
                >
                  Cancel and Return to Login
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default RecoveryRequestPage;
