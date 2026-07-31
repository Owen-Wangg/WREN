import { z } from 'zod';

import { feedbackHelpfulnessInputSchema, helpfulnessAckSchema } from './debriefTypes';

import type { Debrief, FeedbackHelpfulnessInput, HelpfulnessAck } from './debriefTypes';
import type { HttpClient } from '@/services';

// Paths — all real /v1 routes
export function feedbackPath(documentId: string, draftId?: string): string {
  const base = `/v1/documents/${documentId}/feedback`;
  return draftId ? `${base}?draftId=${encodeURIComponent(draftId)}` : base;
}

export function feedbackHistoryPath(documentId: string): string {
  return `/v1/documents/${documentId}/feedback/history`;
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
    positiveNote: z.string().optional(),
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
  draftId: z.string().nullable().optional(),
});

const feedbackHistorySchema = z.object({
  versions: z.array(
    z.object({
      draftId: z.string(),
      draftVersion: z.number().int(),
      generatedAt: z.string(),
      itemCount: z.number().int(),
    }),
  ),
});

export type DebriefHistoryVersion = z.infer<typeof feedbackHistorySchema>['versions'][number];

/**
 * Fetches an AI Debrief for a document. Pass `draftId` to load a historical
 * generation; omit it to load the latest draft's feedback.
 */
export async function fetchDebrief(
  client: HttpClient,
  environmentId: string,
  draftId?: string,
): Promise<Debrief> {
  const raw = await client.request(feedbackPath(environmentId, draftId), {
    schema: feedbackResponseSchema,
  });

  // Prefer API draftId, then item sourceDraftId, then the requested draftId.
  const resolvedDraftId =
    raw.draftId ?? raw.items[0]?.sourceDraftId ?? draftId ?? 'none';

  // Prefer the newest item timestamp as "last generated".
  const generatedAt = raw.items
    .map((item) => item.createdAt)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort()
    .at(-1);

  return {
    documentId: environmentId,
    draftId: resolvedDraftId,
    generatedAt: generatedAt ?? new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: raw.items as any,
    progressSummary: raw.progressSummary ?? [],
    categoryNames: raw.categoryNames ?? {},
  };
}

/** Lists past AI Debrief generations for a document (newest first). */
export async function fetchDebriefHistory(
  client: HttpClient,
  environmentId: string,
): Promise<DebriefHistoryVersion[]> {
  const raw = await client.request(feedbackHistoryPath(environmentId), {
    schema: feedbackHistorySchema,
  });
  return raw.versions;
}

/**
 * Enqueues a new feedback generation job and returns immediately.
 * Completion is signaled via the AppSync subscription in useDebriefSubscription;
 * DocumentEditorPage's polling fallback handles the case where AppSync is
 * unavailable during the transition period.
 */
export async function regenerateDebrief(
  client: HttpClient,
  environmentId: string,
): Promise<void> {
  await client.request(feedbackPath(environmentId), {
    method: 'POST',
    schema: z.object({ jobId: z.string().optional(), status: z.string().optional() }).passthrough(),
  });
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
