/**
 * React Query hooks for admin services (Task 7)
 *
 * Handles CRUD for departments, document types, content types, metadata fields,
 * topics, and access state management.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import {
  createDocumentType,
  deleteDocumentType,
  listContentTypes,
  createContentType,
  deleteContentType,
  listMetadataFields,
  createMetadataField,
  deleteMetadataField,
  listTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  setDocumentTypeAccessState,
  listAccessRequests,
  approveAccessRequest,
  denyAccessRequest,
} from '@/services/api/departmentAdminApi';
import { useApiClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Document Type CRUD (Task 7.1) */
/* -------------------------------------------------------------------------- */

export function useCreateDocumentType(departmentId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      createDocumentType(client, departmentId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documentTypes(departmentId),
      });
    },
  });
}

export function useDeleteDocumentType() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentTypeId: string) => deleteDocumentType(client, documentTypeId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documentTypes(),
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Content Types (Task 7.2) */
/* -------------------------------------------------------------------------- */

export function useListContentTypes(documentTypeId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin', 'content-types', documentTypeId],
    queryFn: () => listContentTypes(client, documentTypeId),
    enabled: !!documentTypeId,
  });
}

export function useCreateContentType(documentTypeId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      createContentType(client, documentTypeId, { label: input.name, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'content-types', documentTypeId],
      });
    },
  });
}

export function useDeleteContentType(documentTypeId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (contentTypeId: string) =>
      deleteContentType(client, documentTypeId, contentTypeId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'content-types', documentTypeId],
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Metadata Fields (Task 7.2) */
/* -------------------------------------------------------------------------- */

export function useListMetadataFields(documentTypeId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin', 'metadata-fields', documentTypeId],
    queryFn: () => listMetadataFields(client, documentTypeId),
    enabled: !!documentTypeId,
  });
}

export function useCreateMetadataField(documentTypeId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      name: string;
      required: boolean;
      fieldType: 'text' | 'select' | 'multiselect' | 'date';
      options?: string[];
    }) => createMetadataField(client, documentTypeId, { label: input.name, required: input.required }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'metadata-fields', documentTypeId],
      });
    },
  });
}

export function useDeleteMetadataField(documentTypeId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (fieldId: string) =>
      deleteMetadataField(client, documentTypeId, fieldId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'metadata-fields', documentTypeId],
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Topics (Task 7.3) */
/* -------------------------------------------------------------------------- */

export function useListTopics(departmentId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin', 'topics', departmentId],
    queryFn: () => listTopics(client, departmentId),
    enabled: !!departmentId,
  });
}

export function useCreateTopic(departmentId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => createTopic(client, departmentId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'topics', departmentId],
      });
    },
  });
}

export function useUpdateTopic(departmentId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ topicId, name }: { topicId: string; name: string }) =>
      updateTopic(client, departmentId, topicId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'topics', departmentId],
      });
    },
  });
}

export function useDeleteTopic(departmentId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (topicId: string) => deleteTopic(client, departmentId, topicId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'topics', departmentId],
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Access State & Grants (Task 7.4) */
/* -------------------------------------------------------------------------- */

export function useSetDocumentTypeAccessState() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      documentTypeId,
      accessState,
    }: {
      documentTypeId: string;
      accessState: 'OPEN' | 'LOCKED';
    }) => setDocumentTypeAccessState(client, documentTypeId, accessState),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.documentTypes(),
      });
    },
  });
}

export function useListAccessRequests(departmentId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['admin', 'access-requests', departmentId],
    queryFn: () => listAccessRequests(client, departmentId),
    enabled: !!departmentId,
  });
}

export function useApproveAccessRequest(departmentId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requestId: string) =>
      approveAccessRequest(client, departmentId, requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'access-requests', departmentId],
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.accessGrants(),
      });
    },
  });
}

export function useDenyAccessRequest(departmentId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (requestId: string) =>
      denyAccessRequest(client, departmentId, requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'access-requests', departmentId],
      });
    },
  });
}
