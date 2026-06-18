import api from '@services/api';
import { AxiosResponse } from 'axios';

export interface CheckInData {
  location: {
    latitude: number;
    longitude: number;
  };
  imageData?: string;
}

export interface CheckOutData {
  location?: {
    latitude: number;
    longitude: number;
  };
  imageData?: string;
}

export interface AttendanceHistoryParams {
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  limit?: number;
  page?: number;
  scope?: string;
}

export interface EmployeeInfo {
  employee_id: string;
  first_name: string;
  last_name: string;
  department: string;
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
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
  notes: string | null;
  created_at: string;
  updated_at: string;
  employee: EmployeeInfo;
}

export interface AttendanceStats {
  totalCheckins: number;
  averageHours: string;
  geoFenceCompliance: string;
  lateArrivals: number;
}

export interface TodayAttendanceResponse {
  success: boolean;
  status: 'checked-in' | 'checked-out';
  currentRecord: AttendanceRecord | null;
  lastCheckIn: string | null;
}

export const attendanceApi = {
  checkIn: async (data: CheckInData): Promise<AxiosResponse<any>> => {
    const response = await api.post('/attendance/check-in', data);
    return response;
  },

  checkOut: async (data: CheckOutData): Promise<AxiosResponse<any>> => {
    const response = await api.post('/attendance/check-out', data);
    return response;
  },

  getToday: async (): Promise<AxiosResponse<TodayAttendanceResponse>> => {
    const response = await api.get('/attendance/today');
    return response;
  },

  getHistory: async (params: AttendanceHistoryParams): Promise<AxiosResponse<{ records: AttendanceRecord[]; totalCount: number }>> => {
    const response = await api.get('/attendance/history', { params });
    return response;
  },

  getStats: async (period: string = 'month'): Promise<AxiosResponse<AttendanceStats>> => {
    const response = await api.get(`/attendance/stats?period=${period}`);
    return response;
  },

  getMyTiming: async (): Promise<AxiosResponse<{ success: boolean; work_start_time: string; work_end_time: string; has_assigned_timing: boolean }>> => {
    const response = await api.get('/attendance/my-timing');
    return response;
  },
};
