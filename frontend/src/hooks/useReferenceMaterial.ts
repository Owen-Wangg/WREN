/**
 * Reference Material React Query Hooks - Task 5.1
 *
 * Manages two-tier reference material:
 * - Tier 1: Department-wide materials
 * - Tier 2: Document-Type-scoped materials
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import {
  listDepartmentReferenceMaterial,
  createDepartmentReferenceMaterial,
  deleteDepartmentReferenceMaterial,
  listDocumentTypeReferenceMaterial,
  createDocumentTypeReferenceMaterial,
  deleteDocumentTypeReferenceMaterial,
} from '@/services/api/referenceMaterialApi';
import { useApiClient } from '@/services/apiClient';
import type { CreateReferenceMaterialInput } from '@wren/types';

/* -------------------------------------------------------------------------- */
/* Department-wide Reference Material */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: fetch all department-wide reference materials.
 */
export function useListDepartmentReferenceMaterial(departmentId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.departmentReferenceMaterial(departmentId),
    queryFn: () => listDepartmentReferenceMaterial(client, departmentId),
    enabled: !!departmentId,
  });
}

/**
 * Mutation hook: create a new department-wide reference material.
 */
export function useCreateDepartmentReferenceMaterial(departmentId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateReferenceMaterialInput) =>
      createDepartmentReferenceMaterial(client, departmentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.departmentReferenceMaterial(departmentId),
      });
    },
  });
}

/**
 * Mutation hook: delete a department-wide reference material.
 */
export function useDeleteDepartmentReferenceMaterial(departmentId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (referenceMaterialId: string) =>
      deleteDepartmentReferenceMaterial(client, departmentId, referenceMaterialId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.departmentReferenceMaterial(departmentId),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Document-Type-Scoped Reference Material */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: fetch all document-type-scoped reference materials.
 */
export function useListDocumentTypeReferenceMaterial(
  departmentId: string,
  documentTypeId: string,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.documentTypeReferenceMaterial(departmentId, documentTypeId),
    queryFn: () =>
      listDocumentTypeReferenceMaterial(client, departmentId, documentTypeId),
    enabled: !!departmentId && !!documentTypeId,
  });
}

/**
 * Mutation hook: create a new document-type-scoped reference material.
 */
export function useCreateDocumentTypeReferenceMaterial(
  departmentId: string,
  documentTypeId: string,
) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateReferenceMaterialInput) =>
      createDocumentTypeReferenceMaterial(client, departmentId, documentTypeId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documentTypeReferenceMaterial(departmentId, documentTypeId),
      });
      // Also invalidate department-wide materials in case they're merged in display
      queryClient.invalidateQueries({
        queryKey: queryKeys.departmentReferenceMaterial(departmentId),
      });
    },
  });
}

/**
 * Mutation hook: delete a document-type-scoped reference material.
 */
export function useDeleteDocumentTypeReferenceMaterial(
  departmentId: string,
  documentTypeId: string,
) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (referenceMaterialId: string) =>
      deleteDocumentTypeReferenceMaterial(
        client,
        departmentId,
        documentTypeId,
        referenceMaterialId,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documentTypeReferenceMaterial(departmentId, documentTypeId),
      });
    },
  });
}
