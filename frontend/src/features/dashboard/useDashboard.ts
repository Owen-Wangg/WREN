/**
 * React Query hooks for the writer dashboard (task 19.1; frontend steering §6).
 *
 * Keys come from the shared `queryKeys` factory (never spelled inline) so
 * caches namespace by deployment environment and invalidation stays typo-proof.
 * Each hook accepts an optional {@link HttpClient} defaulting to the shared
 * singleton, so the container can inject a mock client in tests without
 * touching global fixtures.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchAccessGrants,
  fetchDocuments,
  fetchOrganizations,
  fetchWritingTypes,
  requestAccess,
} from './dashboardApi';

import type { AccessRequestAck, AccessRequestInput, OrganizationAccess } from './dashboardTypes';
import type { AccessGrant, Document, WritingType } from '@wren/types';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient, type HttpClient } from '@/services';

/** The current user's Documents ("My Documents"). */
export function useDocuments(
  client: HttpClient = apiClient,
): UseQueryResult<Document[]> {
  return useQuery({
    queryKey: queryKeys.documents(),
    queryFn: () => fetchDocuments(client),
  });
}

/** The Writing Type catalog the writer may self-select from. */
export function useWritingTypes(
  client: HttpClient = apiClient,
): UseQueryResult<WritingType[]> {
  return useQuery({
    queryKey: queryKeys.writingTypes(),
    queryFn: () => fetchWritingTypes(client),
  });
}

/** Organization access states (for resolving `INHERIT` Writing Types). */
export function useOrganizations(
  client: HttpClient = apiClient,
): UseQueryResult<OrganizationAccess[]> {
  return useQuery({
    queryKey: queryKeys.organizations(),
    queryFn: () => fetchOrganizations(client),
  });
}

/** The current user's Access Grants. */
export function useAccessGrants(
  client: HttpClient = apiClient,
): UseQueryResult<AccessGrant[]> {
  return useQuery({
    queryKey: queryKeys.accessGrants(),
    queryFn: () => fetchAccessGrants(client),
  });
}

/**
 * Requests access to a LOCKED Writing Type (Requirement 4.6). On success the
 * grants cache is invalidated so a newly-granted type flips to self-selectable
 * once the grant lands.
 */
export function useRequestAccess(
  client: HttpClient = apiClient,
): UseMutationResult<AccessRequestAck, unknown, AccessRequestInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AccessRequestInput) => requestAccess(client, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accessGrants() });
    },
  });
}
