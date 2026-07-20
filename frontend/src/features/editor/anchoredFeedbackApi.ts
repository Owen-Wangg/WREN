/**
 * Inline Feedback Item + Anchor fetching for the editor's comments layer
 * (task 18.2; Requirements 12.1, 12.2, 12.3, 12.4). Thin wrappers over the
 * shared {@link HttpClient} (frontend steering §11: never bypass the shared
 * API client wrapper), following the same plain-function pattern as
 * `features/debrief/debriefApi.ts`.
 */
import { z } from 'zod';

import { anchorSchema, feedbackItemSchema } from '@wren/types';

import type { Anchor, FeedbackItem } from '@wren/types';
import type { HttpClient } from '@/services';

const feedbackJobSchema = z.object({
  jobId: z.string().optional(),
  status: z.string().optional(),
}).passthrough();

/** Matches Feedback Lambda GET /v1/documents/{id}/feedback/status. */
const feedbackStatusSchema = z.object({
  status: z.enum(['pending', 'queued', 'processing', 'completed', 'failed']),
  itemCount: z.number().int().nonnegative().optional(),
  jobId: z.string().optional(),
  latestDraftId: z.string().optional(),
});

export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

const feedbackItemsResponseSchema = z.array(feedbackItemSchema);
const anchorsResponseSchema = z.array(anchorSchema);

export function feedbackItemsPath(environmentId: string): string {
  return `/documents/${environmentId}/feedback-items`;
}

export function anchorsPath(environmentId: string): string {
  return `/documents/${environmentId}/anchors`;
}

/** Fetches all Feedback Items (inline + structural) for a writing environment's current draft. */
export function fetchFeedbackItems(
  client: HttpClient,
  environmentId: string,
): Promise<FeedbackItem[]> {
  return client.request(feedbackItemsPath(environmentId), {
    schema: feedbackItemsResponseSchema,
  });
}

/** Fetches Anchors for a writing environment's current draft. */
export function fetchAnchors(
  client: HttpClient,
  environmentId: string,
): Promise<Anchor[]> {
  return client.request(anchorsPath(environmentId), { schema: anchorsResponseSchema });
}

/** Enqueues a feedback generation job for the document's latest draft. */
export function generateFeedback(
  client: HttpClient,
  documentId: string,
): Promise<z.infer<typeof feedbackJobSchema>> {
  return client.request(`/v1/documents/${documentId}/feedback`, {
    method: 'POST',
    schema: feedbackJobSchema,
  });
}

/** Polls the feedback generation status (`status` + optional `itemCount`). */
export function fetchFeedbackStatus(
  client: HttpClient,
  documentId: string,
): Promise<FeedbackStatus> {
  return client.request(`/v1/documents/${documentId}/feedback/status`, {
    schema: feedbackStatusSchema,
  });
}
