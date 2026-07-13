import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';

import { appConfig } from '@/config/env';

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

      {/* Document editor — full viewport, no layout shell */}
      <Route path="/dashboard/document/:documentId" element={<DocumentEditorPage />} />

      {/* Authenticated student routes */}
      <Route element={<StudentLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/new" element={<NewDocumentPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      {/* System Admin routes */}
      <Route element={<SystemAdminLayout />}>
        <Route path="/system-admin" element={<SystemAdminDashboard />} />
        <Route path="/system-admin/department/:departmentId" element={<DepartmentDetailPage />} />
        <Route path="/system-admin/guide" element={<SystemAdminGuidePage />} />
        <Route path="/system-admin/notifications" element={<SystemAdminNotificationsPage />} />
        <Route path="/system-admin/profile" element={<SystemAdminProfilePage />} />
      </Route>

      {/* Department Admin routes */}
      <Route element={<DepartmentAdminLayout />}>
        <Route path="/dept-admin" element={<DepartmentAdminDashboard />} />
        <Route path="/dept-admin/guide" element={<DepartmentAdminGuidePage />} />
        <Route path="/dept-admin/notifications" element={<DepartmentAdminNotificationsPage />} />
        <Route path="/dept-admin/profile" element={<DepartmentAdminProfilePage />} />
      </Route>

      {/* Document Type Detail routes */}
      <Route path="/dept-admin/document-type/:documentTypeId" element={<DocumentTypeDetailPage />} />
    </Routes>
  );
}
