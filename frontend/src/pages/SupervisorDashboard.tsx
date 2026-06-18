import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  FaUsers, 
  FaExclamationTriangle, 
  FaMapMarkerAlt,
  FaUserCheck,
  FaUserClock
} from 'react-icons/fa';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { securityApi } from '@api/securityApi';
import { attendanceApi } from '@api/attendanceApi';
import { adminApi, TeamMember } from '@api/adminApi';
import { faceManagementApi, FaceChangeRequest } from '@api/faceManagementApi';
import { leaveApi, LeaveRequest } from '@api/leaveApi';
import { useNotification } from '@contexts/NotificationContext';
import { websocketService } from '@services/websocketService';

interface SecurityEvent {
  id: number;
  employee_id: number | null;
  event_type: string;
  timestamp: string;
  severity: string;
  employee?: {
    employee_id: string;
    first_name: string;
    last_name: string;
  };
}

interface LoginLog {
  id: number;
  employee_id: number;
  success: boolean;
  spoof_detected: boolean;
  timestamp: string;
  employee?: {
    employee_id: string;
    first_name: string;
    last_name: string;
  };
}

interface TeamAttendance {
  id: number;
  employee_id: number;
  check_in_time: string;
  check_out_time: string | null;
  geo_fence_status: boolean;
  employee?: {
    employee_id: string;
    first_name: string;
    last_name: string;
    department: string;
  };
}

const SupervisorDashboard: React.FC = () => {
  const { showError, showSuccess } = useNotification();
  
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [_loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [teamAttendance, setTeamAttendance] = useState<TeamAttendance[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [faceRequests, setFaceRequests] = useState<FaceChangeRequest[]>([]);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [actionNotes, setActionNotes] = useState<string>('');
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [approvingLeaveId, setApprovingLeaveId] = useState<number | null>(null);
  const [rejectingLeaveId, setRejectingLeaveId] = useState<number | null>(null);
  const [leaveActionReason, setLeaveActionReason] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showPresentModal, setShowPresentModal] = useState(false);
  const [showPendingLeaveModal, setShowPendingLeaveModal] = useState(false);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  });

  // Fetch pending face change requests
  const fetchFaceRequests = async () => {
    try {
      const response = await faceManagementApi.getPendingRequests();
      if (response.data.success) {
        setFaceRequests(response.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch pending face requests:', err);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      setApprovingId(id);
      const response = await faceManagementApi.approveRequest(id, actionNotes);
      if (response.data.success) {
        showSuccess('Face change request approved successfully!');
        setActionNotes('');
        setApprovingId(null);
        fetchFaceRequests();
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
        fetchFaceRequests();
      }
    } catch (err: any) {
      showError(err.response?.data?.message || 'Failed to reject request');
      setRejectingId(null);
    }
  };

  // Fetch pending leave requests
  const fetchLeaveRequests = async () => {
    try {
      const response = await leaveApi.getTeamRequests();
      setLeaveRequests((response.data || []).filter((r: LeaveRequest) => r.status === 'pending'));
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

  // STABILIZATION: Fetch supervisor data with AbortController and resilient parallel fetching
  const fetchData = useCallback(async (signal?: AbortSignal, skipLoading = false) => {
    try {
      if (!skipLoading) setLoading(true);

      // STABILIZATION: Parallel fetch with allSettled — one failure doesn't block others
      const [securityResult, loginResult, attendanceResult, teamResult, faceRequestsResult, leaveRequestsResult] = await Promise.allSettled([
        securityApi.getSecurityEvents(10),
        securityApi.getLoginLogs(10),
        attendanceApi.getHistory({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          limit: 25,
          scope: 'team',
        }),
        adminApi.getMyTeam(),
        faceManagementApi.getPendingRequests(),
        leaveApi.getTeamRequests(),
      ]);

      if (signal?.aborted) return;

      if (securityResult.status === 'fulfilled') {
        setSecurityEvents(securityResult.value.data);
      } else {
        console.error('Security events fetch error:', securityResult.reason);
      }

      if (loginResult.status === 'fulfilled') {
        setLoginLogs(loginResult.value.data);
      } else {
        console.error('Login logs fetch error:', loginResult.reason);
      }

      if (attendanceResult.status === 'fulfilled') {
        setTeamAttendance(
          (attendanceResult.value.data.records || []).map((record: any) => ({
            id: record.id,
            employee_id: record.employee_id,
            check_in_time: record.check_in_time,
            check_out_time: record.check_out_time,
            geo_fence_status: record.geo_fence_status,
            employee: {
              employee_id: record.employee_id,
              first_name: record.first_name,
              last_name: record.last_name,
              department: record.department,
            },
          }))
        );
      } else {
        console.error('Attendance fetch error:', attendanceResult.reason);
      }

      if (teamResult.status === 'fulfilled') {
        setTeamMembers(teamResult.value.data.data || []);
      } else {
        console.error('Team members fetch error:', teamResult.reason);
      }

      if (faceRequestsResult.status === 'fulfilled' && faceRequestsResult.value.data.success) {
        setFaceRequests(faceRequestsResult.value.data.data);
      } else {
        console.error('Face requests fetch error:', faceRequestsResult);
      }

      if (leaveRequestsResult.status === 'fulfilled') {
        setLeaveRequests((leaveRequestsResult.value.data || []).filter((r: LeaveRequest) => r.status === 'pending'));
      } else {
        console.error('Leave requests fetch error:', leaveRequestsResult.reason);
      }
    } catch (error: any) {
      if (error?.name === 'CanceledError') return;
      console.error('Supervisor data fetch error:', error);
      showError('Failed to load supervisor dashboard data');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [dateRange, showError]);

  useEffect(() => {
    const abortController = new AbortController();
    fetchData(abortController.signal);

    // STABILIZATION: Loading timeout — auto-resolve after 15s to prevent infinite spinner
    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 15_000);

    return () => {
      abortController.abort();
      clearTimeout(loadingTimeout);
    };
  }, [fetchData]);

  // Listen for realtime updates via WebSocket
  useEffect(() => {
    const handleRealtimeUpdate = (data: any) => {
      console.log('[SupervisorDashboard] WebSocket event received, re-fetching data...', data);
      // Skip showing loading spinner to avoid UI jarring
      fetchData(undefined, true);
    };

    websocketService.on('attendance_update', handleRealtimeUpdate);
    websocketService.on('security_alert', handleRealtimeUpdate);
    websocketService.on('system_notification', handleRealtimeUpdate);

    return () => {
      websocketService.off('attendance_update', handleRealtimeUpdate);
      websocketService.off('security_alert', handleRealtimeUpdate);
      websocketService.off('system_notification', handleRealtimeUpdate);
    };
  }, [fetchData]);

  // Get event type icon
  const getEventTypeIcon = (type: string) => {
    switch (type) {
      case 'SPOOF_ATTEMPT':
        return <FaExclamationTriangle className="text-red-500" />;
      case 'FACE_MISMATCH':
        return <FaUserClock className="text-yellow-500" />;
      case 'GEOFENCE_VIOLATION':
        return <FaMapMarkerAlt className="text-blue-500" />;
      default:
        return <FaExclamationTriangle className="text-gray-500" />;
    }
  };

  // Get severity color
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high':
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'low':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Present Today selector — filter active check-ins on current date (not checked out)
  const presentTodayRecords = teamAttendance.filter(a => {
    if (!a.check_in_time) return false;
    const checkInDate = new Date(a.check_in_time).toDateString();
    const todayDate = new Date().toDateString();
    return checkInDate === todayDate && a.check_out_time === null;
  });

  // Chart data — computed from REAL security events (no hardcoding)
  const securityEventData = [
    { name: 'Spoof Attempts', value: securityEvents.filter(e => e.event_type === 'SPOOF_ATTEMPT').length },
    { name: 'Face Mismatches', value: securityEvents.filter(e => e.event_type === 'FACE_MISMATCH').length },
    { name: 'Geo Violations', value: securityEvents.filter(e => e.event_type === 'GEOFENCE_VIOLATION').length },
  ];

  // Compute department breakdown from REAL attendance data
  const departmentAttendanceData = (() => {
    const deptMap: Record<string, { present: number; absent: number }> = {};
    teamAttendance.forEach(a => {
      const dept = a.employee?.department || 'Unknown';
      if (!deptMap[dept]) deptMap[dept] = { present: 0, absent: 0 };
      if (a.check_out_time === null) {
        deptMap[dept].present += 1;
      } else {
        deptMap[dept].absent += 1;
      }
    });
    return Object.entries(deptMap).map(([department, counts]) => ({
      department,
      ...counts,
    }));
  })();

  const COLORS = ['#ef4444', '#f59e0b', '#3b82f6'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">Supervisor Dashboard</h1>
          <p className="text-gray-600 mt-1">Monitor your team's attendance and security events</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Stats Overview — All metrics from real API data */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <motion.div
            whileHover={{ y: -5 }}
            onClick={() => setShowTeamModal(true)}
            className="bg-white rounded-xl shadow p-6 cursor-pointer"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                <FaUsers className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Team Size</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : (teamMembers.length > 0 ? teamMembers.length : '—')}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            className="bg-white rounded-xl shadow p-6"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-red-100 text-red-600">
                <FaExclamationTriangle className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Security Alerts</p>
                <p className="text-2xl font-bold text-gray-900">
                  {securityEvents.length}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            onClick={() => setShowPresentModal(true)}
            className="bg-white rounded-xl shadow p-6 cursor-pointer"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100 text-green-600">
                <FaUserCheck className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Present Today</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : presentTodayRecords.length}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            onClick={() => setShowPendingLeaveModal(true)}
            className="bg-white rounded-xl shadow p-6 cursor-pointer"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-yellow-100 text-yellow-600">
                <FaUserClock className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Pending Leave</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '...' : leaveRequests.length}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Security Events Chart */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Security Events Distribution</h2>
            <div className="h-80">
              {securityEventData.every(d => d.value === 0) ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <FaUserCheck className="mx-auto text-4xl text-green-300 mb-2" />
                    <p>No Security Events</p>
                    <p className="text-sm text-gray-400 mt-1">System is operating normally</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={securityEventData.filter(d => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      labelLine={true}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {securityEventData.filter(d => d.value > 0).map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Team Attendance Chart — Real data, no hardcoding */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Team Attendance by Department</h2>
            <div className="h-80">
              {departmentAttendanceData.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-500">
                  <div className="text-center">
                    <FaUsers className="mx-auto text-4xl text-gray-300 mb-2" />
                    <p>No Data Available</p>
                    <p className="text-sm text-gray-400 mt-1">No attendance records for selected period</p>
                  </div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departmentAttendanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="department" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="present" name="Present" fill="#10b981" />
                    <Bar dataKey="absent" name="Absent" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* Pending Face Approvals Panel */}
        <div className="bg-white rounded-xl shadow overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Pending Face Change Approvals</h2>
            <p className="text-gray-500 text-sm mt-1">Review and approve biometric face registration requests from your team members.</p>
          </div>
          
          {faceRequests.length === 0 ? (
            <div className="py-12 text-center">
              <FaUserCheck className="mx-auto text-4xl text-green-300" />
              <p className="mt-4 text-gray-600">No pending face change requests.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {faceRequests.map((request) => (
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

        {/* Pending Leave Approvals Panel */}
        <div className="bg-white rounded-xl shadow overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Pending Leave Approvals</h2>
            <p className="text-gray-500 text-sm mt-1">Review and approve or reject leave requests from your team members.</p>
          </div>
          
          {leaveRequests.length === 0 ? (
            <div className="py-12 text-center">
              <FaUserCheck className="mx-auto text-4xl text-green-300" />
              <p className="mt-4 text-gray-600">No pending leave requests.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {leaveRequests.map((request) => (
                <div key={request.id} className="p-6 flex flex-col md:flex-row md:items-center md:justify-between hover:bg-gray-50 transition-colors">
                  <div className="mb-4 md:mb-0">
                    <div className="flex items-center space-x-3">
                      <span className="font-semibold text-gray-900">
                        {request.employee?.first_name} {request.employee?.last_name}
                      </span>
                      <span className="text-xs text-gray-500">({request.employee?.employee_id})</span>
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

        {/* Security Events Table */}
        <div className="bg-white rounded-xl shadow overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-xl font-bold text-gray-900">Recent Security Events</h2>
            <div className="flex space-x-3">
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({...dateRange, startDate: e.target.value})}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm"
              />
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({...dateRange, endDate: e.target.value})}
                className="px-3 py-1 border border-gray-300 rounded-md text-sm"
              />
            </div>
          </div>
          
          {loading ? (
            <div className="py-12 text-center">
              <svg className="animate-spin h-12 w-12 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="mt-4 text-gray-600">Loading security events...</p>
            </div>
          ) : securityEvents.length === 0 ? (
            <div className="py-12 text-center">
              <FaExclamationTriangle className="mx-auto text-4xl text-gray-300" />
              <p className="mt-4 text-gray-600">No security events found for the selected date range.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Employee
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Event Type
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Severity
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {securityEvents.map((event) => (
                    <motion.tr 
                      key={event.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="hover:bg-gray-50"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {event.employee ? (
                          <div>
                            <div className="font-medium">
                              {event.employee.first_name} {event.employee.last_name}
                            </div>
                            <div className="text-gray-500 text-xs">
                              {event.employee.employee_id}
                            </div>
                          </div>
                        ) : (
                          'Unknown'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center">
                          <div className="mr-2">
                            {getEventTypeIcon(event.event_type)}
                          </div>
                          <span>{event.event_type.replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(event.timestamp).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span className={`px-2 py-1 text-xs rounded-full ${getSeverityColor(event.severity)}`}>
                          {event.severity}
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Team Attendance Table */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Team Attendance Status</h2>
          </div>
          
          {loading ? (
            <div className="py-12 text-center">
              <svg className="animate-spin h-12 w-12 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="mt-4 text-gray-600">Loading team attendance...</p>
            </div>
          ) : teamAttendance.length === 0 ? (
            <div className="py-12 text-center">
              <FaUsers className="mx-auto text-4xl text-gray-300" />
              <p className="mt-4 text-gray-600">No team attendance data available.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Employee
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Department
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Check-in Time
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Geo-fence
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {teamAttendance.map((attendance) => (
                    <motion.tr 
                      key={attendance.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="hover:bg-gray-50"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {attendance.employee ? (
                          <div>
                            <div className="font-medium">
                              {attendance.employee.first_name} {attendance.employee.last_name}
                            </div>
                            <div className="text-gray-500 text-xs">
                              {attendance.employee.employee_id}
                            </div>
                          </div>
                        ) : (
                          'Unknown'
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {attendance.employee?.department || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(attendance.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {attendance.check_out_time ? (
                          <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                            Checked Out
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                            Present
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {attendance.geo_fence_status ? (
                          <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                            Within Fence
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
                            Outside Fence
                          </span>
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

      {/* Team Members Details Modal */}
      {showTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl relative max-h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center pb-4 border-b border-gray-200">
              <h3 className="text-2xl font-bold text-gray-800">
                Assigned Team Members ({teamMembers.length})
              </h3>
              <button
                onClick={() => setShowTeamModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-semibold focus:outline-none"
              >
                &times;
              </button>
            </div>
            
            <div className="overflow-y-auto my-4 flex-1">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Employee ID
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Name
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Department
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Position
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Hire Date
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {teamMembers.map((member) => (
                    <tr key={member.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {member.employee_id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {member.first_name} {member.last_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {member.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {member.department}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {member.position}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(member.hire_date).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setShowTeamModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-medium text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Present Today Details Modal */}
      {showPresentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 p-4">
          <div className="bg-white rounded-2xl max-w-5xl w-full p-6 shadow-2xl relative max-h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center pb-4 border-b border-gray-200">
              <h3 className="text-2xl font-bold text-gray-800">
                Employees Present Today ({presentTodayRecords.length})
              </h3>
              <button
                onClick={() => setShowPresentModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-semibold focus:outline-none"
              >
                &times;
              </button>
            </div>
            
            <div className="overflow-y-auto my-4 flex-1">
              {presentTodayRecords.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No employees are currently present.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Employee ID
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Email
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Department
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Position
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Check-In Time
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Geo-Fence Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {presentTodayRecords.map((attendance) => {
                      const member = teamMembers.find(m => m.employee_id === attendance.employee?.employee_id);
                      return (
                        <tr key={attendance.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {attendance.employee?.employee_id}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {attendance.employee?.first_name} {attendance.employee?.last_name}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {member?.email || '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {attendance.employee?.department || '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {member?.position || '—'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {new Date(attendance.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {attendance.geo_fence_status ? (
                              <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                                Within Fence
                              </span>
                            ) : (
                              <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
                                Outside Fence
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setShowPresentModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-medium text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Leave Details Modal */}
      {showPendingLeaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 p-4">
          <div className="bg-white rounded-2xl max-w-5xl w-full p-6 shadow-2xl relative max-h-[80vh] flex flex-col animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center pb-4 border-b border-gray-200">
              <h3 className="text-2xl font-bold text-gray-800">
                Pending Leave Requests ({leaveRequests.length})
              </h3>
              <button
                onClick={() => setShowPendingLeaveModal(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl font-semibold focus:outline-none"
              >
                &times;
              </button>
            </div>
            
            <div className="overflow-y-auto my-4 flex-1">
              {leaveRequests.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No pending leave requests.</p>
              ) : (
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Employee ID
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Type
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Dates
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Total Days
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Reason
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Submitted On
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {leaveRequests.map((request) => (
                      <tr key={request.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {request.employee?.employee_id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {request.employee?.first_name} {request.employee?.last_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 uppercase">
                          {request.leave_type}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(request.start_date).toLocaleDateString()} to {new Date(request.end_date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {request.total_days} {request.total_days === 1 ? 'day' : 'days'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                          {request.reason}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {new Date(request.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setShowPendingLeaveModal(false)}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors font-medium text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupervisorDashboard;
