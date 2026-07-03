/**
 * AI Debrief API calls — thin wrappers over the shared {@link HttpClient}
 * (frontend steering §11: never bypass the shared API client wrapper).
 *
 * These are plain functions (not a class), consistent with how the rest of the
 * app is expected to call the client directly with a Zod schema at the
 * boundary (`src/services/apiClient.ts`). `recordFeedbackHelpfulness` is the
 * call site the design/steering describe as "emits an audit event" — the real
 * Audit_Service (task 14) is not built yet, so today this is a stubbed mock API
 * method with the eventual event shape already in place (Requirements 16.1–16.5).
 */
import { debriefSchema, feedbackHelpfulnessInputSchema, helpfulnessAckSchema } from './debriefTypes';

import type { Debrief, FeedbackHelpfulnessInput, HelpfulnessAck } from './debriefTypes';
import type { HttpClient } from '@/services';

export function debriefPath(environmentId: string): string {
  return `/documents/${environmentId}/debrief`;
}

export function regenerateDebriefPath(environmentId: string): string {
  return `/documents/${environmentId}/debrief/regenerate`;
}

export const FEEDBACK_HELPFULNESS_PATH = '/feedback-helpfulness';

/** Fetches the current AI Debrief for a writing environment (Requirement 16.1, 16.5). */
export function fetchDebrief(
  client: HttpClient,
  environmentId: string,
): Promise<Debrief> {
  return client.request(debriefPath(environmentId), { schema: debriefSchema });
}

/** Triggers an engine re-run and returns the freshly generated Debrief (Requirement 16.2). */
export function regenerateDebrief(
  client: HttpClient,
  environmentId: string,
): Promise<Debrief> {
  return client.request(regenerateDebriefPath(environmentId), {
    method: 'POST',
    schema: debriefSchema,
  });
}

/**
 * Records a helpfulness rating. Validated against
 * `feedbackHelpfulnessInputSchema` before it leaves this module, and the
 * response validated against `helpfulnessAckSchema` at the boundary — the same
 * pattern every other API call in this codebase follows.
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
