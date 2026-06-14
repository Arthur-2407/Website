import { useState, useEffect, useContext, useRef, useCallback, createContext } from 'react';
import type { ReactNode } from 'react';
import { authApi, RefreshTokenResponse } from '@api/authApi';
import { AxiosResponse } from 'axios';
import { useAuthStore } from '@store/authStore';
import { websocketService } from '@services/websocketService';

export interface User {
  id: number;
  employeeId: string;
  email: string;
  role: string;
  department: string;
  firstName?: string;
  lastName?: string;
  faceEnrolled?: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isHydrating: boolean;
  login: (tokens: { accessToken: string; refreshToken: string }, userData: User) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isHydrating, setIsHydrating] = useState<boolean>(() => {
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');
    return !!(accessToken && refreshToken);
  });

  // RESILIENCE: Guard against concurrent refreshUser calls from both
  // the mount useEffect and the Axios 401 interceptor.
  const refreshingRef = useRef(false);

  // === ARCH BRIDGE: Zustand authStore sync ===
  // AuthContext is the single source of truth. These calls keep the Zustand
  // store (used by any component that imports useAuthStore directly) in sync.
  const syncToStore = useAuthStore((s) => s.setAuth);
  const clearStore = useAuthStore((s) => s.logout);
  const refreshStoreTokens = useAuthStore((s) => s.refreshTokens);

  useEffect(() => {
    const accessToken = localStorage.getItem('accessToken');
    const refreshToken = localStorage.getItem('refreshToken');

    if (accessToken && refreshToken) {
      void refreshUser().finally(() => {
        setIsHydrating(false);
      });
    } else {
      setIsHydrating(false);
    }
  }, []);

  // RESILIENCE: Listen for session-expired event from the API interceptor.
  // This fires when the refresh token has also expired, so we clean up
  // React state + Zustand + WebSocket without a hard page reload.
  useEffect(() => {
    const handleSessionExpired = () => {
      console.warn('[Auth] Session expired — logging out.');
      void logout();
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => window.removeEventListener('auth:session-expired', handleSessionExpired);
  // logout is stable (defined outside, but uses setState) — safe to omit from deps
  }, []);

  const login = (
    tokens: { accessToken: string; refreshToken: string },
    userData: User
  ) => {
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    setUser(userData);
    setIsAuthenticated(true);

    // ARCH BRIDGE #1: Mirror into Zustand store
    syncToStore(userData, tokens.accessToken, tokens.refreshToken);

    // ARCH BRIDGE #2: Connect WebSocket and join the correct rooms for this user's role.
    // connectAndJoin handles handshake timing and emits 'join' + 'join-supervisor' as needed.
    websocketService.connectAndJoin(tokens.accessToken, userData.employeeId, userData.role);

    // STABILIZATION: Schedule proactive token refresh at 80% of access token TTL.
    scheduleProactiveRefresh(tokens.accessToken);
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      setUser(null);
      setIsAuthenticated(false);

      // ARCH BRIDGE #1: Clear Zustand store on logout
      clearStore();

      // ARCH BRIDGE #2: Disconnect WebSocket on logout
      websocketService.disconnect();
    }
  };

  const refreshUser = async () => {
    // RESILIENCE: Guard against concurrent refresh calls
    if (refreshingRef.current) return;
    refreshingRef.current = true;

    try {
      const refreshToken = localStorage.getItem('refreshToken');

      if (refreshToken) {
        const response: AxiosResponse<RefreshTokenResponse> =
          await authApi.refreshToken({ refreshToken });

        const { accessToken, refreshToken: newRefreshToken } =
          response.data.tokens;
        const userData = response.data.employee;

        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', newRefreshToken);
        setUser(userData);
        setIsAuthenticated(true);

        // ARCH BRIDGE #1: Sync refreshed tokens into Zustand store
        refreshStoreTokens(accessToken, newRefreshToken);

        // ARCH BRIDGE #2: Re-connect WebSocket with fresh token if not already connected
        if (!websocketService.isConnected()) {
          websocketService.connectAndJoin(accessToken, userData.employeeId, userData.role);
        }
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      await logout();
    } finally {
      refreshingRef.current = false;
      setIsHydrating(false);
    }
  };

  // STABILIZATION: Proactive token refresh timer.
  // Decodes the JWT exp claim and schedules a refresh at 80% of the remaining TTL.
  // This prevents 401 errors from hitting the user and avoids the Axios retry path.
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // STABILIZATION: Ref for refreshUser to avoid stale closure in scheduleProactiveRefresh
  const refreshUserRef = useRef(refreshUser);
  refreshUserRef.current = refreshUser;

  const scheduleProactiveRefresh = useCallback((accessToken: string) => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    try {
      // Decode JWT payload (base64url) to extract exp
      const payloadBase64 = accessToken.split('.')[1];
      if (!payloadBase64) return;
      const payload = JSON.parse(atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/')));
      const expiresAt = payload.exp * 1000; // ms
      const now = Date.now();
      const ttl = expiresAt - now;

      if (ttl <= 0) {
        // Already expired — refresh immediately
        void refreshUserRef.current();
        return;
      }

      // Refresh at 80% of TTL
      const refreshDelay = Math.max(ttl * 0.8, 10_000); // minimum 10s
      console.log(`[Auth] Proactive refresh scheduled in ${Math.round(refreshDelay / 1000)}s`);

      refreshTimerRef.current = setTimeout(() => {
        console.log('[Auth] Proactive token refresh firing...');
        void refreshUserRef.current();
      }, refreshDelay);
    } catch (err) {
      // If JWT decode fails, fall back to 10-minute timer
      console.warn('[Auth] Could not decode JWT for proactive refresh, using 10m fallback.');
      refreshTimerRef.current = setTimeout(() => void refreshUserRef.current(), 10 * 60 * 1000);
    }
  }, []);

  // Cleanup proactive refresh timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  const value: AuthContextType = {
    user,
    isAuthenticated,
    isHydrating,
    login,
    logout,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};
