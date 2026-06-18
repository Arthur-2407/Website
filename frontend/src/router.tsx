import { lazy, Suspense } from 'react';
import type { ReactElement, ComponentType } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import MainLayout from '@components/layout/MainLayout';
import { ProtectedRoute } from '@components/ProtectedRoute';

// STABILIZATION: Safe lazy loading wrapper that catches ChunkLoadError / TypeErrors
// caused by browser trying to fetch deleted old hash files from the server after redeployments.
function safeLazy<T extends ComponentType<any>>(importFunc: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await importFunc();
    } catch (error) {
      console.error('Dynamic import failed, reloading page to fetch latest version...', error);
      const lastReload = sessionStorage.getItem('last_chunk_reload');
      const now = Date.now();
      if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
        sessionStorage.setItem('last_chunk_reload', String(now));
        window.location.reload();
      }
      throw error;
    }
  });
}

const LoginPage = safeLazy(() => import('@pages/LoginPage'));
const DashboardPage = safeLazy(() => import('@pages/DashboardPage'));
const AttendancePage = safeLazy(() => import('@pages/AttendancePage'));
const LeavePage = safeLazy(() => import('@pages/LeavePage'));
const ReportsPage = safeLazy(() => import('@pages/ReportsPage'));
const SupervisorDashboard = safeLazy(() => import('@pages/SupervisorDashboard'));
const SecurityDashboard = safeLazy(() => import('@pages/SecurityDashboard'));
const SystemStatusDashboard = safeLazy(() => import('@pages/SystemStatusDashboard'));
const AdminPage = safeLazy(() => import('@pages/AdminPage'));
const FaceLogin = safeLazy(() => import('@components/FaceLogin'));
const BootstrapSetupPage = safeLazy(() => import('@pages/BootstrapSetupPage'));
const RecoveryRequestPage = safeLazy(() => import('@pages/RecoveryRequestPage'));

const routeFallback = (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans">
    <div className="h-10 w-10 rounded-full border-4 border-blue-200 border-t-blue-600 animate-spin font-sans" />
  </div>
);

function withSuspense(element: ReactElement) {
  return <Suspense fallback={routeFallback}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: withSuspense(<LoginPage />),
  },
  {
    path: '/face-login',
    element: withSuspense(<FaceLogin />),
  },
  {
    path: '/setup/admin-face',
    element: withSuspense(<BootstrapSetupPage />),
  },
  {
    path: '/bootstrap',
    element: withSuspense(<BootstrapSetupPage />),
  },
  {
    path: '/admin-setup',
    element: withSuspense(<BootstrapSetupPage />),
  },
  {
    path: '/system-bootstrap',
    element: withSuspense(<BootstrapSetupPage />),
  },
  {
    path: '/recover-admin',
    element: withSuspense(<BootstrapSetupPage />),
  },
  {
    // Public — users with missing credentials can't authenticate to reach a protected route
    path: '/recovery-request',
    element: withSuspense(<RecoveryRequestPage />),
  },
  {
    path: '/',
    element: <ProtectedRoute element={<MainLayout />} />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: withSuspense(<DashboardPage />),
      },
      {
        path: 'attendance',
        element: withSuspense(<AttendancePage />),
      },
      {
        path: 'leave',
        element: withSuspense(<LeavePage />),
      },
      {
        path: 'reports',
        element: withSuspense(<ReportsPage />),
      },
      // SUPERVISOR-ONLY ROUTES
      {
        path: 'supervisor',
        element: <ProtectedRoute element={withSuspense(<SupervisorDashboard />)} requiredRole="supervisor" />,
      },
      // ADMIN-ONLY ROUTES
      {
        path: 'admin',
        element: <ProtectedRoute element={withSuspense(<AdminPage />)} requiredRole="admin" />,
      },
      {
        path: 'security',
        element: <ProtectedRoute element={withSuspense(<SecurityDashboard />)} requiredRole="admin" />,
      },
      {
        path: 'system-status',
        element: <ProtectedRoute element={withSuspense(<SystemStatusDashboard />)} requiredRole="admin" />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/login" replace />,
  },
]);
