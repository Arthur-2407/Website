import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
  totalCheckouts: number;
  averageHours: string;
  geoFenceCompliance: string;
  lateArrivals: number | string;
}

// Helper function to calculate overlap hours between attendance session and shift timing
const calculateOverlapHours = (
  checkInStr: string,
  checkOutStr: string | null | undefined,
  startStr: string,
  endStr: string
): number => {
  try {
    const checkIn = new Date(checkInStr);
    const checkOut = checkOutStr ? new Date(checkOutStr) : new Date();

    const parseTime = (timeStr: string) => {
      const [h, m, s] = timeStr.split(':').map(Number);
      return { hours: h, minutes: m || 0, seconds: s || 0 };
    };

    const startT = parseTime(startStr);
    const endT = parseTime(endStr);

    const getShiftInterval = (baseDate: Date, startT: any, endT: any) => {
      const start = new Date(baseDate);
      start.setHours(startT.hours, startT.minutes, startT.seconds, 0);

      const end = new Date(baseDate);
      if (endT.hours < startT.hours || (endT.hours === startT.hours && endT.minutes < startT.minutes)) {
        // Crosses midnight
        end.setDate(end.getDate() + 1);
      }
      end.setHours(endT.hours, endT.minutes, endT.seconds, 0);
      return { start, end };
    };

    const getOverlapMs = (interval1: { start: Date; end: Date }, interval2: { start: Date; end: Date }) => {
      const start = Math.max(interval1.start.getTime(), interval2.start.getTime());
      const end = Math.min(interval1.end.getTime(), interval2.end.getTime());
      return Math.max(0, end - start);
    };

    let maxOverlapMs = 0;

    // Check shift starting on previous day, same day, and next day to handle cross-midnight shifts robustly
    for (let offset = -1; offset <= 1; offset++) {
      const baseDate = new Date(checkIn);
      baseDate.setDate(baseDate.getDate() + offset);
      const shiftInterval = getShiftInterval(baseDate, startT, endT);
      const overlapMs = getOverlapMs(shiftInterval, { start: checkIn, end: checkOut });
      if (overlapMs > maxOverlapMs) {
        maxOverlapMs = overlapMs;
      }
    }

    return maxOverlapMs / (1000 * 60 * 60);
  } catch (err) {
    console.error('calculateOverlapHours error:', err);
    return 0;
  }
};

interface SecurityEvent {
  id: number;
  event_type: string;
  timestamp: string;
  severity: string;
}

// STABILIZATION: Auto-refresh interval (60 seconds)
const REFRESH_INTERVAL_MS = 60_000;

const DashboardPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
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
  const [selectedWeekOffset, setSelectedWeekOffset] = useState<number>(0);
  const [chartDayModal, setChartDayModal] = useState<{ day: string; date: string; sessions: any[] } | null>(null);

  // Interactive Stats Modal States
  const [activeModal, setActiveModal] = useState<'checkins' | 'hours' | 'compliance' | 'late' | null>(null);
  const [historyRecords, setHistoryRecords] = useState<any[]>([]);
  const [myTiming, setMyTiming] = useState<{ work_start_time: string; work_end_time: string; has_assigned_timing: boolean } | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  // Helper to compute Mon-Sat bounds for a given week offset (0 = current week, 1 = 1 week ago, etc.)
  const getWeekBounds = (offset: number) => {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) - (offset * 7);
    const monday = new Date(now.getTime());
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);

    const saturday = new Date(monday.getTime());
    saturday.setDate(monday.getDate() + 5);
    saturday.setHours(23, 59, 59, 999);

    return { monday, saturday };
  };

  const formatDateShort = (date: Date) => {
    const d = date.getDate();
    const m = date.getMonth() + 1;
    const y = date.getFullYear().toString().slice(-2);
    return `${d}.${m}.${y}`;
  };

  const getWeekRangeString = (offset: number) => {
    const { monday, saturday } = getWeekBounds(offset);
    return `${formatDateShort(monday)} to ${formatDateShort(saturday)}`;
  };

  // Recompute weekly chart data when historyRecords or selectedWeekOffset changes
  useEffect(() => {
    const { monday, saturday } = getWeekBounds(selectedWeekOffset);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayHoursMap: Record<string, number> = {
      'Mon': 0, 'Tue': 0, 'Wed': 0, 'Thu': 0, 'Fri': 0, 'Sat': 0
    };

    historyRecords.forEach((record: any) => {
      const checkInDate = new Date(record.check_in_time);
      if (checkInDate >= monday && checkInDate <= saturday) {
        const dayName = dayNames[checkInDate.getDay()];
        if (dayName !== 'Sun') {
          let durationMs = 0;
          if (record.check_out_time) {
            durationMs = new Date(record.check_out_time).getTime() - checkInDate.getTime();
          } else {
            const isToday = checkInDate.toDateString() === new Date().toDateString();
            if (isToday) {
              durationMs = Math.max(0, Date.now() - checkInDate.getTime());
            }
          }
          const hours = durationMs / (1000 * 60 * 60);
          dayHoursMap[dayName] = (dayHoursMap[dayName] || 0) + hours;
        }
      }
    });

    const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const chartData = orderedDays.map(d => ({
      day: d,
      hours: parseFloat((dayHoursMap[d] || 0).toFixed(2))
    }));
    setWeeklyChartData(chartData);
  }, [historyRecords, selectedWeekOffset]);

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
          await refreshUser();
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

    // Fetch full history records (limit 1000) for real-time interactive calculations
    const fullHistoryPromise = attendanceApi.getHistory({
      limit: 1000,
      scope: 'self',
    })
      .then((resp) => {
        if (!signal.aborted) {
          setHistoryRecords(resp.data.records || []);
        }
      })
      .catch((err) => {
        if (err?.name !== 'CanceledError' && !signal.aborted) {
          console.error('Full history fetch error:', err);
        }
      });

    // Fetch employee timings
    const timingPromise = attendanceApi.getMyTiming()
      .then((resp) => {
        if (!signal.aborted) {
          setMyTiming(resp.data);
        }
      })
      .catch((err) => {
        if (err?.name !== 'CanceledError' && !signal.aborted) {
          console.error('Timing fetch error:', err);
        }
      });

    // STABILIZATION: All fetches run in parallel — one failure doesn't block others
    await Promise.allSettled([
      statsPromise,
      eventsPromise,
      locationPromise,
      todayPromise,
      fullHistoryPromise,
      timingPromise
    ]);
  };

  // Dynamic stats recalculation hook
  useEffect(() => {
    if (historyRecords.length === 0) return;

    // 1. Total Check-ins and outs
    const totalCheckinsCount = historyRecords.length;
    const totalCheckoutsCount = historyRecords.filter(r => r.check_out_time).length;

    // 2. Avg. Hours/Day (Restricted to office shift work hours)
    const startStr = myTiming?.work_start_time || '09:00:00';
    const endStr = myTiming?.work_end_time || '18:00:00';
    const dailyHoursMap: Record<string, number> = {};
    historyRecords.forEach((record) => {
      const dateKey = new Date(record.check_in_time).toLocaleDateString();
      const hours = calculateOverlapHours(
        record.check_in_time,
        record.check_out_time,
        startStr,
        endStr
      );
      dailyHoursMap[dateKey] = (dailyHoursMap[dateKey] || 0) + hours;
    });

    const dates = Object.keys(dailyHoursMap);
    const avgHours = dates.length > 0
      ? (Object.values(dailyHoursMap).reduce((a, b) => a + b, 0) / dates.length).toFixed(1)
      : '0';

    // 3. Geo Compliance (check-in <= 500m & check-out <= 500m)
    let totalGeoEvents = 0;
    let compliantGeoEvents = 0;
    historyRecords.forEach((record) => {
      // Check-in Compliance
      if (record.distance_from_office !== null && record.distance_from_office !== undefined) {
        totalGeoEvents++;
        if (record.distance_from_office <= 500) {
          compliantGeoEvents++;
        }
      }
      // Check-out Compliance
      if (record.check_out_time && record.checkout_distance_from_office !== null && record.checkout_distance_from_office !== undefined) {
        totalGeoEvents++;
        if (record.checkout_distance_from_office <= 500) {
          compliantGeoEvents++;
        }
      }
    });

    const geoComplianceRate = totalGeoEvents > 0
      ? ((compliantGeoEvents / totalGeoEvents) * 100).toFixed(1)
      : '100.0';

    // 4. Late Arrivals (based on assigned work_start_time)
    let lateArrivalsValue: number | string = 'Unassigned';
    if (myTiming?.has_assigned_timing) {
      const shiftStartStr = myTiming.work_start_time;
      const [startH, startM] = shiftStartStr.split(':').map(Number);
      let lateCount = 0;

      historyRecords.forEach((record) => {
        const checkInDate = new Date(record.check_in_time);
        const checkInHour = checkInDate.getHours();
        const checkInMin = checkInDate.getMinutes();
        const checkInTimeInMins = checkInHour * 60 + checkInMin;
        const shiftStartTimeInMins = startH * 60 + startM;

        if (checkInTimeInMins > shiftStartTimeInMins) {
          lateCount++;
        }
      });
      lateArrivalsValue = lateCount;
    }

    setAttendanceStats({
      totalCheckins: totalCheckinsCount,
      totalCheckouts: totalCheckoutsCount,
      averageHours: avgHours,
      geoFenceCompliance: geoComplianceRate,
      lateArrivals: lateArrivalsValue
    });
  }, [historyRecords, myTiming]);

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
    try {
      setCheckInStatus('loading');
      const loc = await locationService.getCurrentPosition();
      const freshLocation = {
        latitude: loc.latitude,
        longitude: loc.longitude,
      };
      setLocation(freshLocation);

      const response = await attendanceApi.checkIn({ location: freshLocation });
      setCheckInStatus('checked-in');
      setLastCheckIn(response.data.record.check_in_time);
      showSuccess('Successfully checked in!');
      const abortController = new AbortController();
      fetchDashboardData(abortController.signal);
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
      let freshLocation = undefined;
      try {
        const loc = await locationService.getCurrentPosition();
        freshLocation = {
          latitude: loc.latitude,
          longitude: loc.longitude,
        };
        setLocation(freshLocation);
      } catch (locErr) {
        console.warn('Could not retrieve current position on checkout:', locErr);
      }

      await attendanceApi.checkOut({ location: freshLocation || undefined });
      setCheckInStatus('checked-out');
      showSuccess('Successfully checked out!');
      const abortController = new AbortController();
      fetchDashboardData(abortController.signal);
    } catch (error: any) {
      console.error('Check-out error:', error);
      showError(error.response?.data?.error || 'Check-out failed. Please try again.');
      setCheckInStatus('checked-in');
    }
  };

  // Chart data — weeklyChartData is built from real API attendance records
  const attendanceChartData = weeklyChartData.length > 0
    ? weeklyChartData
    : [
        { day: 'Mon', hours: 0 },
        { day: 'Tue', hours: 0 },
        { day: 'Wed', hours: 0 },
        { day: 'Thu', hours: 0 },
        { day: 'Fri', hours: 0 },
        { day: 'Sat', hours: 0 }
      ];

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
          {user && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-gray-500">
              <span><strong>ID:</strong> {user.employeeId}</span>
              <span className="text-gray-300">•</span>
              <span><strong>Department:</strong> {user.department}</span>
              {user.role !== 'admin' && (
                <>
                  <span className="text-gray-300">•</span>
                  <span>
                    <strong>Supervisor:</strong>{' '}
                    {(user as any).supervisorName ? (
                      <span className="text-blue-600 font-medium">{(user as any).supervisorName}</span>
                    ) : (
                      <span className="text-amber-500 italic">Unassigned</span>
                    )}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Card 1: Total Check-ins and outs */}
          <motion.div
            whileHover={{ y: -5 }}
            onClick={() => { setActiveModal('checkins'); setExpandedDate(null); }}
            className="bg-white rounded-xl shadow p-6 cursor-pointer border border-transparent hover:border-blue-100 transition-colors"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                <FaUserClock className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Total Check-ins & Outs</p>
                <p className="text-lg font-bold text-gray-900 mt-1">
                  {statsLoading ? '...' : (attendanceStats?.totalCheckins || 0)}
                </p>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  {statsLoading ? '' : `Check-outs: ${attendanceStats?.totalCheckouts || 0}`}
                </p>
                <p className="text-[10px] text-blue-600 mt-1 hover:underline">Click to view breakdown</p>
              </div>
            </div>
          </motion.div>

          {/* Card 2: Avg. Hours/Day */}
          <motion.div
            whileHover={{ y: -5 }}
            onClick={() => { setActiveModal('hours'); setExpandedDate(null); }}
            className="bg-white rounded-xl shadow p-6 cursor-pointer border border-transparent hover:border-green-100 transition-colors"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100 text-green-600">
                <FaCalendarAlt className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Avg. Hours/Day</p>
                <p className="text-lg font-bold text-gray-900 mt-1">
                  {statsLoading ? '...' : (attendanceStats?.averageHours || '0')}h
                </p>
                <p className="text-[10px] text-green-600 mt-1 hover:underline">Click to view breakdown</p>
              </div>
            </div>
          </motion.div>

          {/* Card 3: Geo Compliance */}
          <motion.div
            whileHover={{ y: -5 }}
            onClick={() => { setActiveModal('compliance'); setExpandedDate(null); }}
            className="bg-white rounded-xl shadow p-6 cursor-pointer border border-transparent hover:border-purple-100 transition-colors"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-purple-100 text-purple-600">
                <FaMapMarkerAlt className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Geo Compliance</p>
                <p className="text-lg font-bold text-gray-900 mt-1">
                  {statsLoading ? '...' : (attendanceStats?.geoFenceCompliance || '0')}%
                </p>
                <p className="text-[10px] text-purple-600 mt-1 hover:underline">Click to view compliance details</p>
              </div>
            </div>
          </motion.div>

          {/* Card 4: Late Arrivals */}
          <motion.div
            whileHover={{ y: -5 }}
            onClick={() => { setActiveModal('late'); setExpandedDate(null); }}
            className="bg-white rounded-xl shadow p-6 cursor-pointer border border-transparent hover:border-yellow-100 transition-colors"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-yellow-100 text-yellow-600">
                <FaChartBar className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Late Arrivals</p>
                <p className="text-lg font-bold text-gray-900 mt-1">
                  {statsLoading ? '...' : (attendanceStats?.lateArrivals ?? 'Unassigned')}
                </p>
                <p className="text-[10px] text-yellow-600 mt-1 hover:underline">Click to view lateness detail</p>
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
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <h2 className="text-xl font-bold text-gray-900">Weekly Attendance</h2>
                <div className="flex items-center gap-2">
                  <label htmlFor="week-select" className="text-xs font-semibold text-gray-500">Select Week:</label>
                  <select
                    id="week-select"
                    value={selectedWeekOffset}
                    onChange={(e) => setSelectedWeekOffset(Number(e.target.value))}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-gray-50 font-medium cursor-pointer"
                  >
                    <option value={0}>Week 0 (Current): {getWeekRangeString(0)}</option>
                    <option value={1}>Week -1: {getWeekRangeString(1)}</option>
                    <option value={2}>Week -2: {getWeekRangeString(2)}</option>
                    <option value={3}>Week -3: {getWeekRangeString(3)}</option>
                    <option value={4}>Week -4: {getWeekRangeString(4)}</option>
                  </select>
                </div>
              </div>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={attendanceChartData}
                    onClick={(state) => {
                      if (state && state.activePayload && state.activePayload.length > 0) {
                        const clickedData = state.activePayload[0].payload;
                        const dayName = clickedData.day;
                        const { monday } = getWeekBounds(selectedWeekOffset);
                        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                        const dayIndex = dayNames.indexOf(dayName);
                        if (dayIndex !== -1 && dayIndex !== 0) {
                          const targetDate = new Date(monday.getTime());
                          targetDate.setDate(monday.getDate() + (dayIndex - 1));
                          const targetDateStr = targetDate.toLocaleDateString();

                          const sessions = historyRecords.filter((record) => {
                            return new Date(record.check_in_time).toLocaleDateString() === targetDateStr;
                          });

                          setChartDayModal({
                            day: dayName,
                            date: targetDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
                            sessions: sessions
                          });
                        }
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: '#6b7280', fontSize: 12 }} unit="h" />
                    <Tooltip 
                      cursor={{ fill: '#f3f4f6', opacity: 0.5 }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs shadow-lg font-medium">
                              <span className="block font-semibold">{data.day}</span>
                              <span>{data.hours.toFixed(2)} hours</span>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar 
                      dataKey="hours" 
                      fill="#3b82f6" 
                      radius={[4, 4, 0, 0]} 
                      className="cursor-pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-gray-400 mt-2 text-center">
                Tip: Click on any bar to view the session breakdown for that day.
              </p>
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
                {faceEnrolled ? (user?.role === 'admin' ? 'Update Face Profile' : 'Request Face Update') : 'Enroll Face Profile'}
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
              {faceEnrolled ? (user?.role === 'admin' ? 'Update Face Profile' : 'Request Face Profile Update') : 'Enroll Face Profile'}
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
                  user?.role === 'admin' ? (faceEnrolled ? 'Update Face' : 'Enroll Face') : 'Submit Request'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Helper calculation functions for interactive stats modals */}
      {(() => {
        const getGroupedCheckinsData = () => {
          const groups: Record<string, { checkins: string[]; checkouts: string[] }> = {};
          historyRecords.forEach((record) => {
            const dateStr = new Date(record.check_in_time).toLocaleDateString();
            if (!groups[dateStr]) {
              groups[dateStr] = { checkins: [], checkouts: [] };
            }
            groups[dateStr].checkins.push(new Date(record.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            if (record.check_out_time) {
              groups[dateStr].checkouts.push(new Date(record.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }
          });
          return groups;
        };

        const getDailyHoursBreakdown = () => {
          const startStr = myTiming?.work_start_time || '09:00:00';
          const endStr = myTiming?.work_end_time || '18:00:00';
          const hoursMap: Record<string, number> = {};
          historyRecords.forEach((record) => {
            const dateStr = new Date(record.check_in_time).toLocaleDateString();
            const hours = calculateOverlapHours(
              record.check_in_time,
              record.check_out_time,
              startStr,
              endStr
            );
            hoursMap[dateStr] = (hoursMap[dateStr] || 0) + hours;
          });
          return hoursMap;
        };

        const getGeoComplianceBreakdown = () => {
          const complianceMap: Record<string, { checkins: { distance: number | null; compliant: boolean }[]; checkouts: { distance: number | null; compliant: boolean }[] }> = {};
          historyRecords.forEach((record) => {
            const dateStr = new Date(record.check_in_time).toLocaleDateString();
            if (!complianceMap[dateStr]) {
              complianceMap[dateStr] = { checkins: [], checkouts: [] };
            }
            const inDist = record.distance_from_office;
            complianceMap[dateStr].checkins.push({
              distance: inDist,
              compliant: inDist !== null && inDist !== undefined && inDist <= 500
            });
            if (record.check_out_time) {
              const outDist = record.checkout_distance_from_office;
              complianceMap[dateStr].checkouts.push({
                distance: outDist,
                compliant: outDist !== null && outDist !== undefined && outDist <= 500
              });
            }
          });
          return complianceMap;
        };

        const getLateArrivalsBreakdown = () => {
          if (!myTiming?.has_assigned_timing) return [];
          const list: { date: string; checkInTime: string; shiftStart: string; minutesLate: number }[] = [];
          const startStr = myTiming.work_start_time;
          const [startH, startM] = startStr.split(':').map(Number);
          historyRecords.forEach((record) => {
            const checkInDate = new Date(record.check_in_time);
            const checkInHour = checkInDate.getHours();
            const checkInM = checkInDate.getMinutes();
            const checkInTimeInMins = checkInHour * 60 + checkInM;
            const shiftStartTimeInMins = startH * 60 + startM;
            if (checkInTimeInMins > shiftStartTimeInMins) {
              list.push({
                date: new Date(record.check_in_time).toLocaleDateString(),
                checkInTime: checkInDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                shiftStart: startStr.substring(0, 5),
                minutesLate: checkInTimeInMins - shiftStartTimeInMins
              });
            }
          });
          return list;
        };

        return (
          <AnimatePresence>
            {activeModal !== null && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop overlay */}
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setActiveModal(null)}
                  className="fixed inset-0 bg-black/60 backdrop-blur-sm"
                />
                
                {/* Modal Container */}
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden relative z-10 border border-gray-100"
                >
                  <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                    <h3 className="text-lg font-bold text-gray-900">
                      {activeModal === 'checkins' && 'Total Check-ins and Outs Details'}
                      {activeModal === 'hours' && 'Average Working Hours Breakdown'}
                      {activeModal === 'compliance' && 'Geo Compliance Details'}
                      {activeModal === 'late' && 'Late Arrivals History'}
                    </h3>
                    <button
                      onClick={() => setActiveModal(null)}
                      className="text-gray-400 hover:text-gray-600 rounded-lg p-1.5 hover:bg-gray-100 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="p-6 max-h-[60vh] overflow-y-auto">
                    {activeModal === 'checkins' && (
                      <div className="space-y-1">
                        {Object.keys(getGroupedCheckinsData()).length === 0 ? (
                          <p className="text-gray-500 text-center py-4">No records found.</p>
                        ) : (
                          Object.keys(getGroupedCheckinsData()).map((date) => {
                            const groupedData = getGroupedCheckinsData();
                            const isExpanded = expandedDate === date;
                            return (
                              <div key={date} className="border-b border-gray-100 last:border-0 py-2">
                                <div 
                                  onClick={() => setExpandedDate(isExpanded ? null : date)}
                                  className="flex justify-between items-center cursor-pointer hover:bg-gray-50 p-2.5 rounded-lg transition-colors"
                                >
                                  <span className="font-semibold text-gray-800">{date}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs font-medium text-gray-500">
                                      check in {groupedData[date].checkins.length} times, check out {groupedData[date].checkouts.length} times
                                    </span>
                                    <span className="text-gray-400 text-xs font-mono">{isExpanded ? '▲' : '▼'}</span>
                                  </div>
                                </div>
                                {isExpanded && (
                                  <div className="mt-2 pl-4 pr-2 py-2 bg-gray-50 rounded-lg space-y-2 text-sm text-gray-600 border border-gray-100">
                                    {groupedData[date].checkins.map((inTime, idx) => {
                                      const outTime = groupedData[date].checkouts[idx] || '—';
                                      return (
                                        <div key={idx} className="flex justify-between py-1 border-b border-gray-200/50 last:border-0">
                                          <span className="font-medium font-mono text-xs text-gray-700">#{idx + 1} Check-in: {inTime}</span>
                                          <span className="font-medium font-mono text-xs text-gray-700">Check-out: {outTime}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                    {activeModal === 'hours' && (
                      <div className="space-y-1">
                        {Object.keys(getDailyHoursBreakdown()).length === 0 ? (
                          <p className="text-gray-500 text-center py-4">No records found.</p>
                        ) : (
                          Object.keys(getDailyHoursBreakdown()).map((date) => {
                            const dailyHours = getDailyHoursBreakdown();
                            return (
                              <div key={date} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-0">
                                <span className="font-medium text-gray-700">{date}</span>
                                <span className="font-semibold text-gray-900 font-mono">{dailyHours[date].toFixed(2)} hrs</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                    {activeModal === 'compliance' && (
                      <div className="space-y-1">
                        {Object.keys(getGeoComplianceBreakdown()).length === 0 ? (
                          <p className="text-gray-500 text-center py-4">No records found.</p>
                        ) : (
                          Object.keys(getGeoComplianceBreakdown()).map((date) => {
                            const geoData = getGeoComplianceBreakdown();
                            const isExpanded = expandedDate === date;
                            const dayData = geoData[date];
                            const totalEvents = dayData.checkins.length + dayData.checkouts.length;
                            const compliantEvents = dayData.checkins.filter(c => c.compliant).length + dayData.checkouts.filter(c => c.compliant).length;
                            
                            return (
                              <div key={date} className="border-b border-gray-100 last:border-0 py-2">
                                <div 
                                  onClick={() => setExpandedDate(isExpanded ? null : date)}
                                  className="flex justify-between items-center cursor-pointer hover:bg-gray-50 p-2.5 rounded-lg transition-colors"
                                >
                                  <span className="font-semibold text-gray-800">{date}</span>
                                  <div className="flex items-center gap-3">
                                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${compliantEvents === totalEvents ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                      Compliance: {compliantEvents}/{totalEvents}
                                    </span>
                                    <span className="text-gray-400 text-xs font-mono">{isExpanded ? '▲' : '▼'}</span>
                                  </div>
                                </div>
                                {isExpanded && (
                                  <div className="mt-2 pl-4 pr-2 py-2 bg-gray-50 rounded-lg space-y-2 text-sm text-gray-600 border border-gray-100">
                                    {dayData.checkins.map((item, idx) => (
                                      <div key={`in-${idx}`} className="flex justify-between py-1 border-b border-gray-200/50 last:border-0">
                                        <span className="font-medium font-mono text-xs">#{idx + 1} Check-in</span>
                                        <span className={`font-semibold font-mono text-xs ${item.compliant ? 'text-green-600' : 'text-red-600'}`}>
                                          {item.distance !== null && item.distance !== undefined 
                                            ? `${item.distance >= 1000 ? `${(item.distance / 1000).toFixed(2)} km` : `${Math.round(item.distance)} m`} (${item.compliant ? 'Compliant' : 'Far (>500m)'})`
                                            : 'No Location captured'}
                                        </span>
                                      </div>
                                    ))}
                                    {dayData.checkouts.map((item, idx) => (
                                      <div key={`out-${idx}`} className="flex justify-between py-1 border-b border-gray-200/50 last:border-0">
                                        <span className="font-medium font-mono text-xs">#{idx + 1} Check-out</span>
                                        <span className={`font-semibold font-mono text-xs ${item.compliant ? 'text-green-600' : 'text-red-600'}`}>
                                          {item.distance !== null && item.distance !== undefined 
                                            ? `${item.distance >= 1000 ? `${(item.distance / 1000).toFixed(2)} km` : `${Math.round(item.distance)} m`} (${item.compliant ? 'Compliant' : 'Far (>500m)'})`
                                            : 'No Location captured'}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}

                    {activeModal === 'late' && (
                      <div>
                        <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600 mb-4">
                          <span className="font-medium">Assigned Shift Hours:</span>{' '}
                          {myTiming?.has_assigned_timing ? (
                            <span className="text-blue-600 font-semibold">{myTiming.work_start_time.substring(0, 5)} - {myTiming.work_end_time.substring(0, 5)}</span>
                          ) : (
                            <span className="text-amber-500 italic font-semibold">Unassigned (Using default 09:00 AM - 06:00 PM)</span>
                          )}
                        </div>

                        <div className="space-y-1">
                          {!myTiming?.has_assigned_timing ? (
                            <p className="text-amber-600 text-center py-4 font-semibold">Work Timing: Unassigned. No assigned work hours found.</p>
                          ) : getLateArrivalsBreakdown().length === 0 ? (
                            <p className="text-gray-500 text-center py-4">No late arrivals recorded!</p>
                          ) : (
                            getLateArrivalsBreakdown().map((item, idx) => {
                              const hoursLate = Math.floor(item.minutesLate / 60);
                              const minsLate = item.minutesLate % 60;
                              const lateStr = hoursLate > 0 
                                ? `${hoursLate} hr ${minsLate} mins` 
                                : `${minsLate} mins`;
                              return (
                                <div key={idx} className="flex justify-between items-center py-3 border-b border-gray-100 last:border-0">
                                  <div>
                                    <span className="font-semibold text-gray-800 block">{item.date}</span>
                                    <span className="text-xs text-gray-500 font-mono">Shift starts at {item.shiftStart} · Checked in at {item.checkInTime}</span>
                                  </div>
                                  <span className="text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-100">
                                    Late by {lateStr}
                                  </span>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                    <button
                      onClick={() => setActiveModal(null)}
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        );
      })()}

      {/* Weekly Chart Day Detail Modal */}
      <AnimatePresence>
        {chartDayModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setChartDayModal(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative z-10 border border-gray-100"
            >
              <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    {chartDayModal.day} ({chartDayModal.date}) Sessions
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Total of {chartDayModal.sessions.length} session(s)
                  </p>
                </div>
                <button
                  onClick={() => setChartDayModal(null)}
                  className="text-gray-400 hover:text-gray-600 rounded-lg p-1.5 hover:bg-gray-100 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 max-h-[50vh] overflow-y-auto space-y-3">
                {chartDayModal.sessions.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">No check-in records for this day.</p>
                ) : (
                  chartDayModal.sessions.map((session, idx) => {
                    const inTime = new Date(session.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const outTime = session.check_out_time 
                      ? new Date(session.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
                      : 'Active Session';
                    
                    let durationStr = '';
                    if (session.check_out_time) {
                      const diffMs = new Date(session.check_out_time).getTime() - new Date(session.check_in_time).getTime();
                      const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
                      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                      durationStr = diffHrs > 0 ? `${diffHrs}h ${diffMins}m` : `${diffMins}m`;
                    } else {
                      const isToday = new Date(session.check_in_time).toDateString() === new Date().toDateString();
                      if (isToday) {
                        const diffMs = Date.now() - new Date(session.check_in_time).getTime();
                        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
                        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
                        durationStr = `Active: ${diffHrs > 0 ? `${diffHrs}h ${diffMins}m` : `${diffMins}m`}`;
                      } else {
                        durationStr = 'Incomplete';
                      }
                    }

                    return (
                      <div key={idx} className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-semibold text-gray-800">Session #{idx + 1}</span>
                          <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                            session.check_out_time 
                              ? 'bg-green-50 text-green-700 border border-green-100' 
                              : 'bg-blue-50 text-blue-700 border border-blue-100'
                          }`}>
                            {durationStr}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs font-mono text-gray-600">
                          <div>
                            <span className="text-gray-400 block uppercase tracking-wider text-[10px]">Check In</span>
                            <span className="text-gray-800 font-semibold">{inTime}</span>
                          </div>
                          <div>
                            <span className="text-gray-400 block uppercase tracking-wider text-[10px]">Check Out</span>
                            <span className="text-gray-800 font-semibold">{outTime}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end">
                <button
                  onClick={() => setChartDayModal(null)}
                  className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DashboardPage;
