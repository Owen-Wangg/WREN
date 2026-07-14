/**
 * Audit & Activity Logging API - Task 9
 *
 * Activity log event emission (document submitted, feedback generated, roles changed, config edited)
 * Event persistence independent of document content
 * Aggregate counters computed from activity log
 */
import { z } from 'zod';
import type { HttpClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Activity Log Event Schemas */
/* -------------------------------------------------------------------------- */

const activityEventSchema = z.object({
  id: z.string(),
  actor: z.string(), // userId
  verb: z.enum([
    'submitted_document',
    'generated_feedback',
    'assigned_role',
    'granted_access',
    'revoked_access',
    'edited_config',
    'deleted_document',
  ]),
  object: z.string(), // documentId, userId, documentTypeId, etc
  objectType: z.enum(['document', 'user', 'documentType', 'config']),
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.string(),
});

const aggregateAnalyticsSchema = z.object({
  metric: z.string(), // e.g. "documents_submitted", "feedback_generated", "avg_revision_count"
  value: z.number(),
  trend: z.enum(['improving', 'stable', 'declining']).optional(),
  scope: z.enum(['platform', 'documentType', 'department']),
});

/* -------------------------------------------------------------------------- */
/* Activity Log Emission (Task 9.1) */
/* -------------------------------------------------------------------------- */

export async function emitActivityEvent(
  client: HttpClient,
  input: {
    verb: string;
    object: string;
    objectType: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ eventId: string }> {
  const schema = z.object({ eventId: z.string() });
  return client.request('/v1/audit/events', {
    method: 'POST',
    body: input,
    schema,
  });
}

/**
 * Emit document submission event.
 */
export async function emitDocumentSubmitted(
  client: HttpClient,
  documentId: string,
  metadata?: Record<string, unknown>,
): Promise<{ eventId: string }> {
  return emitActivityEvent(client, {
    verb: 'submitted_document',
    object: documentId,
    objectType: 'document',
    metadata,
  });
}

/**
 * Emit feedback generation event.
 */
export async function emitFeedbackGenerated(
  client: HttpClient,
  documentId: string,
  feedbackItemCount: number,
): Promise<{ eventId: string }> {
  return emitActivityEvent(client, {
    verb: 'generated_feedback',
    object: documentId,
    objectType: 'document',
    metadata: { feedbackItemCount },
  });
}

/**
 * Emit role assignment event.
 */
export async function emitRoleAssigned(
  client: HttpClient,
  userId: string,
  role: string,
): Promise<{ eventId: string }> {
  return emitActivityEvent(client, {
    verb: 'assigned_role',
    object: userId,
    objectType: 'user',
    metadata: { role },
  });
}

/**
 * Emit access grant event.
 */
export async function emitAccessGranted(
  client: HttpClient,
  userId: string,
  documentTypeId: string,
): Promise<{ eventId: string }> {
  return emitActivityEvent(client, {
    verb: 'granted_access',
    object: documentTypeId,
    objectType: 'documentType',
    metadata: { userId },
  });
}

/**
 * Emit config edit event with guardrail outcome.
 */
export async function emitConfigEdited(
  client: HttpClient,
  documentTypeId: string,
  changes: Record<string, unknown>,
  guardrailOutcome?: string,
): Promise<{ eventId: string }> {
  return emitActivityEvent(client, {
    verb: 'edited_config',
    object: documentTypeId,
    objectType: 'config',
    metadata: { changes, guardrailOutcome },
  });
}

/**
 * Emit document deletion event.
 */
export async function emitDocumentDeleted(
  client: HttpClient,
  documentId: string,
): Promise<{ eventId: string }> {
  return emitActivityEvent(client, {
    verb: 'deleted_document',
    object: documentId,
    objectType: 'document',
  });
}

/* -------------------------------------------------------------------------- */
/* Activity Log Retrieval (Task 9.2) */
/* -------------------------------------------------------------------------- */

/**
 * List activity log events (TechAdmin only, platform-wide).
 * Returns actor-verb-object entries for system admin view.
 */
export async function listActivityLog(
  client: HttpClient,
  options?: {
    verb?: string;
    actor?: string;
    limit?: number;
    offset?: number;
  },
): Promise<z.infer<typeof activityEventSchema>[]> {
  const params = new URLSearchParams();
  if (options?.verb) params.append('verb', options.verb);
  if (options?.actor) params.append('actor', options.actor);
  if (options?.limit) params.append('limit', String(options.limit));
  if (options?.offset) params.append('offset', String(options.offset));

  const queryString = params.toString();
  const path = queryString ? `/v1/audit/events?${queryString}` : '/v1/audit/events';

  return client.request(path, {
    schema: z.array(activityEventSchema),
  });
}

/* -------------------------------------------------------------------------- */
/* Analytics Aggregates (Task 9.2) */
/* -------------------------------------------------------------------------- */

/**
 * Get department-scoped aggregate analytics (DeptAdmin view).
 * Shows: documents submitted, feedback generated, avg revision count, trend data.
 * NO per-student information.
 */
export async function getDepartmentAggregateAnalytics(
  client: HttpClient,
  departmentId: string,
  documentTypeId?: string,
): Promise<z.infer<typeof aggregateAnalyticsSchema>[]> {
  const params = documentTypeId ? `?documentTypeId=${documentTypeId}` : '';
  return client.request(
    `/v1/departments/${departmentId}/analytics/aggregates${params}`,
    { schema: z.array(aggregateAnalyticsSchema) },
  );
}

/**
 * Get platform-wide aggregate analytics (TechAdmin view).
 * Shows: total documents, feedback generated, platform usage, trend data.
 * NO per-student information.
 */
export async function getPlatformAggregateAnalytics(
  client: HttpClient,
  documentTypeId?: string,
): Promise<z.infer<typeof aggregateAnalyticsSchema>[]> {
  const params = documentTypeId ? `?documentTypeId=${documentTypeId}` : '';
  return client.request(
    `/v1/admin/analytics/aggregates${params}`,
    { schema: z.array(aggregateAnalyticsSchema) },
  );
}

/* -------------------------------------------------------------------------- */
/* Document Deletion (Task 9.3) */
/* -------------------------------------------------------------------------- */

/**
 * Delete a document with cascading cleanup.
 * Cascades: Drafts, Anchors, Feedback Items, resolution history.
 * Retains: Activity log events and aggregate counters.
 */
export async function deleteDocument(
  client: HttpClient,
  documentId: string,
): Promise<{ deleted: boolean }> {
  const schema = z.object({ deleted: z.boolean() });
  return client.request(`/v1/documents/${documentId}`, {
    method: 'DELETE',
    schema,
  });
}
