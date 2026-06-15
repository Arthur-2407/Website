/// <reference types="vite/client" />
import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { logger } from '@utils/logger';

function normalizeApiBaseUrl(value?: string) {
  const base = (value || '/api').replace(/\/+$/, '');
  return base.endsWith('/api') ? base : `${base}/api`;
}

const API_BASE_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);

// ────────────────────────────────────────────────────────────────
// RESILIENCE: Serialized token refresh latch — prevents multiple
// concurrent 401 responses from each triggering a fresh /auth/refresh call.
// ────────────────────────────────────────────────────────────────
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshSuccess(newToken: string) {
  refreshSubscribers.forEach(cb => cb(newToken));
  refreshSubscribers = [];
}

function onRefreshFailure() {
  refreshSubscribers = [];
}

// ────────────────────────────────────────────────────────────────
// RESILIENCE: Transient error detection for retry logic
// ────────────────────────────────────────────────────────────────
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

function isTransientError(error: AxiosError): boolean {
  if (!error.response) {
    // Network error / timeout — always retryable
    return error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK' || error.message === 'Network Error';
  }
  return RETRYABLE_STATUS.has(error.response.status);
}

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 30000, // 30s timeout — prevents timeout under concurrent cold-start load
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach auth token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('accessToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: 401 refresh + transient-error retry
api.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
      _retryCount?: number;
    };

    if (!originalRequest) return Promise.reject(error);

    // ── RESILIENCE: Retry transient errors with exponential backoff ──
    if (isTransientError(error) && (originalRequest._retryCount ?? 0) < 3) {
      originalRequest._retryCount = (originalRequest._retryCount ?? 0) + 1;

      // Respect Retry-After header if present (standard on 429/503)
      const retryAfterHeader = (error.response?.headers as Record<string, string>)?.['retry-after'];
      const backoffMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : Math.min(500 * Math.pow(2, originalRequest._retryCount - 1), 2000);

      await new Promise(resolve => setTimeout(resolve, backoffMs));
      return api(originalRequest);
    }

    // ── RESILIENCE: Serialized token refresh on 401 ──
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        // No refresh token — session is definitely expired
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Another request already triggered a refresh — queue this one
        return new Promise<AxiosResponse>((resolve) => {
          subscribeTokenRefresh((newToken) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
            }
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;

      try {
        const response = await api.post('/auth/refresh', { refreshToken });
        const { accessToken, refreshToken: newRefreshToken } = response.data.tokens;

        localStorage.setItem('accessToken', accessToken);
        if (newRefreshToken) {
          localStorage.setItem('refreshToken', newRefreshToken);
        }
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }

        onRefreshSuccess(accessToken);
        return api(originalRequest);
      } catch (refreshError) {
        onRefreshFailure();
        // Emit event so AuthContext / React can handle logout cleanly
        // (avoids hard page redirect which wipes all React state)
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Log the final failure with full context before rejecting
    logger.apiError({
      url:          originalRequest.url ?? 'unknown',
      method:       (originalRequest.method ?? 'unknown').toUpperCase(),
      status:       (error.response?.status as number | undefined),
      retryCount:   originalRequest._retryCount ?? 0,
      errorMessage: error.message,
      errorCode:    error.code,
    });

    return Promise.reject(error);
  }
);

export default api;
