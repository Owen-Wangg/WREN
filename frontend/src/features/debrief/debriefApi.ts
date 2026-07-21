import { z } from 'zod';

import { feedbackHelpfulnessInputSchema, helpfulnessAckSchema } from './debriefTypes';

import type { Debrief, FeedbackHelpfulnessInput, HelpfulnessAck } from './debriefTypes';
import type { HttpClient } from '@/services';

// Paths — all real /v1 routes
export function feedbackPath(documentId: string): string {
  return `/v1/documents/${documentId}/feedback`;
}

/** @deprecated kept for any callers that reference the old name */
export function debriefPath(environmentId: string): string {
  return feedbackPath(environmentId);
}

export function regenerateDebriefPath(environmentId: string): string {
  return feedbackPath(environmentId);
}

export const FEEDBACK_HELPFULNESS_PATH = '/v1/feedback-helpfulness';

const feedbackResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    documentId: z.string().optional(),
    errorCategoryId: z.string(),
    kind: z.string(),
    questionText: z.string(),
    quotedText: z.string().optional(),
    currentAnchorId: z.string().optional(),
    citationReferenceId: z.string().optional(),
    sourceDraftId: z.string().optional(),
    createdAt: z.string().optional(),
  }).passthrough()),
  anchors: z.array(z.object({}).passthrough()).optional(),
  categoryNames: z.record(z.string(), z.string()).optional(),
  progressSummary: z.array(
    z.object({
      category: z.string(),
      tendency: z.enum(['improving', 'persistent', 'emerging']),
      description: z.string(),
    }),
  ).optional(),
});

/**
 * Fetches the current AI Debrief by reading feedback items from the real
 * backend endpoint and mapping them into the Debrief shape.
 */
export async function fetchDebrief(
  client: HttpClient,
  environmentId: string,
): Promise<Debrief> {
  const raw = await client.request(feedbackPath(environmentId), {
    schema: feedbackResponseSchema,
  });

  // Derive a synthetic draftId from the most-recent feedback item's sourceDraftId,
  // falling back to 'none' when there are no items yet.
  const draftId = raw.items[0]?.sourceDraftId ?? 'none';

  return {
    documentId: environmentId,
    draftId,
    generatedAt: raw.items[0]?.createdAt ?? new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: raw.items as any,
    progressSummary: raw.progressSummary ?? [],
    categoryNames: raw.categoryNames ?? {},
  };
}

/**
 * Triggers a new feedback generation job, waits briefly, then re-fetches.
 * The caller (useRegenerateDebrief) invalidates the cache on success.
 */
export async function regenerateDebrief(
  client: HttpClient,
  environmentId: string,
): Promise<Debrief> {
  // Enqueue a new generation job
  await client.request(feedbackPath(environmentId), {
    method: 'POST',
    schema: z.object({ jobId: z.string().optional(), status: z.string().optional() }).passthrough(),
  });

  // Poll until completed (max 60s)
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    await new Promise((r) => setTimeout(r, 2500));
    const status = await client.request(`/v1/documents/${environmentId}/feedback/status`, {
      schema: z.object({
        status: z.string(),
        itemCount: z.number().optional(),
      }).passthrough(),
    });
    if (status.status === 'completed' || (status.itemCount ?? 0) > 0) break;
    if (status.status === 'failed') throw new Error('Feedback generation failed');
  }

  return fetchDebrief(client, environmentId);
}

/**
 * Records a helpfulness rating.
 */
export function recordFeedbackHelpfulness(
  client: HttpClient,
  input: FeedbackHelpfulnessInput,
): Promise<HelpfulnessAck> {
  const body = feedbackHelpfulnessInputSchema.parse(input);
  return client.request(FEEDBACK_HELPFULNESS_PATH, {
    method: 'POST',
    body,
    schema: helpfulnessAckSchema,
  });
}
