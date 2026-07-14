/**
 * Application providers: React Query for server state, the shared API client,
 * Cognito-backed auth, current-role context, and the router shell. Kept
 * separate from `App` so tests can mount features with a fresh client.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { appConfig } from '@/config/env';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { apiClient } from '@/services';
import { ApiClientProvider } from '@/services/apiClient';

import { RoleProvider } from './RoleContext';
import { createQueryClient } from './queryClient';

/**
 * Bridges the authenticated user's primary role into `RoleContext` so shared
 * components (`<RoleGate>`) never hardcode a student-only assumption
 * (frontend steering §2). `null` while unauthenticated/unknown.
 */
function CurrentRoleBridge({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return <RoleProvider role={user?.roles[0] ?? null}>{children}</RoleProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  // One client per app instance (created lazily so tests get isolation).
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider value={apiClient}>
        <AuthProvider apiBaseUrl={appConfig.apiBaseUrl}>
          <CurrentRoleBridge>
            <BrowserRouter>{children}</BrowserRouter>
          </CurrentRoleBridge>
        </AuthProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
