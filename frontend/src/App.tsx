import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { appConfig } from '@/config/env';
import { useAuth } from '@/features/auth/AuthContext';

import type { Role } from '@wren/types';

import {
  LandingPage,
  LoginPage,
  SignupPage,
  StudentLayout,
  DashboardPage,
  NewDocumentPage,
  DocumentEditorPage,
  GuidePage,
  NotificationsPage,
  ProfilePage,
  SystemAdminDashboard,
  SystemAdminLayout,
  DepartmentDetailPage,
  SystemAdminGuidePage,
  SystemAdminNotificationsPage,
  SystemAdminProfilePage,
  DepartmentAdminLayout,
  DepartmentAdminDashboard,
  DepartmentAdminGuidePage,
  DepartmentAdminNotificationsPage,
  DepartmentAdminProfilePage,
  DocumentTypeDetailPage,
} from '@/pages';

/**
 * Route guard. In live mode (`VITE_USE_LIVE_API`) it enforces Cognito auth and
 * an optional role allow-list, redirecting to `/login` when unauthenticated and
 * to `/` when the role is not permitted. In mock/local mode it never gates, so
 * `npm run dev` renders every screen against the mock without a login wall.
 */
function ProtectedRoute({ allow }: { allow?: readonly Role[] }) {
  const { isLoading, isAuthenticated, user, dbRoles } = useAuth();

  if (!appConfig.useLiveApi) {
    return <Outlet />;
  }
  if (isLoading) {
    return <div className="p-2xl text-body text-text-secondary">Loading…</div>;
  }
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }
  // Gate on assigned DB roles, not Profile "view as", so switching persona
  // while on an admin URL does not bounce to `/`.
  if (allow && !dbRoles.some((role) => allow.includes(role))) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

export function App() {
  useEffect(() => {
    document.title = appConfig.appName;
  }, []);

  return (
    <Routes>
      {/* Public / auth routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />

      {/* Authenticated student routes (any signed-in user) */}
      <Route element={<ProtectedRoute />}>
        {/* Document editor — full viewport, no layout shell */}
        <Route path="/dashboard/document/:documentId" element={<DocumentEditorPage />} />

        <Route element={<StudentLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/new" element={<NewDocumentPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      {/* System Admin routes (TechnicalAdmin only) */}
      <Route element={<ProtectedRoute allow={['TechnicalAdmin']} />}>
        <Route element={<SystemAdminLayout />}>
          <Route path="/system-admin" element={<SystemAdminDashboard />} />
          <Route path="/system-admin/department/:departmentId" element={<DepartmentDetailPage />} />
          <Route path="/system-admin/guide" element={<SystemAdminGuidePage />} />
          <Route path="/system-admin/notifications" element={<SystemAdminNotificationsPage />} />
          <Route path="/system-admin/profile" element={<SystemAdminProfilePage />} />
        </Route>
      </Route>

      {/* Department Admin routes (DepartmentAdmin; TechnicalAdmin may also administer) */}
      <Route element={<ProtectedRoute allow={['DepartmentAdmin', 'TechnicalAdmin']} />}>
        <Route element={<DepartmentAdminLayout />}>
          <Route path="/dept-admin" element={<DepartmentAdminDashboard />} />
          <Route path="/dept-admin/guide" element={<DepartmentAdminGuidePage />} />
          <Route path="/dept-admin/notifications" element={<DepartmentAdminNotificationsPage />} />
          <Route path="/dept-admin/profile" element={<DepartmentAdminProfilePage />} />
        </Route>
        <Route path="/dept-admin/document-type/:documentTypeId" element={<DocumentTypeDetailPage />} />
      </Route>
    </Routes>
  );
}
