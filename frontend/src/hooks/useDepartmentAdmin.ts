/**
 * React Query hooks for department admin operations.
 *
 * Handles department-scoped operations (document types, users, access grants, analytics).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import {
  listDepartments,
  listDocumentTypes,
  getDocumentTypeConfig,
  updateDocumentTypeConfig,
  searchUsers,
  grantAccessToUser,
  revokeAccessGrant,
  getAnalytics,
  getHelpfulnessAnalytics,
  getImprovementTrends,
} from '@/services/api/departmentAdminApi';
import { useApiClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Query Hooks */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: list departments visible to the current user.
 */
export function useListDepartments() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.departments(),
    queryFn: () => listDepartments(client),
    staleTime: 60_000,
  });
}

/**
 * Query hook: list document types (optionally filtered by department).
 */
export function useListDocumentTypes(departmentId?: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.documentTypes(departmentId),
    queryFn: () => listDocumentTypes(client, departmentId),
    staleTime: 60_000,
  });
}

/**
 * Query hook: get document type configuration.
 */
export function useGetDocumentTypeConfig(documentTypeId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.documentTypeConfig(documentTypeId),
    queryFn: () => getDocumentTypeConfig(client, documentTypeId),
    staleTime: 60_000,
    enabled: !!documentTypeId,
  });
}

/**
 * Query hook: search users (scoped by role).
 */
export function useSearchUsers(query?: string, options?: { role?: string }) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.users(query),
    queryFn: () =>
      searchUsers(client, {
        q: query,
        role: options?.role,
      }),
    staleTime: 30_000,
    enabled: !!query,
  });
}

/**
 * Query hook: get analytics for department/document types.
 */
export function useGetAnalytics(documentTypeId?: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.departmentAnalytics(documentTypeId),
    queryFn: () => getAnalytics(client, documentTypeId),
    staleTime: 60_000,
  });
}

/**
 * Query hook: per-category improvement trends for a document type.
 */
export function useGetImprovementTrends(documentTypeId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.improvementTrends(documentTypeId),
    queryFn: () => getImprovementTrends(client, documentTypeId),
    staleTime: 60_000,
    enabled: !!documentTypeId,
  });
}

/**
 * Query hook: get helpfulness-rating analytics for a document type.
 */
export function useGetHelpfulnessAnalytics(documentTypeId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.helpfulnessAnalytics(documentTypeId),
    queryFn: () => getHelpfulnessAnalytics(client, documentTypeId),
    staleTime: 60_000,
    enabled: !!documentTypeId,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutation Hooks */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: update document type configuration.
 */
export function useUpdateDocumentTypeConfig() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentTypeId,
      updates,
    }: {
      documentTypeId: string;
      updates: {
        tone?: string | null;
        density?: string | null;
        promptText?: string | null;
        categoryPriority?: string[];
      };
    }) => updateDocumentTypeConfig(client, documentTypeId, updates),
    onSuccess: (_data, { documentTypeId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documentTypeConfig(documentTypeId),
      });
    },
  });
}

/**
 * Mutation hook: grant access to a user for a LOCKED document type.
 */
export function useGrantAccessToUser() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      userId,
      documentTypeId,
    }: {
      userId: string;
      documentTypeId: string;
    }) => grantAccessToUser(client, userId, documentTypeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accessGrants() });
    },
  });
}

/**
 * Mutation hook: revoke an access grant.
 */
export function useRevokeAccessGrant() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (grantId: string) => revokeAccessGrant(client, grantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accessGrants() });
    },
  });
}
