import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  FaCalendarAlt, 
  FaPlaneDeparture, 
  FaNotesMedical, 
  FaUserFriends,
  FaPaperPlane,
  FaHistory,
  FaCheckCircle
} from 'react-icons/fa';
import { leaveApi } from '@api/leaveApi';
import { useNotification } from '@contexts/NotificationContext';

interface LeaveRequest {
  id: number;
  leave_type: 'vacation' | 'sick' | 'personal' | 'maternity' | 'paternity';
  start_date: string;
  end_date: string;
  total_days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  approval_date: string | null;
  rejection_reason: string | null;
  created_at: string;
  employee?: {
    employee_id: string;
    first_name: string;
    last_name: string;
  };
}

interface LeaveStats {
  totalRequests: number;
  approved: number;
  pending: number;
  rejected: number;
  vacationDaysUsed: number;
  sickDaysUsed: number;
}

const LeavePage: React.FC = () => {
  const { showError, showSuccess } = useNotification();
  
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [stats, setStats] = useState<LeaveStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRequestForm, setShowRequestForm] = useState(false);
  
  const [formData, setFormData] = useState({
    leaveType: 'vacation',
    startDate: '',
    endDate: '',
    reason: '',
  });

  // STABILIZATION: Fetch leave data with AbortController and loading timeout
  useEffect(() => {
    const abortController = new AbortController();

    const fetchData = async () => {
      try {
        setLoading(true);

        // STABILIZATION: Parallel fetch with allSettled
        const [requestsResult, statsResult] = await Promise.allSettled([
          leaveApi.getMyRequests(20),
          leaveApi.getStats(),
        ]);

        if (abortController.signal.aborted) return;

        if (requestsResult.status === 'fulfilled') {
          setRequests(requestsResult.value.data);
        } else {
          console.error('Leave requests fetch error:', requestsResult.reason);
        }

        if (statsResult.status === 'fulfilled') {
          setStats(statsResult.value.data);
        } else {
          console.error('Leave stats fetch error:', statsResult.reason);
        }
      } catch (error: any) {
        if (error?.name === 'CanceledError') return;
        console.error('Leave data fetch error:', error);
        showError('Failed to load leave data');
      } finally {
        if (!abortController.signal.aborted) setLoading(false);
      }
    };

    fetchData();

    // STABILIZATION: Loading timeout — auto-resolve after 15s
    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 15_000);

    return () => {
      abortController.abort();
      clearTimeout(loadingTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps — showError is a stable context ref
  }, []);

  // Handle form input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
    });
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (new Date(formData.endDate) < new Date(formData.startDate)) {
      showError('End date cannot be before start date');
      return;
    }
    
    try {
      // Submit leave request
      const response = await leaveApi.submitRequest({
        leaveType: formData.leaveType,
        startDate: formData.startDate,
        endDate: formData.endDate,
        reason: formData.reason,
      });
      
      showSuccess('Leave request submitted successfully!');
      setShowRequestForm(false);
      
      // Auto-refresh stats after submit
      try {
        const statsResponse = await leaveApi.getStats();
        setStats(statsResponse.data);
      } catch (err) {
        console.error('Failed to update stats:', err);
      }
      
      // Reset form
      setFormData({
        leaveType: 'vacation',
        startDate: '',
        endDate: '',
        reason: '',
      });
      
      // Ensure created_at exists (from backend or fallback)
      const newRequest: LeaveRequest = {
        ...(response.data || {}),
        id: response.data?.id || Date.now(),
        leave_type: response.data?.leave_type || formData.leaveType as LeaveRequest['leave_type'],
        start_date: response.data?.start_date || formData.startDate,
        end_date: response.data?.end_date || formData.endDate,
        total_days:
          response.data?.total_days ||
          Math.ceil(
            (new Date(formData.endDate).getTime() -
              new Date(formData.startDate).getTime()) /
              (1000 * 3600 * 24)
          ) + 1,
        reason: response.data?.reason || formData.reason,
        status: response.data?.status || 'pending',
        approval_date: response.data?.approval_date || null,
        rejection_reason: response.data?.rejection_reason || null,

        // ✅ IMPORTANT: submission date & time
        created_at: response.data?.created_at || new Date().toISOString(),
      };
      
      setRequests(prev => [newRequest, ...prev].sort((a,b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ));
    } catch (error: any) {
      console.error('Leave request submission error:', error);
      showError('Failed to submit leave request');
    }
  };

  // Handle cancel request
  const handleCancelRequest = async (id: number) => {
    try {
      await leaveApi.cancelRequest(id);
      showSuccess('Leave request cancelled successfully!');
      
      // Update request status in the list
      setRequests(prev => 
        prev.map(req => 
          req.id === id ? { ...req, status: 'cancelled' } : req
        )
      );
    } catch (error: any) {
      console.error('Cancel request error:', error);
      showError('Failed to cancel leave request');
    }
  };

  // Get leave type icon
  const getLeaveTypeIcon = (type: string) => {
    switch (type) {
      case 'vacation':
        return <FaPlaneDeparture className="text-blue-500" />;
      case 'sick':
        return <FaNotesMedical className="text-red-500" />;
      case 'personal':
        return <FaUserFriends className="text-green-500" />;
      default:
        return <FaCalendarAlt className="text-gray-500" />;
    }
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
      case 'approved':
        return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Approved</span>;
      case 'rejected':
        return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Rejected</span>;
      case 'cancelled':
        return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">Cancelled</span>;
      default:
        return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Leave Management</h1>
            <p className="text-gray-600 mt-1">Request and manage your leave</p>
          </div>
          <button
            onClick={() => setShowRequestForm(!showRequestForm)}
            className="flex items-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            <FaPaperPlane className="mr-2" />
            Request Leave
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
            <motion.div
              whileHover={{ y: -5 }}
              className="bg-white rounded-xl shadow p-6"
            >
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                  <FaCalendarAlt className="text-xl" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Total Requests</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.totalRequests}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -5 }}
              className="bg-white rounded-xl shadow p-6"
            >
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-green-100 text-green-600">
                  <FaCheckCircle className="text-xl" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Approved</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.approved}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -5 }}
              className="bg-white rounded-xl shadow p-6"
            >
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-yellow-100 text-yellow-600">
                  <FaHistory className="text-xl" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Pending</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.pending}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -5 }}
              className="bg-white rounded-xl shadow p-6"
            >
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-teal-100 text-teal-600">
                  <FaPlaneDeparture className="text-xl" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Vacation Days</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.vacationDaysUsed}</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              whileHover={{ y: -5 }}
              className="bg-white rounded-xl shadow p-6"
            >
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-red-100 text-red-600">
                  <FaNotesMedical className="text-xl" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Sick Days</p>
                  <p className="text-2xl font-bold text-gray-900">{stats.sickDaysUsed}</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Request Form */}
        {showRequestForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="bg-white rounded-xl shadow p-6 mb-8"
          >
            <h2 className="text-xl font-bold text-gray-900 mb-4">Request New Leave</h2>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label htmlFor="leaveType" className="block text-sm font-medium text-gray-700 mb-1">
                    Leave Type
                  </label>
                  <select
                    id="leaveType"
                    name="leaveType"
                    value={formData.leaveType}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  >
                    <option value="vacation">Vacation</option>
                    <option value="sick">Sick Leave</option>
                    <option value="personal">Personal Leave</option>
                    <option value="maternity">Maternity Leave</option>
                    <option value="paternity">Paternity Leave</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    id="startDate"
                    name="startDate"
                    value={formData.startDate}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    id="endDate"
                    name="endDate"
                    value={formData.endDate}
                    onChange={handleInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
                    Reason
                  </label>
                  <textarea
                    id="reason"
                    name="reason"
                    value={formData.reason}
                    onChange={handleInputChange}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Please provide a brief reason for your leave request..."
                    required
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowRequestForm(false)}
                  className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </motion.div>
        )}

        {/* Leave Requests Table */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Leave Requests</h2>
          </div>
          
          {loading ? (
            <div className="py-12 text-center">
              <svg className="animate-spin h-12 w-12 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="mt-4 text-gray-600">Loading leave requests...</p>
            </div>
          ) : requests.length === 0 ? (
            <div className="py-12 text-center">
              <FaCalendarAlt className="mx-auto text-4xl text-gray-300" />
              <p className="mt-4 text-gray-600">No leave requests found.</p>
              <button
                onClick={() => setShowRequestForm(true)}
                className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
              >
                Request Your First Leave
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Dates
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Days
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Reason
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Submitted At
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {requests.map((request) => (
                    <motion.tr 
                      key={request.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="hover:bg-gray-50"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center">
                          <div className="mr-2">
                            {getLeaveTypeIcon(request.leave_type)}
                          </div>
                          <span className="capitalize">{request.leave_type}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(request.start_date).toLocaleDateString()} - {new Date(request.end_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {request.total_days} days
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="max-w-xs truncate" title={request.reason}>
                          {request.reason}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getStatusBadge(request.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(request.created_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {request.status === 'pending' && (
                          <button
                            onClick={() => handleCancelRequest(request.id)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Cancel
                          </button>
                        )}
                        {request.rejection_reason && (
                          <div className="text-xs text-red-600 mt-1" title={request.rejection_reason}>
                            Reason: {request.rejection_reason.substring(0, 20)}...
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default LeavePage;