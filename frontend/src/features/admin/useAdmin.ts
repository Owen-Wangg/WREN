/**
 * React Query hooks for the (System) Admin technical console (task 19.4;
 * Requirements 33.1–33.4, 41.1, 41.2).
 *
 * Follows the `useFieldExpert.ts` pattern: keys come from the shared
 * `queryKeys` factory, and every hook accepts an optional {@link HttpClient}
 * defaulting to the shared singleton so the console can inject a
 * `MockApiClient` in tests without touching global fixtures.
 *
 * Deliberate boundary (Requirement 33.5): NOTHING here models business Topics,
 * Content Types, or custom-metadata — those are Org-Owner concerns.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  assignOrgOwner,
  createOrganization,
  fetchAppSettings,
  fetchModelConfig,
  fetchOrganizations,
  fetchPlatformAnalytics,
  fetchSystemPromptConfig,
  fetchSystemUsers,
  fetchUsageLimits,
  removeOrganization,
  saveAppSettings,
  saveModelConfig,
  saveSystemPromptConfig,
  setOrganizationAccessState,
  updateUsageLimit,
} from './adminApi';

import type {
  AdminAck,
  AdminOrganization,
  AppSettings,
  AppSettingsInput,
  AssignOrgOwnerInput,
  CreateOrganizationInput,
  ModelConfig,
  ModelConfigInput,
  PlatformAnalytics,
  SetOrganizationAccessStateInput,
  SystemPromptConfig,
  SystemPromptConfigInput,
  SystemUser,
  UpdateUsageLimitInput,
  UsageLimitView,
} from './adminSchemas';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient, type HttpClient } from '@/services';

/* -------------------------------------------------------------------------- */
/* Model configuration (Requirement 33.1)                                      */
/* -------------------------------------------------------------------------- */

export function useModelConfig(
  client: HttpClient = apiClient,
): UseQueryResult<ModelConfig> {
  return useQuery({
    queryKey: queryKeys.adminModelConfig(),
    queryFn: () => fetchModelConfig(client),
  });
}

export function useSaveModelConfig(
  client: HttpClient = apiClient,
): UseMutationResult<ModelConfig, unknown, ModelConfigInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: ModelConfigInput) => saveModelConfig(client, values),
    onSuccess: (config) => {
      queryClient.setQueryData(queryKeys.adminModelConfig(), config);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* System prompt / guardrail configuration (Requirement 33.1)                  */
/* -------------------------------------------------------------------------- */

export function useSystemPromptConfig(
  client: HttpClient = apiClient,
): UseQueryResult<SystemPromptConfig> {
  return useQuery({
    queryKey: queryKeys.adminSystemPrompt(),
    queryFn: () => fetchSystemPromptConfig(client),
  });
}

export function useSaveSystemPromptConfig(
  client: HttpClient = apiClient,
): UseMutationResult<SystemPromptConfig, unknown, SystemPromptConfigInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: SystemPromptConfigInput) =>
      saveSystemPromptConfig(client, values),
    onSuccess: (config) => {
      queryClient.setQueryData(queryKeys.adminSystemPrompt(), config);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Application-level settings (Requirement 33.1)                               */
/* -------------------------------------------------------------------------- */

export function useAppSettings(
  client: HttpClient = apiClient,
): UseQueryResult<AppSettings> {
  return useQuery({
    queryKey: queryKeys.adminAppSettings(),
    queryFn: () => fetchAppSettings(client),
  });
}

export function useSaveAppSettings(
  client: HttpClient = apiClient,
): UseMutationResult<AppSettings, unknown, AppSettingsInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: AppSettingsInput) => saveAppSettings(client, values),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.adminAppSettings(), settings);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Organizations (Requirement 33.2)                                            */
/* -------------------------------------------------------------------------- */

export function useAdminOrganizations(
  client: HttpClient = apiClient,
): UseQueryResult<AdminOrganization[]> {
  return useQuery({
    queryKey: queryKeys.adminOrganizations(),
    queryFn: () => fetchOrganizations(client),
  });
}

export function useCreateOrganization(
  client: HttpClient = apiClient,
): UseMutationResult<AdminOrganization, unknown, CreateOrganizationInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateOrganizationInput) =>
      createOrganization(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.adminOrganizations(),
      });
    },
  });
}

export function useRemoveOrganization(
  client: HttpClient = apiClient,
): UseMutationResult<AdminAck, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (organizationId: string) =>
      removeOrganization(client, organizationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.adminOrganizations(),
      });
    },
  });
}

export function useSetOrganizationAccessState(
  client: HttpClient = apiClient,
): UseMutationResult<
  AdminOrganization,
  unknown,
  SetOrganizationAccessStateInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: SetOrganizationAccessStateInput) =>
      setOrganizationAccessState(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.adminOrganizations(),
      });
    },
  });
}

export function useAssignOrgOwner(
  client: HttpClient = apiClient,
): UseMutationResult<AdminOrganization, unknown, AssignOrgOwnerInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: AssignOrgOwnerInput) =>
      assignOrgOwner(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.adminOrganizations(),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* System-wide user/role view (Requirement 33.3)                               */
/* -------------------------------------------------------------------------- */

export function useSystemUsers(
  client: HttpClient = apiClient,
): UseQueryResult<SystemUser[]> {
  return useQuery({
    queryKey: queryKeys.adminUsers(),
    queryFn: () => fetchSystemUsers(client),
  });
}

/* -------------------------------------------------------------------------- */
/* Usage limits (Requirement 33.4)                                             */
/* -------------------------------------------------------------------------- */

export function useUsageLimits(
  client: HttpClient = apiClient,
): UseQueryResult<UsageLimitView[]> {
  return useQuery({
    queryKey: queryKeys.adminUsageLimits(),
    queryFn: () => fetchUsageLimits(client),
  });
}

export function useUpdateUsageLimit(
  client: HttpClient = apiClient,
): UseMutationResult<AdminAck, unknown, UpdateUsageLimitInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: UpdateUsageLimitInput) =>
      updateUsageLimit(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.adminUsageLimits(),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Platform / org aggregate analytics (Requirements 41.1, 41.2)                */
/* -------------------------------------------------------------------------- */

export function usePlatformAnalytics(
  writingTypeId?: string,
  client: HttpClient = apiClient,
): UseQueryResult<PlatformAnalytics> {
  return useQuery({
    queryKey: queryKeys.adminAnalytics(writingTypeId),
    queryFn: () => fetchPlatformAnalytics(client, writingTypeId),
  });
}
