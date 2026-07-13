/**
 * The shared React Query client. Centralized so retry/stale defaults are
 * consistent across the app. `ApiError` transport/HTTP/validation failures are
 * surfaced to callers rather than silently retried into a broken state.
 */
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/services';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Do not retry client/validation errors; only transient network faults.
          if (error instanceof ApiError && error.kind !== 'network') {
            return false;
          }
          return failureCount < 2;
        },
      },
    },
  });
}
