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
  progressSummary: z.object({}).passthrough(),
});

const feedbackStatusSchema = z.object({
  status: z.enum(['queued', 'processing', 'completed', 'failed']),
  jobId: z.string().optional(),
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
  return client.request(`${FEEDBACK_BASE_PATH}/${documentId}/feedback`, {
    schema: feedbackListSchema,
  });
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
 * Status values: queued, processing, completed, failed
 */
export async function getFeedbackStatus(
  client: HttpClient,
  documentId: string,
): Promise<{
  status: 'queued' | 'processing' | 'completed' | 'failed';
  jobId?: string;
}> {
  return client.request(`${FEEDBACK_BASE_PATH}/${documentId}/feedback/status`, {
    schema: feedbackStatusSchema,
  });
}
