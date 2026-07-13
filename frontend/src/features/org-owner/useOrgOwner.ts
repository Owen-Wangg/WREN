/**
 * React Query hooks for the Org Owner business console (task 19.3;
 * Requirements 34.1, 34.2, 34.3, 34.4, 34.5).
 *
 * Follows the `useFieldExpert.ts` / `useDashboard.ts` pattern: keys come from
 * the shared `queryKeys` factory (never spelled inline), and every hook accepts
 * an optional {@link HttpClient} defaulting to the shared singleton so the
 * console can inject a `MockApiClient` in tests without touching global fixtures.
 *
 * Every query is scoped by an owned Organization id (Requirement 34.4). Every
 * mutation invalidates exactly the query key it affects so the surface stays in
 * sync after an edit.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addMember,
  assignFieldExpert,
  createContentType,
  createMetadataField,
  createTopic,
  createWritingType,
  fetchOrgAnalytics,
  fetchOrgContentTypes,
  fetchOrgMembers,
  fetchOrgMetadataFields,
  fetchOrgTopics,
  fetchOrgWritingTypes,
  fetchOwnedOrganizations,
} from './orgOwnerApi';

import type {
  AddMemberInput,
  AssignFieldExpertInput,
  ContentType,
  CreateContentTypeInput,
  CreateMetadataFieldInput,
  CreateTopicInput,
  CreateWritingTypeInput,
  MetadataFieldConfigDto,
  OrgAggregateAnalytics,
  OrgMember,
  Organization,
  Topic,
} from './orgOwnerTypes';
import type { WritingType } from '@wren/types';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient, type HttpClient } from '@/services';

/* -------------------------------------------------------------------------- */
/* Owned Organizations (Requirement 34.1)                                      */
/* -------------------------------------------------------------------------- */

export function useOwnedOrganizations(
  client: HttpClient = apiClient,
): UseQueryResult<Organization[]> {
  return useQuery({
    queryKey: queryKeys.orgOwnerOrganizations(),
    queryFn: () => fetchOwnedOrganizations(client),
  });
}

/* -------------------------------------------------------------------------- */
/* Writing Types within an owned Organization                                  */
/* -------------------------------------------------------------------------- */

export function useOrgWritingTypes(
  organizationId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<WritingType[]> {
  return useQuery({
    queryKey: queryKeys.orgOwnerWritingTypes(organizationId ?? ''),
    queryFn: () => fetchOrgWritingTypes(client, organizationId as string),
    enabled: Boolean(organizationId),
  });
}

export function useCreateWritingType(
  organizationId: string,
  client: HttpClient = apiClient,
): UseMutationResult<WritingType, unknown, CreateWritingTypeInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateWritingTypeInput) =>
      createWritingType(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgOwnerWritingTypes(organizationId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Content Types within an owned Organization                                  */
/* -------------------------------------------------------------------------- */

export function useOrgContentTypes(
  organizationId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<ContentType[]> {
  return useQuery({
    queryKey: queryKeys.orgOwnerContentTypes(organizationId ?? ''),
    queryFn: () => fetchOrgContentTypes(client, organizationId as string),
    enabled: Boolean(organizationId),
  });
}

export function useCreateContentType(
  organizationId: string,
  client: HttpClient = apiClient,
): UseMutationResult<ContentType, unknown, CreateContentTypeInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateContentTypeInput) =>
      createContentType(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgOwnerContentTypes(organizationId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Topics within an owned Organization                                         */
/* -------------------------------------------------------------------------- */

export function useOrgTopics(
  organizationId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<Topic[]> {
  return useQuery({
    queryKey: queryKeys.orgOwnerTopics(organizationId ?? ''),
    queryFn: () => fetchOrgTopics(client, organizationId as string),
    enabled: Boolean(organizationId),
  });
}

export function useCreateTopic(
  organizationId: string,
  client: HttpClient = apiClient,
): UseMutationResult<Topic, unknown, CreateTopicInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateTopicInput) => createTopic(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgOwnerTopics(organizationId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Metadata fields within an owned Organization                                */
/* -------------------------------------------------------------------------- */

export function useOrgMetadataFields(
  organizationId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<MetadataFieldConfigDto[]> {
  return useQuery({
    queryKey: queryKeys.orgOwnerMetadataFields(organizationId ?? ''),
    queryFn: () => fetchOrgMetadataFields(client, organizationId as string),
    enabled: Boolean(organizationId),
  });
}

export function useCreateMetadataField(
  organizationId: string,
  client: HttpClient = apiClient,
): UseMutationResult<MetadataFieldConfigDto, unknown, CreateMetadataFieldInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateMetadataFieldInput) =>
      createMetadataField(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgOwnerMetadataFields(organizationId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Members (Access Grants) within an owned Organization                        */
/* -------------------------------------------------------------------------- */

export function useOrgMembers(
  organizationId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<OrgMember[]> {
  return useQuery({
    queryKey: queryKeys.orgOwnerMembers(organizationId ?? ''),
    queryFn: () => fetchOrgMembers(client, organizationId as string),
    enabled: Boolean(organizationId),
  });
}

export function useAddMember(
  organizationId: string,
  client: HttpClient = apiClient,
): UseMutationResult<OrgMember, unknown, AddMemberInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: AddMemberInput) => addMember(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgOwnerMembers(organizationId),
      });
    },
  });
}

export function useAssignFieldExpert(
  organizationId: string,
  client: HttpClient = apiClient,
): UseMutationResult<OrgMember, unknown, AssignFieldExpertInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: AssignFieldExpertInput) =>
      assignFieldExpert(client, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.orgOwnerMembers(organizationId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Aggregate analytics for an owned Organization (Requirement 34.5)            */
/* -------------------------------------------------------------------------- */

export function useOrgAnalytics(
  organizationId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<OrgAggregateAnalytics> {
  return useQuery({
    queryKey: queryKeys.orgOwnerAnalytics(organizationId ?? ''),
    queryFn: () => fetchOrgAnalytics(client, organizationId as string),
    enabled: Boolean(organizationId),
  });
}
