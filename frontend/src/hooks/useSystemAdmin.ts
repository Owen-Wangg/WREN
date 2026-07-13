/**
 * React Query hooks for system admin (TechnicalAdmin) operations.
 *
 * Handles platform-wide operations (user management, role assignment, overrides, analytics).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import {
  searchAllUsers,
  assignRole,
  grantUsageOverride,
  getUsageInfo,
  getAnalyticsPlatform,
} from '@/services/api/systemAdminApi';
import { useApiClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Query Hooks */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: search all users on the platform (TechAdmin only).
 */
export function useSearchAllUsers(query?: string, options?: { role?: string }) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.allUsers(query),
    queryFn: () =>
      searchAllUsers(client, {
        q: query,
        role: options?.role,
      }),
    staleTime: 30_000,
    enabled: !!query,
  });
}

/**
 * Query hook: get usage information (platform or scoped to document type).
 */
export function useGetUsageInfo(
  scope: 'platform' | 'documentType',
  scopeId?: string,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.usage(scope, scopeId),
    queryFn: () => getUsageInfo(client, scope, scopeId),
    staleTime: 60_000,
  });
}

/**
 * Query hook: get platform-wide analytics (TechAdmin only).
 */
export function useGetAnalyticsPlatform(documentTypeId?: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.platformAnalytics(documentTypeId),
    queryFn: () => getAnalyticsPlatform(client, documentTypeId),
    staleTime: 60_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutation Hooks */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: assign a role to a user (TechAdmin only).
 */
export function useAssignRole() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      role,
      administeredDepartmentIds,
    }: {
      userId: string;
      role: 'Student' | 'DepartmentAdmin' | 'TechnicalAdmin';
      administeredDepartmentIds?: string[];
    }) => assignRole(client, userId, role, administeredDepartmentIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.allUsers() });
    },
  });
}

/**
 * Mutation hook: grant a temporary usage override for a user.
 */
export function useGrantUsageOverride() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      documentTypeId,
      additionalActions,
      reason,
      expiresAt,
    }: {
      userId: string;
      documentTypeId: string;
      additionalActions: number;
      reason: string;
      expiresAt: string;
    }) =>
      grantUsageOverride(
        client,
        userId,
        documentTypeId,
        additionalActions,
        reason,
        expiresAt,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.usage('platform') });
    },
  });
}
