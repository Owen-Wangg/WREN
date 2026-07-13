/**
 * React Query hooks for audit & activity logging (Task 9)
 *
 * Activity log event emission
 * Aggregate-only analytics (no per-student data)
 * Document deletion with cascading cleanup
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import {
  emitActivityEvent,
  emitDocumentSubmitted,
  emitFeedbackGenerated,
  emitRoleAssigned,
  emitAccessGranted,
  emitConfigEdited,
  emitDocumentDeleted,
  listActivityLog,
  getDepartmentAggregateAnalytics,
  getPlatformAggregateAnalytics,
  deleteDocument,
} from '@/services/api/auditApi';
import { useApiClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Activity Event Emission (Task 9.1) */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: emit generic activity event.
 */
export function useEmitActivityEvent() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (input: {
      verb: string;
      object: string;
      objectType: string;
      metadata?: Record<string, unknown>;
    }) => emitActivityEvent(client, input),
  });
}

/**
 * Mutation hook: emit document submitted event.
 */
export function useEmitDocumentSubmitted() {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({
      documentId,
      metadata,
    }: {
      documentId: string;
      metadata?: Record<string, unknown>;
    }) => emitDocumentSubmitted(client, documentId, metadata),
  });
}

/**
 * Mutation hook: emit feedback generated event.
 */
export function useEmitFeedbackGenerated() {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({
      documentId,
      feedbackItemCount,
    }: {
      documentId: string;
      feedbackItemCount: number;
    }) => emitFeedbackGenerated(client, documentId, feedbackItemCount),
  });
}

/**
 * Mutation hook: emit role assigned event.
 */
export function useEmitRoleAssigned() {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      emitRoleAssigned(client, userId, role),
  });
}

/**
 * Mutation hook: emit access granted event.
 */
export function useEmitAccessGranted() {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({
      userId,
      documentTypeId,
    }: {
      userId: string;
      documentTypeId: string;
    }) => emitAccessGranted(client, userId, documentTypeId),
  });
}

/**
 * Mutation hook: emit config edited event.
 */
export function useEmitConfigEdited() {
  const client = useApiClient();
  return useMutation({
    mutationFn: ({
      documentTypeId,
      changes,
      guardrailOutcome,
    }: {
      documentTypeId: string;
      changes: Record<string, unknown>;
      guardrailOutcome?: string;
    }) => emitConfigEdited(client, documentTypeId, changes, guardrailOutcome),
  });
}

/**
 * Mutation hook: emit document deleted event.
 */
export function useEmitDocumentDeleted() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (documentId: string) => emitDocumentDeleted(client, documentId),
  });
}

/* -------------------------------------------------------------------------- */
/* Activity Log Retrieval (Task 9.2 - TechAdmin) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: list activity log events (platform-wide, TechAdmin only).
 * Returns actor-verb-object entries for system admin view.
 */
export function useListActivityLog(options?: {
  verb?: string;
  actor?: string;
  limit?: number;
  offset?: number;
}) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['audit', 'activity-log', JSON.stringify(options || {})],
    queryFn: () => listActivityLog(client, options),
    staleTime: 30_000, // 30 seconds
  });
}

/* -------------------------------------------------------------------------- */
/* Aggregate Analytics (Task 9.2) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: get department-scoped aggregate analytics (DeptAdmin view).
 * Shows aggregate data about student progress across feedback metrics.
 * NO per-student information.
 */
export function useDepartmentAggregateAnalytics(
  departmentId: string,
  documentTypeId?: string,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: [
      'analytics',
      'department-aggregates',
      departmentId,
      documentTypeId,
    ],
    queryFn: () =>
      getDepartmentAggregateAnalytics(client, departmentId, documentTypeId),
    enabled: !!departmentId,
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Query hook: get platform-wide aggregate analytics (TechAdmin view).
 * Shows aggregate data about platform usage and trends.
 * NO per-student information.
 */
export function usePlatformAggregateAnalytics(documentTypeId?: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: ['analytics', 'platform-aggregates', documentTypeId],
    queryFn: () => getPlatformAggregateAnalytics(client, documentTypeId),
    staleTime: 60_000, // 1 minute
  });
}

/* -------------------------------------------------------------------------- */
/* Document Deletion (Task 9.3) */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: delete a document with cascading cleanup.
 * Cascades: Drafts, Anchors, Feedback Items, resolution history.
 * Retains: Activity log events and aggregate counters.
 */
export function useDeleteDocument() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: string) => deleteDocument(client, documentId),
    onSuccess: (_, documentId) => {
      // Invalidate document queries
      queryClient.invalidateQueries({ queryKey: queryKeys.document(documentId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.documents() });

      // Emit deletion event (side effect)
      // Note: This would typically be done in the calling component
      // to ensure proper audit trail
    },
  });
}
