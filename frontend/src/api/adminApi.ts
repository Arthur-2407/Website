import api from '@services/api';
import { AxiosResponse } from 'axios';

export interface Employee {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number?: string;
  department: string;
  position: string;
  role: 'employee' | 'supervisor' | 'admin';
  supervisor_id?: number | null;
  hire_date: string;
  is_active: boolean;
  face_enrolled?: boolean;
  mfa_enabled?: boolean;
  created_at: string;
  updated_at: string;
  // Work location (from employee_locations table, if assigned)
  work_location_name?: string | null;
  work_location_lat?: number | null;
  work_location_lng?: number | null;
  work_location_radius?: number | null;
}

export interface EmployeeLocation {
  id: number;
  employee_id: number;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Row returned by the bulk /employees/locations endpoint
export interface EmployeeLocationRow {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  role: string;
  department: string;
  is_active: boolean;
  // null fields mean no location assigned
  location_id: number | null;
  location_name: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  location_is_active: boolean | null;
  location_updated_at: string | null;
}


export interface Supervisor extends Employee {
  assigned_employees?: Employee[];
  active_employee_count?: number;
}

export interface HierarchyData {
  supervisors: Supervisor[];
  unassignedEmployees: Employee[];
  totalSupervisors: number;
  totalUnassignedEmployees: number;
  totalActiveEmployees: number;
}

export interface TeamMember extends Employee {
  checked_in_today: string | number;
  pending_leave_status?: string | null;
}

export interface CreateEmployeeData {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  department: string;
  position: string;
  role: 'employee' | 'supervisor' | 'admin';
  supervisorId?: number | null;
  hireDate: string;
  password?: string;
}

export interface WorkTiming {
  id: number;
  employee_id?: number | null;
  employee_code?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  department?: string | null;
  work_start_time: string;
  work_end_time: string;
  lunch_start_time?: string | null;
  lunch_end_time?: string | null;
  overtime_start_time?: string | null;
  overtime_end_time?: string | null;
  is_active: boolean;
  is_temporary?: boolean;
  start_date?: string | null;
  end_date?: string | null;
}

export const adminApi = {
  // Employee management
  getEmployees: async (params?: {
    page?: number;
    limit?: number;
    department?: string;
    role?: string;
    isActive?: boolean;
  }): Promise<AxiosResponse<{ success: boolean; data: Employee[]; pagination: any }>> => {
    return api.get('/admin/employees', { params });
  },

  createEmployee: async (data: CreateEmployeeData): Promise<AxiosResponse<any>> => {
    return api.post('/admin/employees', data);
  },

  updateEmployee: async (id: number, data: Partial<CreateEmployeeData> & { isActive?: boolean }): Promise<AxiosResponse<any>> => {
    return api.put(`/admin/employees/${id}`, data);
  },

  deactivateEmployee: async (id: number): Promise<AxiosResponse<any>> => {
    return api.delete(`/admin/employees/${id}`);
  },

  // Hierarchy management
  getHierarchy: async (): Promise<AxiosResponse<{ success: boolean; data: HierarchyData }>> => {
    return api.get('/admin/hierarchy');
  },

  // Supervisor assignments
  assignEmployeesToSupervisor: async (supervisorId: string | number, employeeIds: number[]): Promise<AxiosResponse<{ success: boolean; assignedCount: number }>> => {
    return api.post(`/admin/supervisors/${supervisorId}/assign-employees`, { employeeIds });
  },

  getSupervisorEmployees: async (supervisorId: string | number): Promise<AxiosResponse<{ success: boolean; data: Employee[] }>> => {
    return api.get(`/admin/supervisors/${supervisorId}/employees`);
  },

  removeEmployeeFromSupervisor: async (supervisorId: string | number, employeeId: string | number): Promise<AxiosResponse<{ success: boolean }>> => {
    return api.delete(`/admin/supervisors/${supervisorId}/employees/${employeeId}`);
  },

  // Department management
  getDepartments: async (): Promise<AxiosResponse<{ success: boolean; data: any[] }>> => {
    return api.get('/admin/departments');
  },

  createDepartment: async (data: { departmentName: string; departmentHeadId?: number; maxEmployees?: number }): Promise<AxiosResponse<any>> => {
    return api.post('/admin/departments', data);
  },

  // Work timings
  getWorkTimings: async (): Promise<AxiosResponse<{ success: boolean; data: WorkTiming[] }>> => {
    return api.get('/admin/work-timings');
  },

  createWorkTiming: async (data: {
    employeeId?: number;
    department?: string;
    workStartTime: string;
    workEndTime: string;
    lunchStartTime?: string;
    lunchEndTime?: string;
    overtimeStartTime?: string;
    overtimeEndTime?: string;
    isTemporary?: boolean;
    startDate?: string | null;
    endDate?: string | null;
  }): Promise<AxiosResponse<any>> => {
    return api.post('/admin/work-timings', data);
  },

  deleteWorkTiming: async (id: number): Promise<AxiosResponse<any>> => {
    return api.delete(`/admin/work-timings/${id}`);
  },

  // Employee location management
  getEmployeeLocation: async (employeeId: number | string): Promise<AxiosResponse<{ success: boolean; data: EmployeeLocation | null }>> => {
    return api.get(`/admin/employees/${employeeId}/location`);
  },

  assignEmployeeLocation: async (
    employeeId: number | string,
    data: { name: string; latitude: number; longitude: number; radiusMeters: number }
  ): Promise<AxiosResponse<{ success: boolean; data: EmployeeLocation; message: string }>> => {
    return api.post(`/admin/employees/${employeeId}/location`, data);
  },

  removeEmployeeLocation: async (employeeId: number | string): Promise<AxiosResponse<{ success: boolean; message: string }>> => {
    return api.delete(`/admin/employees/${employeeId}/location`);
  },

  // Bulk fetch: all employees with their location status (real-time)
  getAllEmployeeLocations: async (): Promise<AxiosResponse<{ success: boolean; data: EmployeeLocationRow[] }>> => {
    return api.get('/admin/employees/locations');
  },


  // Supervisor team (for supervisor role)
  getMyTeam: async (): Promise<AxiosResponse<{ success: boolean; data: TeamMember[]; count: number }>> => {
    return api.get('/admin/supervisor/team');
  },

  getTeamMemberAttendance: async (employeeId: number, params?: { startDate?: string; endDate?: string; limit?: number }): Promise<AxiosResponse<any>> => {
    return api.get(`/admin/supervisor/team/${employeeId}/attendance`, { params });
  },

  resetEmployeeMfa: async (employeeId: string | number): Promise<AxiosResponse<{ success: boolean; message: string }>> => {
    return api.post(`/admin/employees/${employeeId}/mfa/reset`);
  },

  // Admin configuration & reset
  getConfiguration: async (): Promise<AxiosResponse<{ success: boolean; data: any }>> => {
    return api.get('/admin/configuration');
  },

  updateConfiguration: async (data: any): Promise<AxiosResponse<{ success: boolean; message: string }>> => {
    return api.post('/admin/configuration', data);
  },

  initiateAdminReset: async (data: { password?: string; frames?: string[] }): Promise<AxiosResponse<{ success: boolean; message: string; recoveryEmailMasked?: string }>> => {
    return api.post('/admin/reset/initiate', data);
  },

  verifyAdminResetOtp: async (data: { otp?: string }): Promise<AxiosResponse<{ success: boolean; message: string }>> => {
    return api.post('/admin/reset/verify-otp', data);
  },

  replaceAdmin: async (data: any): Promise<AxiosResponse<{ success: boolean; message: string }>> => {
    return api.post('/admin/reset/replace', data);
  },
};
