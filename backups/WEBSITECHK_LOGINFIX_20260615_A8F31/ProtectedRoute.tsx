import React, { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';

interface ProtectedRouteProps {
  element: ReactElement;
  requiredRole?: 'admin' | 'supervisor' | 'employee';
  requiredRoles?: ('admin' | 'supervisor' | 'employee')[];
}

/**
 * ProtectedRoute Component
 * 
 * Guards routes by role-based access control
 * - Prevents unauthorized access to role-specific dashboards
 * - Redirects to login if not authenticated
 * - Redirects to dashboard if role insufficient
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  element,
  requiredRole,
  requiredRoles = []
}) => {
  const { user, isAuthenticated } = useAuth();

  // Check if user is authenticated
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // Build list of allowed roles
  const allowedRoles = requiredRole 
    ? [requiredRole, ...(requiredRole !== 'admin' ? ['admin'] : [])]
    : requiredRoles.length > 0
    ? [...requiredRoles, 'admin'] // Admins always have access
    : [];

  // Check if user has required role
  if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    console.warn(`[ProtectedRoute] Access denied. User role "${user.role}" not in ${allowedRoles.join(', ')}`);
    return <Navigate to="/dashboard" replace />;
  }

  return element;
};

/**
 * Role Hierarchy Helper
 * 
 * Determines if a user can access content for a specific role
 * Hierarchy: admin > supervisor > employee
 */
export function canAccessRole(userRole: string, requiredRole: string): boolean {
  const roleHierarchy: Record<string, number> = {
    employee: 1,
    supervisor: 2,
    admin: 3,
  };

  const userLevel = roleHierarchy[userRole] || 0;
  const requiredLevel = roleHierarchy[requiredRole] || 0;

  return userLevel >= requiredLevel;
}

/**
 * Check if user is supervisor or above
 */
export function isSupervisorOrAbove(role: string): boolean {
  return role === 'supervisor' || role === 'admin';
}

/**
 * Check if user is admin
 */
export function isAdmin(role: string): boolean {
  return role === 'admin';
}

/**
 * Check if user is employee only
 */
export function isEmployeeOnly(role: string): boolean {
  return role === 'employee';
}
