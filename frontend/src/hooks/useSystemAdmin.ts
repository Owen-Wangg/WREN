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
  getModelConfig,
  updateModelConfig,
  getSystemPrompt,
  updateSystemPrompt,
  getAppName,
  updateAppName,
  getUsageLimits,
  setUsageLimit,
  createDepartment,
  listBedrockModels,
  checkUsageLimitExceeded,
  getCurrentUsage,
  logFeedbackGeneration,
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

/* -------------------------------------------------------------------------- */
/* Model Configuration Hooks (Task 6.3) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: get current Bedrock model configuration.
 */
export function useGetModelConfig() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['system-admin', 'model-config'],
    queryFn: () => getModelConfig(client),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Mutation hook: update Bedrock model configuration.
 */
export function useUpdateModelConfig() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (modelId: string) => updateModelConfig(client, modelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-admin', 'model-config'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* System Prompt Configuration Hooks (Task 6.3) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: get system-level prompt and scaffolding.
 */
export function useGetSystemPrompt() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['system-admin', 'system-prompt'],
    queryFn: () => getSystemPrompt(client),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mutation hook: update system-level prompt and scaffolding.
 */
export function useUpdateSystemPrompt() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      systemPrompt,
      scaffold,
    }: {
      systemPrompt: string;
      scaffold: string;
    }) => updateSystemPrompt(client, systemPrompt, scaffold),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-admin', 'system-prompt'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Application Settings Hooks (Task 6.3) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: get application name.
 */
export function useGetAppName() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['system-admin', 'app-name'],
    queryFn: () => getAppName(client),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Mutation hook: update application name.
 */
export function useUpdateAppName() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (appName: string) => updateAppName(client, appName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-admin', 'app-name'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Usage Limits Hooks (Task 6.3) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: get all usage limits (platform + per-DocumentType).
 */
export function useGetUsageLimits() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['system-admin', 'usage-limits'],
    queryFn: () => getUsageLimits(client),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mutation hook: set usage limit for platform or specific DocumentType.
 */
export function useSetUsageLimit() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      scope,
      limit,
      scopeId,
    }: {
      scope: 'platform' | 'documentType';
      limit: number;
      scopeId?: string;
    }) => setUsageLimit(client, scope, limit, scopeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-admin', 'usage-limits'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Department Creation Hooks (Task 7.1) */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: create a new Department (TechAdmin only).
 * Auto-called when appointing a DepartmentAdmin to a non-existent department.
 */
export function useCreateDepartment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => createDepartment(client, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.departments() });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Bedrock Models (Task 8 - Model Config) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: fetch available Bedrock models for dropdown selection.
 */
export function useListBedrockModels() {
  const client = useApiClient();
  return useQuery({
    queryKey: ['system-admin', 'bedrock-models'],
    queryFn: () => listBedrockModels(client),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/* -------------------------------------------------------------------------- */
/* Usage Limits & Enforcement (Task 8.1) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: check if usage limit would be exceeded for feedback generation.
 */
export function useCheckUsageLimitExceeded(documentTypeId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['usage', 'limit-check', documentTypeId],
    queryFn: () => checkUsageLimitExceeded(client, documentTypeId),
    enabled: !!documentTypeId,
  });
}

/**
 * Query hook: get current usage for a specific scope.
 */
export function useGetCurrentUsage(
  scope: 'platform' | 'documentType',
  scopeId?: string,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['usage', 'current', scope, scopeId],
    queryFn: () => getCurrentUsage(client, scope, scopeId),
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Mutation hook: log a feedback generation action for audit purposes.
 */
export function useLogFeedbackGeneration() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      documentTypeId: string;
      userId: string;
      scope: 'platform' | 'documentType';
      timestamp: string;
    }) => logFeedbackGeneration(client, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}
