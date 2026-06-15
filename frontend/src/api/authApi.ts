import api from '@services/api';
import { AxiosResponse } from 'axios';

export interface FaceLoginData {
  frames: string[];
  employeeId: string;
  password?: string;
  challengeType?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface FaceLoginResponse {
  success: boolean;
  authenticated: boolean;
  message: string;
  error?: string;
  tokens?: {
    accessToken: string;
    refreshToken: string;
  };
  employee?: {
    id: number;
    employeeId: string;
    firstName?: string;
    lastName?: string;
    email: string;
    role: string;
    department: string;
  };
  spoofDetected?: boolean;
  errors?: string[];
}

export interface RegisterFaceData {
  frames: string[];
  employeeId: string;
}

export interface RegisterFaceResponse {
  success: boolean;
  message: string;
  employeeId: string;
}

export interface RefreshTokenData {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  success: boolean;
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  employee: {
    id: number;
    employeeId: string;
    email: string;
    role: string;
    department: string;
  };
}

export interface BootstrapStatusResponse {
  success: boolean;
  bootstrapMode: boolean;
}

export interface BootstrapSetupData {
  password?: string;
  frames: string[];
  // Extended admin profile fields
  adminName?: string;
  adminEmail?: string;
  adminPhone?: string;
  adminAddress?: string;
  adminDesignation?: string;
  recoveryEmail?: string;
  recoveryPhone?: string;
}

export interface BootstrapSetupResponse {
  success: boolean;
  message: string;
  error?: string;
}

// Pre-login check — backend determines auth requirements without hardcoding role
export interface PreLoginCheckData {
  employeeId: string;
}

export interface PreLoginCheckResponse {
  success: boolean;
  exists: boolean;
  role: 'admin' | 'supervisor' | 'employee' | null;
  has_password: boolean;
  has_face: boolean;
  required_method: 'face_and_password' | 'password_or_face' | 'password';
  missing_credentials: string[];
  needs_recovery: boolean;
  account_locked: boolean;
  locked_until: string | null;
}

export interface AdminContactInfo {
  name: string;
  email: string;
  phone?: string;
  designation?: string;
  mailtoLink: string;
}

export const authApi = {
  faceLogin: async (data: FaceLoginData, signal?: AbortSignal): Promise<AxiosResponse<FaceLoginResponse>> => {
    const response = await api.post<FaceLoginResponse>('/auth/face-login', data, { signal });
    return response;
  },

  registerFace: async (data: RegisterFaceData): Promise<AxiosResponse<RegisterFaceResponse>> => {
    const response = await api.post<RegisterFaceResponse>('/auth/register-face', data);
    return response;
  },

  refreshToken: async (data: RefreshTokenData): Promise<AxiosResponse<RefreshTokenResponse>> => {
    const response = await api.post<RefreshTokenResponse>('/auth/refresh', data);
    return response;
  },

  logout: async (): Promise<AxiosResponse<{ success: boolean; message: string }>> => {
    const response = await api.post('/auth/logout');
    return response;
  },

  checkBootstrapStatus: async (recovery?: boolean): Promise<AxiosResponse<BootstrapStatusResponse>> => {
    const response = await api.get<BootstrapStatusResponse>(`/auth/bootstrap/status${recovery ? '?recovery=true' : ''}`);
    return response;
  },

  bootstrapSetup: async (data: BootstrapSetupData, recovery?: boolean): Promise<AxiosResponse<BootstrapSetupResponse>> => {
    const response = await api.post<BootstrapSetupResponse>(`/auth/bootstrap/setup${recovery ? '?recovery=true' : ''}`, data);
    return response;
  },

  initiateAdminRecovery: async (): Promise<AxiosResponse<{ success: boolean; message: string; recoveryEmailMasked: string; error?: string }>> => {
    return api.post('/auth/recovery/admin/initiate');
  },

  verifyAdminRecoveryOtp: async (otp: string): Promise<AxiosResponse<{ success: boolean; message: string; error?: string }>> => {
    return api.post('/auth/recovery/admin/verify-otp', { otp });
  },

  // WEBSITECHK_AUTH_CORE — No hardcoded role checks; backend determines auth method
  preLoginCheck: async (data: PreLoginCheckData): Promise<AxiosResponse<PreLoginCheckResponse>> => {
    const response = await api.post<PreLoginCheckResponse>('/auth/pre-login-check', data);
    return response;
  },

  // WEBSITECHK_ADMIN_CONTACT — Dynamic admin contact from database
  getAdminContactInfo: async (): Promise<AxiosResponse<AdminContactInfo>> => {
    const response = await api.get<AdminContactInfo>('/admin/contact-info');
    return response;
  },
};