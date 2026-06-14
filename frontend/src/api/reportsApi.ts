import api from '@services/api';
import { AxiosResponse } from 'axios';

export interface ReportStats {
  totalCheckins: number;
  averageHours: string;
  geoFenceCompliance: string;
  lateArrivals: number;
}

export interface ReportLeaveStats {
  totalRequests: number;
  approved: number;
  pending: number;
  rejected: number;
  vacationDaysUsed: number;
  sickDaysUsed: number;
  totalApprovedDays: number;
}

export interface WeeklyReportData {
  week: string;
  hours: number;
  lateArrivals: number;
}

export interface DepartmentReportData {
  department: string;
  employees: number;
  attendanceRate: number;
}

export interface ReportsResponse {
  success: boolean;
  period: {
    startDate: string;
    endDate: string;
  };
  stats: ReportStats;
  leave: ReportLeaveStats;
  weekly: WeeklyReportData[];
  departments: DepartmentReportData[];
}

export const reportsApi = {
  getReports: async (period: string = 'month'): Promise<AxiosResponse<ReportsResponse>> => {
    const response = await api.get<ReportsResponse>('/reports', { params: { period } });
    return response;
  },
};
