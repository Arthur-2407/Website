import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  FaCalendarAlt, 
  FaMapMarkerAlt, 
  FaClock, 
  FaCheckCircle,
  FaTimesCircle,
  FaCamera
} from 'react-icons/fa';
import { attendanceApi } from '@api/attendanceApi';
import { useNotification } from '@contexts/NotificationContext';
import { locationService } from '@services/locationService';
import { stateReconciliationEngine } from '@services/reconciliationEngine';

interface AttendanceRecord {
  id: number;
  check_in_time: string;
  check_out_time: string | null;
  work_hours: string | null;
  location: {
    x: number;
    y: number;
  } | null;
  geo_fence_status: boolean;
  distance_from_office: number | null;
  checkout_geo_fence_status?: boolean | null;
  checkout_distance_from_office?: number | null;
  check_in_image_url: string | null;
  check_out_image_url: string | null;
  employee?: {
    employee_id: string;
    first_name: string;
    last_name: string;
  };
}

const AttendancePage: React.FC = () => {
  const { showError, showSuccess } = useNotification();
  
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [checkInStatus, setCheckInStatus] = useState<'checked-in' | 'checked-out' | 'loading'>('loading');
  const isLoading = checkInStatus === 'loading';
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  });

  // STABILIZATION: AbortController for proper fetch cleanup on unmount/re-fetch
  useEffect(() => {
    const abortController = new AbortController();

    const doFetchRecords = async () => {
      try {
        setLoading(true);
        const response = await attendanceApi.getHistory({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          scope: 'self',
        });
        if (!abortController.signal.aborted) {
          setRecords(response.data.records || []);
        }
      } catch (error: any) {
        if (error?.name === 'CanceledError') return;
        console.error('Attendance records fetch error:', error);
        showError('Failed to load attendance records');
      } finally {
        if (!abortController.signal.aborted) setLoading(false);
      }
    };

    doFetchRecords();
    return () => { abortController.abort(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  // STABILIZATION: Today's status fetch with AbortController
  useEffect(() => {
    const abortController = new AbortController();

    const doFetchToday = async () => {
      try {
        const response = await attendanceApi.getToday();
        if (!abortController.signal.aborted) {
          setCheckInStatus(response.data.status);
        }
      } catch (error: any) {
        if (error?.name === 'CanceledError') return;
        console.error('Today attendance fetch error:', error);
        if (!abortController.signal.aborted) setCheckInStatus('checked-out');
      }
    };

    doFetchToday();

    // STABILIZATION: Loading timeout safety — 15s max
    const loadingTimeout = setTimeout(() => {
      setCheckInStatus((prev) => prev === 'loading' ? 'checked-out' : prev);
    }, 15_000);

    return () => {
      abortController.abort();
      clearTimeout(loadingTimeout);
    };
  }, []);

  // Get user location
  useEffect(() => {
    const getLocation = async () => {
      try {
        const loc = await locationService.getCurrentPosition();
        setLocation({
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
      } catch (err) {
        console.error('Location error:', err);
      }
    };

    getLocation();
  }, []);

  // Handle check-in
  const handleCheckIn = async () => {
    // STATE RECONCILIATION: Acquire state mutation lock for 5s to gate background updates
    stateReconciliationEngine.acquireLock('attendance', 5000);

    // Capture checkpoint for optimistic UI rollback
    const previousCheckInStatus = checkInStatus;
    const previousRecords = [...records];
    
    try {
      setCheckInStatus('loading');
      
      // Fetch fresh, real-time coordinates on check-in button press
      const loc = await locationService.getCurrentPosition();
      const freshLocation = {
        latitude: loc.latitude,
        longitude: loc.longitude,
      };
      setLocation(freshLocation);

      const response = await attendanceApi.checkIn({ location: freshLocation });
      setCheckInStatus('checked-in');
      showSuccess('Successfully checked in!');
      setRecords((current) => [response.data.record, ...current]);
    } catch (error: any) {
      console.error('Check-in error, rolling back local state:', error);
      showError(error.response?.data?.error || 'Check-in failed. Please try again.');
      
      // Rollback to checkpoint state
      setCheckInStatus(previousCheckInStatus);
      setRecords(previousRecords);
    }
  };

  // Handle check-out
  const handleCheckOut = async () => {
    // STATE RECONCILIATION: Acquire state mutation lock for 5s to gate background updates
    stateReconciliationEngine.acquireLock('attendance', 5000);

    // Capture checkpoint for optimistic UI rollback
    const previousCheckInStatus = checkInStatus;
    const previousRecords = [...records];

    try {
      setCheckInStatus('loading');
      
      // Fetch fresh, real-time coordinates on check-out button press
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

      const response = await attendanceApi.checkOut({ location: freshLocation || undefined });
      setCheckInStatus('checked-out');
      showSuccess('Successfully checked out!');
      setRecords((current) =>
        current.map((record, index) =>
          record.id === response.data.record.id || index === 0 ? response.data.record : record
        )
      );
    } catch (error: any) {
      console.error('Check-out error, rolling back local state:', error);
      showError(error.response?.data?.error || 'Check-out failed. Please try again.');
      
      // Rollback to checkpoint state
      setCheckInStatus(previousCheckInStatus);
      setRecords(previousRecords);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">Attendance</h1>
          <p className="text-gray-600 mt-1">Track your work hours and attendance history</p>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Check-in Widget */}
        <div className="bg-white rounded-xl shadow p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Today's Attendance</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              <div className="flex items-center">
                <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                  <FaClock className="text-xl" />
                </div>
                <div className="ml-4">
                  <p className="text-sm font-medium text-gray-600">Current Status</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {checkInStatus === 'checked-in' 
                      ? 'Checked In' 
                      : checkInStatus === 'checked-out' 
                        ? 'Checked Out' 
                        : 'Not Checked In'}
                  </p>
                </div>
              </div>
              
              {location && (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <FaMapMarkerAlt className="text-gray-500 mr-2" />
                    <span className="text-sm text-gray-600">
                      Current Location: {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                    </span>
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-center">
              {checkInStatus === 'checked-out' ? (
                <button
                  onClick={handleCheckIn}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50"
                >
                  <FaCamera className="mr-2" />
                  Check In
                </button>
              ) : checkInStatus === 'checked-in' ? (
                <button
                  onClick={handleCheckOut}
                  disabled={isLoading}
                  className="w-full flex items-center justify-center px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50"
                >
                  <FaClock className="mr-2" />
                  Check Out
                </button>
              ) : (
                <button
                  disabled
                  className="w-full flex items-center justify-center px-6 py-3 bg-gray-300 text-gray-600 rounded-lg"
                >
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Date Range Filter */}
        <div className="bg-white rounded-xl shadow p-6 mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Filter Records</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="startDate" className="block text-sm font-medium text-gray-700 mb-1">
                Start Date
              </label>
              <input
                type="date"
                id="startDate"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({...dateRange, startDate: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="endDate" className="block text-sm font-medium text-gray-700 mb-1">
                End Date
              </label>
              <input
                type="date"
                id="endDate"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({...dateRange, endDate: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  // Reset to default range
                  setDateRange({
                    startDate: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
                    endDate: new Date().toISOString().split('T')[0],
                  });
                }}
                className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300"
              >
                Reset
              </button>
            </div>
          </div>
        </div>

        {/* Attendance Records Table */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">Attendance History</h2>
          </div>
          
          {loading ? (
            <div className="py-12 text-center">
              <svg className="animate-spin h-12 w-12 text-blue-500 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="mt-4 text-gray-600">Loading attendance records...</p>
            </div>
          ) : records.length === 0 ? (
            <div className="py-12 text-center">
              <FaCalendarAlt className="mx-auto text-4xl text-gray-300" />
              <p className="mt-4 text-gray-600">No attendance records found for the selected date range.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Check In
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Check Out
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Hours
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Location
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Distance
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {records.map((record) => (
                    <motion.tr 
                      key={record.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3 }}
                      className="hover:bg-gray-50"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(record.check_in_time).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(record.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {record.check_out_time 
                          ? new Date(record.check_out_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {record.work_hours || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-400 font-medium w-8">In:</span>
                            {record.geo_fence_status ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800">
                                <FaCheckCircle className="mr-1 text-[10px]" />
                                Within Fence
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800">
                                <FaTimesCircle className="mr-1 text-[10px]" />
                                Outside Fence
                              </span>
                            )}
                          </div>
                          {record.check_out_time && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400 font-medium w-8">Out:</span>
                              {record.checkout_geo_fence_status ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800">
                                  <FaCheckCircle className="mr-1 text-[10px]" />
                                  Within Fence
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800">
                                  <FaTimesCircle className="mr-1 text-[10px]" />
                                  Outside Fence
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-400 font-medium w-8">In:</span>
                            {record.distance_from_office !== null && record.distance_from_office !== undefined ? (
                              record.distance_from_office <= 1000 ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800">
                                  <FaCheckCircle className="mr-1 text-[10px]" />
                                  Check-in at location
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800">
                                  <FaTimesCircle className="mr-1 text-[10px]" />
                                  Far
                                </span>
                              )
                            ) : (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                          {record.check_out_time && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-gray-400 font-medium w-8">Out:</span>
                              {record.checkout_distance_from_office !== null && record.checkout_distance_from_office !== undefined ? (
                                record.checkout_distance_from_office <= 1000 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800">
                                    <FaCheckCircle className="mr-1 text-[10px]" />
                                    Check-out at location
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800">
                                    <FaTimesCircle className="mr-1 text-[10px]" />
                                    Far
                                  </span>
                                )
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-mono text-xs">
                        <div className="space-y-1">
                          <div>
                            <span className="text-gray-400 mr-1 inline-block w-8">In:</span>
                            {record.distance_from_office !== null && record.distance_from_office !== undefined ? (
                              record.distance_from_office >= 1000
                                ? `${(record.distance_from_office / 1000).toFixed(2)} km`
                                : `${Math.round(record.distance_from_office)} m`
                            ) : (
                              '—'
                            )}
                          </div>
                          {record.check_out_time && (
                            <div>
                              <span className="text-gray-400 mr-1 inline-block w-8">Out:</span>
                              {record.checkout_distance_from_office !== null && record.checkout_distance_from_office !== undefined ? (
                                record.checkout_distance_from_office >= 1000
                                  ? `${(record.checkout_distance_from_office / 1000).toFixed(2)} km`
                                  : `${Math.round(record.checkout_distance_from_office)} m`
                              ) : (
                                '—'
                              )}
                            </div>
                          )}
                        </div>
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

export default AttendancePage;
