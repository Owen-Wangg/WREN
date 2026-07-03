/**
 * React Query hooks for the Field Expert configuration surface (task 19.2;
 * Requirements 23.4, 24.1, 32.2, 40.1).
 *
 * Follows the `useDashboard.ts` / `useDebrief.ts` pattern: keys come from the
 * shared `queryKeys` factory (never spelled inline), and every hook accepts an
 * optional {@link HttpClient} defaulting to the shared singleton so the console
 * can inject a `MockApiClient` in tests without touching global fixtures.
 *
 * Each query is scoped by the active Writing Type id (Requirement 23.4). Every
 * mutation invalidates exactly the query key it affects so the surface stays in
 * sync after an edit — a rename, for example, invalidates the taxonomy so the
 * list re-renders with the new label while the category id is untouched
 * (Requirement 24.1).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addCategory,
  addReferenceMaterial,
  fetchAggregateAnalytics,
  fetchFieldExpertWritingTypes,
  fetchPromptConfig,
  fetchReferenceMaterials,
  fetchTaxonomy,
  removeCategory,
  removeReferenceMaterial,
  renameCategory,
  saveDomainPrompt,
} from './fieldExpertApi';

import type {
  AddCategoryValues,
  AddReferenceValues,
  AggregateAnalytics,
  DomainPromptFormValues,
  ErrorCategory,
  PromptConfig,
  ReferenceMaterial,
  RenameCategoryValues,
  Taxonomy,
} from './fieldExpertSchemas';
import type { WritingType } from '@wren/types';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/queryKeys';
import { apiClient, type HttpClient } from '@/services';

/** Arguments for a category rename — the id is preserved; only the label changes. */
export interface RenameCategoryArgs {
  readonly categoryId: string;
  readonly values: RenameCategoryValues;
}

/* -------------------------------------------------------------------------- */
/* Active-Writing-Type selection (Requirement 23.4)                            */
/* -------------------------------------------------------------------------- */

/** The Writing Types the current Field Expert is assigned to (may be several). */
export function useFieldExpertWritingTypes(
  client: HttpClient = apiClient,
): UseQueryResult<WritingType[]> {
  return useQuery({
    queryKey: queryKeys.fieldExpertWritingTypes(),
    queryFn: () => fetchFieldExpertWritingTypes(client),
  });
}

/* -------------------------------------------------------------------------- */
/* Taxonomy (Requirement 24.1)                                                 */
/* -------------------------------------------------------------------------- */

/** The active Writing Type's error taxonomy. Disabled until a type is selected. */
export function useTaxonomy(
  writingTypeId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<Taxonomy> {
  return useQuery({
    queryKey: queryKeys.fieldExpertTaxonomy(writingTypeId ?? ''),
    queryFn: () => fetchTaxonomy(client, writingTypeId as string),
    enabled: Boolean(writingTypeId),
  });
}

/** Adds a new error category, then invalidates the taxonomy for a refetch. */
export function useAddCategory(
  writingTypeId: string,
  client: HttpClient = apiClient,
): UseMutationResult<ErrorCategory, unknown, AddCategoryValues> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: AddCategoryValues) =>
      addCategory(client, writingTypeId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.fieldExpertTaxonomy(writingTypeId),
      });
    },
  });
}

/**
 * Renames a category (label-only; id preserved — Requirement 24.1), then
 * invalidates the taxonomy for a refetch.
 */
export function useRenameCategory(
  writingTypeId: string,
  client: HttpClient = apiClient,
): UseMutationResult<ErrorCategory, unknown, RenameCategoryArgs> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, values }: RenameCategoryArgs) =>
      renameCategory(client, writingTypeId, categoryId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.fieldExpertTaxonomy(writingTypeId),
      });
    },
  });
}

/** Removes a category, then invalidates the taxonomy for a refetch. */
export function useRemoveCategory(
  writingTypeId: string,
  client: HttpClient = apiClient,
): UseMutationResult<Taxonomy, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: string) =>
      removeCategory(client, writingTypeId, categoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.fieldExpertTaxonomy(writingTypeId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Prompt + convention config (Requirement 32.2)                               */
/* -------------------------------------------------------------------------- */

/** The active Writing Type's prompt config. Disabled until a type is selected. */
export function usePromptConfig(
  writingTypeId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<PromptConfig> {
  return useQuery({
    queryKey: queryKeys.fieldExpertPromptConfig(writingTypeId ?? ''),
    queryFn: () => fetchPromptConfig(client, writingTypeId as string),
    enabled: Boolean(writingTypeId),
  });
}

/** Saves the editable domain prompt, then invalidates the prompt config. */
export function useSaveDomainPrompt(
  writingTypeId: string,
  client: HttpClient = apiClient,
): UseMutationResult<PromptConfig, unknown, DomainPromptFormValues> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: DomainPromptFormValues) =>
      saveDomainPrompt(client, writingTypeId, values),
    onSuccess: (config) => {
      queryClient.setQueryData(
        queryKeys.fieldExpertPromptConfig(writingTypeId),
        config,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.fieldExpertPromptConfig(writingTypeId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Domain-scoped reference materials (Requirement 26)                          */
/* -------------------------------------------------------------------------- */

/** The active Writing Type's domain-scoped reference materials (tier 2). */
export function useReferenceMaterials(
  writingTypeId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<ReferenceMaterial[]> {
  return useQuery({
    queryKey: queryKeys.fieldExpertReferenceMaterials(writingTypeId ?? ''),
    queryFn: () => fetchReferenceMaterials(client, writingTypeId as string),
    enabled: Boolean(writingTypeId),
  });
}

/** Adds a reference material, then invalidates the reference list. */
export function useAddReferenceMaterial(
  writingTypeId: string,
  client: HttpClient = apiClient,
): UseMutationResult<ReferenceMaterial, unknown, AddReferenceValues> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: AddReferenceValues) =>
      addReferenceMaterial(client, writingTypeId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.fieldExpertReferenceMaterials(writingTypeId),
      });
    },
  });
}

/** Removes a reference material, then invalidates the reference list. */
export function useRemoveReferenceMaterial(
  writingTypeId: string,
  client: HttpClient = apiClient,
): UseMutationResult<ReferenceMaterial[], unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (referenceId: string) =>
      removeReferenceMaterial(client, writingTypeId, referenceId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.fieldExpertReferenceMaterials(writingTypeId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Aggregate, domain-scoped analytics (Requirement 40.1)                       */
/* -------------------------------------------------------------------------- */

/** All-users aggregate analytics for the active Writing Type (no per-user rows). */
export function useAggregateAnalytics(
  writingTypeId: string | undefined,
  client: HttpClient = apiClient,
): UseQueryResult<AggregateAnalytics> {
  return useQuery({
    queryKey: queryKeys.fieldExpertAggregateAnalytics(writingTypeId ?? ''),
    queryFn: () => fetchAggregateAnalytics(client, writingTypeId as string),
    enabled: Boolean(writingTypeId),
  });
}
