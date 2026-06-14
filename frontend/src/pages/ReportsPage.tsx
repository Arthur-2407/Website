import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  FaChartBar, 
  FaChartLine, 
  FaChartPie,
  FaFilePdf,
  FaFileExcel
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
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { reportsApi } from '@api/reportsApi';
import { useNotification } from '@contexts/NotificationContext';

interface AttendanceStats {
  totalCheckins: number;
  averageHours: string;
  geoFenceCompliance: string;
  lateArrivals: number;
}

interface LeaveStats {
  totalRequests: number;
  approved: number;
  pending: number;
  rejected: number;
  vacationDaysUsed: number;
  sickDaysUsed: number;
}

interface WeeklyAttendanceData {
  week: string;
  hours: number;
  lateArrivals: number;
}

interface DepartmentData {
  department: string;
  employees: number;
  attendanceRate: number;
}

const ReportsPage: React.FC = () => {
  const { showError, showSuccess } = useNotification();
  
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStats | null>(null);
  const [leaveStats, setLeaveStats] = useState<LeaveStats | null>(null);
  const [weeklyData, setWeeklyData] = useState<WeeklyAttendanceData[]>([]);
  const [departmentData, setDepartmentData] = useState<DepartmentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState('month');

  // Fetch report data
  // STABILIZATION: Added AbortController for cleanup; removed showError from deps (stable ref)
  useEffect(() => {
    const abortController = new AbortController();

    const fetchData = async () => {
      try {
        setLoading(true);
        
        const response = await reportsApi.getReports(selectedPeriod);

        if (abortController.signal.aborted) return;

        setAttendanceStats(response.data.stats);
        setLeaveStats(response.data.leave);
        setWeeklyData(response.data.weekly || []);
        setDepartmentData(response.data.departments || []);
      } catch (error: any) {
        if (error?.name === 'CanceledError') return;
        console.error('Report data fetch error:', error);
        showError('Failed to load report data');
      } finally {
        if (!abortController.signal.aborted) setLoading(false);
      }
    };
    
    fetchData();

    return () => {
      abortController.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps — showError is stable
  }, [selectedPeriod]);

  // STABILIZATION: Loading timeout — auto-resolve after 15s
  useEffect(() => {
    const loadingTimeout = setTimeout(() => {
      setLoading(false);
    }, 15_000);
    return () => clearTimeout(loadingTimeout);
  }, [selectedPeriod]);

  // Handle export
  const handleExport = (format: string) => {
    showSuccess(`Exporting report as ${format.toUpperCase()}...`);
    // In a real implementation, this would generate and download the report
  };

  // Chart colors
  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Reports & Analytics</h1>
            <p className="text-gray-600 mt-1">Detailed insights and performance metrics</p>
          </div>
          <div className="flex space-x-3">
            <select
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-md"
            >
              <option value="week">Last Week</option>
              <option value="month">Last Month</option>
              <option value="quarter">Last Quarter</option>
              <option value="year">Last Year</option>
            </select>
            <div className="flex space-x-2">
              <button
                onClick={() => handleExport('pdf')}
                className="flex items-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                <FaFilePdf className="mr-2" />
                PDF
              </button>
              <button
                onClick={() => handleExport('excel')}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                <FaFileExcel className="mr-2" />
                Excel
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {loading && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            Loading report data...
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <motion.div
            whileHover={{ y: -5 }}
            className="bg-white rounded-xl shadow p-6"
          >
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                <FaChartBar className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Check-ins</p>
                <p className="text-2xl font-bold text-gray-900">
                  {attendanceStats?.totalCheckins || 0}
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
                <FaChartLine className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Avg. Hours/Day</p>
                <p className="text-2xl font-bold text-gray-900">
                  {attendanceStats?.averageHours || '0'}h
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
                <FaChartPie className="text-xl" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Geo Compliance</p>
                <p className="text-2xl font-bold text-gray-900">
                  {attendanceStats?.geoFenceCompliance || '0'}%
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
                  {attendanceStats?.lateArrivals || 0}
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Weekly Attendance Chart */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Weekly Attendance Hours</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="week" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="hours" name="Hours Worked" fill="#3b82f6" />
                    <Bar dataKey="lateArrivals" name="Late Arrivals" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Department Performance Chart */}
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Department Attendance Rates</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={departmentData}
                      cx="50%"
                      cy="50%"
                      labelLine={true}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="attendanceRate"
                      nameKey="department"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {departmentData.map((_entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value}%`, 'Attendance Rate']} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Leave Distribution Chart */}
            {leaveStats && (
              <div className="bg-white rounded-xl shadow p-6 lg:col-span-2">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Leave Request Distribution</h2>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={[
                        { name: 'Approved', value: leaveStats.approved },
                        { name: 'Pending', value: leaveStats.pending },
                        { name: 'Rejected', value: leaveStats.rejected },
                      ]}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="value" 
                        stroke="#3b82f6" 
                        activeDot={{ r: 8 }} 
                        name="Requests"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

        {/* Detailed Reports */}
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">Detailed Reports</h2>
            </div>
            
            <div className="divide-y divide-gray-200">
              <div className="px-6 py-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Attendance Summary Report</h3>
                  <p className="text-sm text-gray-500">Detailed attendance records and statistics</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="flex items-center px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
                  >
                    <FaFilePdf className="mr-1" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="flex items-center px-3 py-1 bg-green-100 text-green-700 rounded-md hover:bg-green-200"
                  >
                    <FaFileExcel className="mr-1" />
                    Excel
                  </button>
                </div>
              </div>
              
              <div className="px-6 py-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Leave Usage Report</h3>
                  <p className="text-sm text-gray-500">Comprehensive leave request and approval data</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="flex items-center px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
                  >
                    <FaFilePdf className="mr-1" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="flex items-center px-3 py-1 bg-green-100 text-green-700 rounded-md hover:bg-green-200"
                  >
                    <FaFileExcel className="mr-1" />
                    Excel
                  </button>
                </div>
              </div>
              
              <div className="px-6 py-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Security Incident Report</h3>
                  <p className="text-sm text-gray-500">Face recognition failures and security events</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="flex items-center px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
                  >
                    <FaFilePdf className="mr-1" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="flex items-center px-3 py-1 bg-green-100 text-green-700 rounded-md hover:bg-green-200"
                  >
                    <FaFileExcel className="mr-1" />
                    Excel
                  </button>
                </div>
              </div>
              
              <div className="px-6 py-4 flex justify-between items-center hover:bg-gray-50">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">Performance Analytics Report</h3>
                  <p className="text-sm text-gray-500">Employee performance metrics and trends</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => handleExport('pdf')}
                    className="flex items-center px-3 py-1 bg-red-100 text-red-700 rounded-md hover:bg-red-200"
                  >
                    <FaFilePdf className="mr-1" />
                    PDF
                  </button>
                  <button
                    onClick={() => handleExport('excel')}
                    className="flex items-center px-3 py-1 bg-green-100 text-green-700 rounded-md hover:bg-green-200"
                  >
                    <FaFileExcel className="mr-1" />
                    Excel
                  </button>
                </div>
              </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default ReportsPage;
