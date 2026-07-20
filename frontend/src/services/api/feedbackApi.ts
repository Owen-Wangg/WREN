/**
 * Feedback API calls — thin functions over the shared {@link HttpClient}.
 *
 * Handles feedback retrieval and async feedback generation with polling support.
 * All responses validated with Zod schemas from @wren/types (frontend steering §7).
 */
import { z } from 'zod';
import {
  feedbackItemSchema,
  type FeedbackItem,
} from '@wren/types';
import type { HttpClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Path Constants */
/* -------------------------------------------------------------------------- */

const FEEDBACK_BASE_PATH = '/v1/documents';

/* -------------------------------------------------------------------------- */
/* Response Schemas */
/* -------------------------------------------------------------------------- */

const feedbackListSchema = z.object({
  items: z.array(feedbackItemSchema),
  anchors: z.array(z.unknown()).optional(),
  progressSummary: z.union([z.array(z.unknown()), z.object({}).passthrough()]).optional(),
});

const feedbackStatusSchema = z.object({
  status: z.enum(['pending', 'queued', 'processing', 'completed', 'failed']),
  itemCount: z.number().int().nonnegative().optional(),
  jobId: z.string().optional(),
  latestDraftId: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Feedback Retrieval */
/* -------------------------------------------------------------------------- */

/**
 * Get feedback items for the current draft of a document.
 */
export async function getFeedback(
  client: HttpClient,
  documentId: string,
): Promise<{
  items: FeedbackItem[];
  progressSummary: Record<string, unknown>;
}> {
  const result = await client.request(`${FEEDBACK_BASE_PATH}/${documentId}/feedback`, {
    schema: feedbackListSchema,
  });
  const progressSummary =
    result.progressSummary &&
    typeof result.progressSummary === 'object' &&
    !Array.isArray(result.progressSummary)
      ? (result.progressSummary as Record<string, unknown>)
      : {};
  return {
    items: result.items,
    progressSummary,
  };
}

/* -------------------------------------------------------------------------- */
/* Async Feedback Generation */
/* -------------------------------------------------------------------------- */

/**
 * Request feedback generation for a document (async — returns job ID).
 * Response status: 202 (Accepted) if successful.
 */
export async function requestFeedback(
  client: HttpClient,
  documentId: string,
): Promise<{
  jobId: string;
  status: 'queued' | 'processing';
}> {
  const responseSchema = z.object({
    jobId: z.string().min(1),
    status: z.enum(['queued', 'processing']),
  });

  return client.request(`${FEEDBACK_BASE_PATH}/${documentId}/feedback`, {
    method: 'POST',
    schema: responseSchema,
  });
}

/**
 * Poll feedback generation status for a document.
 * Status values: pending, queued, processing, completed, failed
 */
export async function getFeedbackStatus(
  client: HttpClient,
  documentId: string,
): Promise<{
  status: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
  itemCount?: number;
  jobId?: string;
  latestDraftId?: string;
}> {
  return client.request(`${FEEDBACK_BASE_PATH}/${documentId}/feedback/status`, {
    schema: feedbackStatusSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Usage Limit Checking (Task 8.1) */
/* -------------------------------------------------------------------------- */

/**
 * Check if feedback generation is allowed for a document.
 * Returns { allowed: boolean, reason?: string, scope: string }
 */
export async function checkCanGenerateFeedback(
  client: HttpClient,
  documentId: string,
): Promise<{
  allowed: boolean;
  reason?: string;
  scope?: 'platform' | 'documentType';
}> {
  const schema = z.object({
    allowed: z.boolean(),
    reason: z.string().optional(),
    scope: z.enum(['platform', 'documentType']).optional(),
  });

  return client.request(
    `${FEEDBACK_BASE_PATH}/${documentId}/feedback/can-generate`,
    { schema },
  );
}
