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

      {/* Authenticated student routes */}
      <Route element={<StudentLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/new" element={<NewDocumentPage />} />
        <Route path="/dashboard/document/:documentId" element={<DocumentEditorPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
    </Routes>
  );
}
