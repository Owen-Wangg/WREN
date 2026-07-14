/**
 * Application providers: React Query for server state and the router shell.
 * Kept separate from `App` so tests can mount features with a fresh client.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';

import { apiClient } from '@/services';
import { ApiClientProvider } from '@/services/apiClient';

import { createQueryClient } from './queryClient';

export function AppProviders({ children }: { children: ReactNode }) {
  // One client per app instance (created lazily so tests get isolation).
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider value={apiClient}>
        <BrowserRouter>{children}</BrowserRouter>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
