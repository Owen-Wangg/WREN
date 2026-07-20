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

const feedbackListResponseSchema = z.object({
  items: z.array(feedbackItemSchema),
  anchors: z.array(anchorSchema).optional(),
  progressSummary: z.unknown().optional(),
});

export type DocumentFeedback = {
  items: FeedbackItem[];
  anchors: Anchor[];
};

export function feedbackPath(documentId: string): string {
  return `/v1/documents/${documentId}/feedback`;
}

/** Fetches Feedback Items + Anchors via GET /v1/documents/{id}/feedback. */
export async function fetchDocumentFeedback(
  client: HttpClient,
  documentId: string,
): Promise<DocumentFeedback> {
  const result = await client.request(feedbackPath(documentId), {
    schema: feedbackListResponseSchema,
  });
  return {
    items: result.items,
    anchors: result.anchors ?? [],
  };
}

/** Fetches Feedback Items for a document via GET /v1/documents/{id}/feedback. */
export async function fetchFeedbackItems(
  client: HttpClient,
  documentId: string,
): Promise<FeedbackItem[]> {
  const result = await fetchDocumentFeedback(client, documentId);
  return result.items;
}

/**
 * Fetches Anchors for a document from the GET feedback response
 * (`anchors` field) so the editor does not depend on a separate anchors route.
 */
export async function fetchAnchors(
  client: HttpClient,
  documentId: string,
): Promise<Anchor[]> {
  const result = await fetchDocumentFeedback(client, documentId);
  return result.anchors;
}

/** Enqueues a feedback generation job for the document's latest draft. */
export function generateFeedback(
  client: HttpClient,
  documentId: string,
): Promise<z.infer<typeof feedbackJobSchema>> {
  return client.request(feedbackPath(documentId), {
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
