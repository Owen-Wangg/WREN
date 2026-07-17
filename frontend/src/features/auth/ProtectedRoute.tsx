/**
 * Protected route component that enforces authentication and role-based access.
 *
 * Routes users to login if not authenticated, or shows access denied if insufficient role.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export interface ProtectedRouteProps {
  readonly children: React.ReactNode;
  readonly requiredRoles?: Array<'Student' | 'DepartmentAdmin' | 'TechnicalAdmin'>;
}

/**
 * ProtectedRoute checks authentication and role before rendering children.
 * Redirects to login if not authenticated, or shows access denied if role insufficient.
 */
export function ProtectedRoute({ children, requiredRoles }: ProtectedRouteProps) {
  const { isLoading, isAuthenticated, user } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRoles && user) {
    const hasRequiredRole = requiredRoles.some(role => user.roles.includes(role));
    if (!hasRequiredRole) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>Access Denied</h1>
          <p>You do not have permission to access this page.</p>
        </div>
      );
    }
  }

  return <>{children}</>;
}
