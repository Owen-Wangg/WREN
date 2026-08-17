import { z } from 'zod';

import {
  feedbackHelpfulnessInputSchema,
  helpfulnessAckSchema,
  sectionApplicabilityInputSchema,
  sectionApplicabilityVotesSchema,
} from './debriefTypes';

import type {
  Debrief,
  FeedbackHelpfulnessInput,
  HelpfulnessAck,
  SectionApplicabilityInput,
  SectionApplicabilityVotes,
} from './debriefTypes';
import type { HttpClient } from '@/services';

/** True when a draft id is safe to send to UUID-typed API params. */
export function isUsableDraftId(
  draftId: string | null | undefined,
): draftId is string {
  if (typeof draftId !== 'string') return false;
  const trimmed = draftId.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== 'none';
}

// Paths — all real /v1 routes
export function feedbackPath(documentId: string, draftId?: string): string {
  const base = `/v1/documents/${documentId}/feedback`;
  return isUsableDraftId(draftId)
    ? `${base}?draftId=${encodeURIComponent(draftId)}`
    : base;
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
export const FEEDBACK_SECTION_APPLICABILITY_PATH = '/v1/feedback-section-applicability';

const feedbackResponseSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    documentId: z.string().nullable().optional(),
    errorCategoryId: z.string(),
    kind: z.string(),
    questionText: z.string(),
    positiveNote: z.string().nullable().optional(),
    quotedText: z.string().nullable().optional(),
    currentAnchorId: z.string().nullable().optional(),
    citationReferenceId: z.string().nullable().optional(),
    sourceDraftId: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
  }).passthrough()),
  anchors: z.array(z.object({}).passthrough()).nullable().optional(),
  categoryNames: z.record(z.string(), z.string()).nullable().optional(),
  progressSummary: z.array(
    z.object({
      category: z.string(),
      tendency: z.enum(['improving', 'persistent', 'emerging']),
      description: z.string(),
    }),
  ).nullable().optional(),
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
  // 'none' is a local sentinel only — never send it as a UUID query param.
  const resolvedDraftId =
    raw.draftId ??
    raw.items[0]?.sourceDraftId ??
    (isUsableDraftId(draftId) ? draftId : 'none');

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

/** Records an applicable/not-applicable vote for one debrief section (upsert). */
export function recordSectionApplicability(
  client: HttpClient,
  input: SectionApplicabilityInput,
): Promise<HelpfulnessAck> {
  const body = sectionApplicabilityInputSchema.parse(input);
  return client.request(FEEDBACK_SECTION_APPLICABILITY_PATH, {
    method: 'POST',
    body,
    schema: helpfulnessAckSchema,
  });
}

/** Fetches all applicability votes for the given document + draft. */
export function fetchSectionApplicability(
  client: HttpClient,
  environmentId: string,
  draftId: string,
): Promise<SectionApplicabilityVotes> {
  const path = `${FEEDBACK_SECTION_APPLICABILITY_PATH}?environmentId=${encodeURIComponent(environmentId)}&draftId=${encodeURIComponent(draftId)}`;
  return client.request(path, { schema: sectionApplicabilityVotesSchema });
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
