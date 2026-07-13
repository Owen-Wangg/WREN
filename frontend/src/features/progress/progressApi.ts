/**
 * Writer progress-summary API calls (task 18.4; Requirements 18.1, 18.3, 18.4).
 *
 * Thin functions over the shared {@link HttpClient} (frontend steering §11:
 * never bypass the shared API client wrapper), validating the response against
 * `writerProgressSummarySchema` at the boundary (steering §7) so a malformed —
 * or numeric-score-carrying — payload fails safely instead of reaching the
 * writer's screen.
 */
import { writerProgressSummarySchema } from './progressTypes';

import type { WriterProgressSummary } from './progressTypes';
import type { HttpClient } from '@/services';

export function progressSummaryPath(environmentId: string): string {
  return `/documents/${environmentId}/progress`;
}

/**
 * Fetches the qualitative progress summary for a writing environment's current
 * draft (Requirement 18.1). The summary is anchored to the draft version it
 * reflects (`draftId` / `reflectsDraftVersion`).
 */
export function fetchProgressSummary(
  client: HttpClient,
  environmentId: string,
): Promise<WriterProgressSummary> {
  return client.request(progressSummaryPath(environmentId), {
    schema: writerProgressSummarySchema,
  });
}
