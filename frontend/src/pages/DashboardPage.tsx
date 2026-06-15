import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  FaUserClock, 
  FaCalendarAlt, 
  FaChartBar, 
  FaShieldAlt, 
  FaMapMarkerAlt,
  FaCamera,
} from 'react-icons/fa';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { attendanceApi } from '@api/attendanceApi';
import { securityApi } from '@api/securityApi';
import { faceManagementApi } from '@api/faceManagementApi';
import FaceCamera from '@components/camera/FaceCamera';
import { useAuth } from '@contexts/AuthContext';
import { useNotification } from '@contexts/NotificationContext';
import { locationService } from '@services/locationService';
import { formatDistance, getGeoFenceStatusText, getGeoFenceStatusColor } from '@utils/geofenceUtils';
import { websocketService } from '@services/websocketService';

interface AttendanceStats {
  totalCheckins: number;
  averageHours: string;
  geoFenceCompliance: string;
  lateArrivals: number;
}

interface SecurityEvent {
  id: number;
  event_type: string;
  timestamp: string;
  severity: string;
}

// STABILIZATION: Auto-refresh interval (60 seconds)
const REFRESH_INTERVAL_MS = 60_000;

const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { showError, showSuccess } = useNotification();
  
  
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStats | null>(null);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [checkInStatus, setCheckInStatus] = useState<'checked-in' | 'checked-out' | 'loading'>('loading');
  const [lastCheckIn, setLastCheckIn] = useState<string | null>(null);
  // STABILIZATION: Per-section loading states for partial render support
  const [statsLoading, setStatsLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  // Weekly chart data from real attendance history
  const [weeklyChartData, setWeeklyChartData] = useState<{ day: string; hours: number }[]>([]);

  // Face Enrollment States
  const [isFaceModalOpen, setIsFaceModalOpen] = useState(false);
  const [faceFrames, setFaceFrames] = useState<{ data: string; timestamp: number }[]>([]);
  const [isFaceSubmitting, setIsFaceSubmitting] = useState(false);
  const [faceEnrolled, setFaceEnrolled] = useState<boolean>((user as any)?.faceEnrolled || false);

  useEffect(() => {
    if (user) {
      setFaceEnrolled(!!(user as any).faceEnrolled);
    }
  }, [user]);

  const handleFaceFrameCapture = (frame: string) => {
    const base64Data = frame.replace('data:image/jpeg;base64,', '');
    setFaceFrames((prev) => [
      ...prev.slice(-19), // Keep only last 19 frames
      {
        data: base64Data,
        timestamp: Date.now(),
      },
    ]);
  };

  const handleSubmitFaceRequest = async () => {
    if (!user) return;
    if (faceFrames.length < 10) {
      showError('Please wait for at least 10 frames to be captured.');
      return;
    }

    try {
      setIsFaceSubmitting(true);
      const requestType = faceEnrolled ? 'UPDATE' : 'ADD';
      const response = await faceManagementApi.submitRequest({
        employeeId: user.employeeId,
        requestType,
        frames: faceFrames.map(f => f.data),
      });

      if (response.data.success) {
        if (response.data.instant) {
          showSuccess('Face profile registered instantly!');
          setFaceEnrolled(true);
        } else {
          showSuccess('Face change request submitted successfully and is pending approval.');
        }
        setIsFaceModalOpen(false);
        setFaceFrames([]);
      } else {
        showError(response.data.message || 'Failed to submit face request.');
      }
    } catch (err: any) {
      console.error('Face submit error:', err);
      showError(err.response?.data?.message || 'Failed to submit request. Please try again.');
    } finally {
      setIsFaceSubmitting(false);
    }
  };

  // STABILIZATION: Parallelized fetch with Promise.allSettled — one failure no longer blocks others
  const fetchDashboardData = async (signal: AbortSignal) => {
    const statsPromise = attendanceApi.getStats('month')
      .then((resp) => {
        if (!signal.aborted) {
          // STABILIZATION: Backend returns both flat fields and nested `stats` — normalize
          const data: any = resp.data;
          const stats: AttendanceStats = data.stats || {
            totalCheckins: data.totalCheckins ?? 0,
            averageHours: data.averageHours ?? '0',
            geoFenceCompliance: data.geoFenceCompliance ?? '0',
            lateArrivals: data.lateArrivals ?? 0,
          };
          setAttendanceStats(stats);
          setStatsLoading(false);
        }
      })
      .catch((err) => {
        if (err?.name !== 'CanceledError' && !signal.aborted) {
          console.error('Stats fetch error:', err);
          setStatsLoading(false);
        }
      });

    const eventsPromise = (user?.role === 'admin' || user?.role === 'supervisor')
      ? securityApi.getSecurityEvents(5)
          .then((resp) => {
            if (!signal.aborted) {
              setSecurityEvents(resp.data);
              setEventsLoading(false);
            }
          })
          .catch((err) => {
            if (err?.name !== 'CanceledError' && !signal.aborted) {
              console.error('Security events fetch error:', err);
              setEventsLoading(false);
            }
          })
      : Promise.resolve().then(() => { setSecurityEvents([]); setEventsLoading(false); });

    const locationPromise = locationService.getCurrentPosition()
      .then((loc) => {
        if (!signal.aborted) {
          setLocation({ latitude: loc.latitude, longitude: loc.longitude });
        }
      })
      .catch((err) => {
        if (!signal.aborted) console.error('Location error:', err);
      });

    const todayPromise = attendanceApi.getToday()
      .then((resp) => {
        if (!signal.aborted) {
          setCheckInStatus(resp.data.status);
          setLastCheckIn(resp.data.lastCheckIn);
        }
      })
      .catch((err) => {
        if (err?.name !== 'CanceledError' && !signal.aborted) {
          console.error('Today attendance fetch error:', err);
          // STABILIZATION: Default to checked-out on error instead of leaving loading
          setCheckInStatus('checked-out');
        }
      });

    // Fetch real weekly attendance history for chart
    const weeklyPromise = attendanceApi.getHistory({
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      limit: 100,
    })
      .then((resp) => {
        if (!signal.aborted) {
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayHoursMap: Record<string, number> = {};

          (resp.data.records || []).forEach((record: any) => {
            const day = dayNames[new Date(record.check_in_time).getDay()];
            // Parse work_hours interval if available, otherwise compute from check_in/out
            let hours = 0;
            if (record.work_hours) {
              // work_hours may be ISO interval like "08:30:00" or PostgreSQL interval
              const parts = String(record.work_hours).split(':');
              if (parts.length >= 2) {
                hours = parseFloat(parts[0]) + parseFloat(parts[1]) / 60;
              }
            } else if (record.check_out_time) {
              const diff = new Date(record.check_out_time).getTime() - new Date(record.check_in_time).getTime();
              hours = diff / (1000 * 60 * 60);
            }
            // Average hours per day
            if (!dayHoursMap[day]) dayHoursMap[day] = 0;
            dayHoursMap[day] = Math.max(dayHoursMap[day], parseFloat(hours.toFixed(1)));
          });

          const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
          const chartData = orderedDays.map(d => ({ day: d, hours: dayHoursMap[d] || 0 }));
          setWeeklyChartData(chartData);
        }
      })
      .catch((err) => {
        if (err?.name !== 'CanceledError' && !signal.aborted) {
          console.error('Weekly history fetch error:', err);
          // Leave chart empty — show empty state
        }
      });

    // STABILIZATION: All fetches run in parallel — one failure doesn't block others
    await Promise.allSettled([statsPromise, eventsPromise, locationPromise, todayPromise, weeklyPromise]);
  };

  // Fetch dashboard data
  useEffect(() => {
    const abortController = new AbortController();

    fetchDashboardData(abortController.signal);

    // STABILIZATION: Auto-refresh every 60s for live dashboard
    const refreshTimer = setInterval(() => {
      if (!abortController.signal.aborted) {
        fetchDashboardData(abortController.signal);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      abortController.abort();
      clearInterval(refreshTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  // STABILIZATION: Loading timeout safety nets — auto-resolve after 15s
  useEffect(() => {
    const statsTimeout = setTimeout(() => {
      setStatsLoading(false);
    }, 15_000);
    const eventsTimeout = setTimeout(() => {
      setEventsLoading(false);
    }, 15_000);
    const checkInTimeout = setTimeout(() => {
      setCheckInStatus((prev) => prev === 'loading' ? 'checked-out' : prev);
    }, 15_000);
    return () => {
      clearTimeout(statsTimeout);
      clearTimeout(eventsTimeout);
      clearTimeout(checkInTimeout);
    };
  }, []);

  // STABILIZATION: Listen for realtime attendance updates via WebSocket
  useEffect(() => {
    const handleAttendanceUpdate = (data: any) => {
      if (data?.status) setCheckInStatus(data.status);
      if (data?.lastCheckIn) setLastCheckIn(data.lastCheckIn);
    };

    websocketService.on('attendance_update', handleAttendanceUpdate);
    return () => {
      websocketService.off('attendance_update', handleAttendanceUpdate);
    };
  }, []);

  // Handle check-in
  const handleCheckIn = async () => {
    if (!location) {
      showError('Location not available. Please enable location services.');
      return;
    }
    
    try {
      setCheckInStatus('loading');
      const response = await attendanceApi.checkIn({ location });
      setCheckInStatus('checked-in');
      setLastCheckIn(response.data.record.check_in_time);
      showSuccess('Successfully checked in!');
    } catch (error: any) {
      console.error('Check-in error:', error);
      showError(error.response?.data?.error || 'Check-in failed. Please try again.');
      setCheckInStatus('checked-out');
    }
  };

  // Handle check-out
  const handleCheckOut = async () => {
    try {
      setCheckInStatus('loading');
      await attendanceApi.checkOut({ location: location || undefined });
      setCheckInStatus('checked-out');
      showSuccess('Successfully checked out!');
    } catch (error: any) {
      console.error('Check-out error:', error);
      showError(error.response?.data?.error || 'Check-out failed. Please try again.');
      setCheckInStatus('checked-in');
    }
  };

  // Chart data — weeklyChartData is built from real API attendance records
  const attendanceChartData = weeklyChartData.length > 0
    ? weeklyChartData
    : [{ day: 'Mon', hours: 0 }, { day: 'Tue', hours: 0 }, { day: 'Wed', hours: 0 }, { day: 'Thu', hours: 0 }, { day: 'Fri', hours: 0 }];

  const geoCompliance = attendanceStats ? parseFloat(attendanceStats.geoFenceCompliance) || 0 : 0;
  const complianceData = [
    { name: 'Within Fence', value: geoCompliance },
    { name: 'Outside Fence', value: Math.max(0, 100 - geoCompliance) },
  ];

  const COLORS = ['#10B981', '#EF4444'];
  const isLoading = checkInStatus === 'loading';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">Welcome back, {(user as any)?.firstName ?? ''} {(user as any)?.lastName ?? ''}</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <motion.div
            whileHover={{ y: -5 }}
            className="bg-white rounded-xl shadow p-6"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                <FaUserClock className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Check-ins</p>
                <p className="text-2xl font-bold text-gray-900">
                  {statsLoading ? '...' : (attendanceStats?.totalCheckins || 0)}
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            className="bg-white rounded-xl shadow p-6"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100 text-green-600">
                <FaCalendarAlt className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Avg. Hours/Day</p>
                <p className="text-2xl font-bold text-gray-900">
                  {statsLoading ? '...' : (attendanceStats?.averageHours || '0')}h
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            className="bg-white rounded-xl shadow p-6"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-purple-100 text-purple-600">
                <FaMapMarkerAlt className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Geo Compliance</p>
                <p className="text-2xl font-bold text-gray-900">
                  {statsLoading ? '...' : (attendanceStats?.geoFenceCompliance || '0')}%
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            whileHover={{ y: -5 }}
            className="bg-white rounded-xl shadow p-6"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-yellow-100 text-yellow-600">
                <FaChartBar className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Late Arrivals</p>
                <p className="text-2xl font-bold text-gray-900">
                  {statsLoading ? '...' : (attendanceStats?.lateArrivals || 0)}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Attendance Chart */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Weekly Attendance</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={attendanceChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="hours" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent Security Events */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Security Events</h2>
              <div className="space-y-4">
                {eventsLoading ? (
                  <div className="py-4 text-center">
                    <div className="h-6 w-6 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin mx-auto" />
                    <p className="text-gray-500 text-sm mt-2">Loading events...</p>
                  </div>
                ) : securityEvents.length > 0 ? (
                  securityEvents.map((event) => (
                    <div key={event.id} className="flex items-center p-3 border border-gray-200 rounded-lg">
                      <div className={`p-2 rounded-full ${
                        event.severity === 'high' || event.severity === 'critical' 
                          ? 'bg-red-100 text-red-600' 
                          : event.severity === 'medium' 
                            ? 'bg-yellow-100 text-yellow-600' 
                            : 'bg-green-100 text-green-600'
                      }`}>
                        <FaShieldAlt />
                      </div>
                      <div className="ml-4 flex-1">
                        <h3 className="font-medium text-gray-900">{event.event_type}</h3>
                        <p className="text-sm text-gray-500">
                          {new Date(event.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        event.severity === 'high' || event.severity === 'critical' 
                          ? 'bg-red-100 text-red-800' 
                          : event.severity === 'medium' 
                            ? 'bg-yellow-100 text-yellow-800' 
                            : 'bg-green-100 text-green-800'
                      }`}>
                        {event.severity}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-center py-4">No recent security events</p>
                )}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-8">
            {/* Check-in Widget */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Attendance</h2>
              <div className="text-center py-4">
                {checkInStatus === 'checked-in' ? (
                  <div className="bg-green-100 text-green-800 px-4 py-2 rounded-full inline-block">
                    Checked In
                  </div>
                ) : checkInStatus === 'checked-out' ? (
                  <div className="bg-gray-100 text-gray-800 px-4 py-2 rounded-full inline-block">
                    Checked Out
                  </div>
                ) : (
                  <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full inline-block">
                    Loading...
                  </div>
                )}
                
                {lastCheckIn && (
                  <p className="text-sm text-gray-600 mt-2">
                    Last check-in: {new Date(lastCheckIn).toLocaleTimeString()}
                  </p>
                )}
              </div>
              
              <div className="mt-6 space-y-3">
                {checkInStatus === 'checked-out' ? (
                  <button
                    onClick={handleCheckIn}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                  >
                    <FaCamera className="mr-2" />
                    Check In
                  </button>
                ) : checkInStatus === 'checked-in' ? (
                  <button
                    onClick={handleCheckOut}
                    disabled={isLoading}
                    className="w-full flex items-center justify-center px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                  >
                    <FaUserClock className="mr-2" />
                    Check Out
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full flex items-center justify-center px-4 py-2 bg-gray-300 text-gray-600 rounded-lg"
                  >
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </button>
                )}
              </div>
              
              {location && (
                <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm font-medium text-blue-800">Current Location</p>
                  <p className="text-xs text-blue-600 mt-1">
                    Lat: {location.latitude.toFixed(6)}, Lng: {location.longitude.toFixed(6)}
                  </p>
                </div>
              )}
            </div>

            {/* Face Profile Widget */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Face Profile</h2>
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg mb-6">
                <div>
                  <p className="text-sm font-medium text-gray-600">Status</p>
                  <div className="flex items-center mt-1">
                    {faceEnrolled ? (
                      <>
                        <span className="h-2.5 w-2.5 rounded-full bg-green-500 mr-2" />
                        <span className="text-sm font-bold text-green-800 bg-green-100 px-2.5 py-0.5 rounded-full">
                          Enrolled
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="h-2.5 w-2.5 rounded-full bg-yellow-500 mr-2" />
                        <span className="text-sm font-bold text-yellow-800 bg-yellow-100 px-2.5 py-0.5 rounded-full">
                          Not Enrolled
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="p-3 rounded-full bg-blue-50 text-blue-600">
                  <FaCamera className="text-xl" />
                </div>
              </div>

              <button
                onClick={() => {
                  setFaceFrames([]);
                  setIsFaceModalOpen(true);
                }}
                className="w-full flex items-center justify-center px-4 py-2.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-lg transition-colors font-medium"
              >
                <FaCamera className="mr-2" />
                {faceEnrolled ? 'Request Face Update' : 'Enroll Face Profile'}
              </button>
            </div>

            {/* Geo-fence Compliance */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Geo-fence Compliance</h2>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={complianceData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={60}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {complianceData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 text-center">
                <p className={`text-sm ${getGeoFenceStatusColor(true)}`}>
                  {getGeoFenceStatusText(true)} - {formatDistance(50)} from office
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      {/* Face Enrollment Modal */}
      {isFaceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative">
            <h3 className="text-2xl font-bold text-gray-800 mb-2">
              {faceEnrolled ? 'Request Face Profile Update' : 'Enroll Face Profile'}
            </h3>
            <p className="text-gray-600 text-sm mb-4">
              Please position your face clearly in the frame. We will capture multiple frames to compute your secure biometric signature.
            </p>

            <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden mb-4 relative max-h-72">
              <FaceCamera
                onCapture={handleFaceFrameCapture}
                className="w-full h-full"
                autoCapture={true}
                captureInterval={150}
                showControls={false}
              />
            </div>

            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex justify-between text-sm mb-1 text-gray-700">
                <span>Capture Progress</span>
                <span className="font-semibold">{faceFrames.length}/20 frames</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((faceFrames.length / 20) * 100, 100)}%` }}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                disabled={isFaceSubmitting}
                onClick={() => {
                  setIsFaceModalOpen(false);
                  setFaceFrames([]);
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isFaceSubmitting || faceFrames.length < 10}
                onClick={handleSubmitFaceRequest}
                className="px-5 py-2 text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isFaceSubmitting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Submitting...
                  </>
                ) : (
                  'Submit Request'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
