/**
 * Notification API service — thin functions over the shared {@link HttpClient}.
 *
 * In-app notification inbox operations: fetch, transition state, bulk actions,
 * and unread count. All responses validated with Zod schemas at the boundary.
 */
import { z } from 'zod';
import type { HttpClient } from '@/services/apiClient';
import type {
  PaginatedInbox,
  InboxQueryOptions,
  BulkAction,
} from '../types/notification';

/* -------------------------------------------------------------------------- */
/* Response Schemas                                                            */
/* -------------------------------------------------------------------------- */

const notificationViewSchema = z.object({
  id: z.string(),
  typeSlug: z.string(),
  typeLabel: z.string(),
  renderedContent: z.string(),
  state: z.enum(['unread', 'read']),
  createdAt: z.string(),
  actionUrl: z
    .string()
    .regex(/^\//)
    .refine((value) => !value.startsWith('//'))
    .nullable(),
});

const paginatedInboxSchema = z.object({
  notifications: z.array(notificationViewSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().nonnegative(),
});

const unreadCountSchema = z.object({
  count: z.number().int().nonnegative(),
});

const bulkResultSchema = z.object({
  affected: z.number().int().nonnegative(),
});

/* -------------------------------------------------------------------------- */
/* API Functions                                                                */
/* -------------------------------------------------------------------------- */

/** Fetch the user's notification inbox (paginated). */
export async function getInbox(
  client: HttpClient,
  options: InboxQueryOptions = {},
): Promise<PaginatedInbox> {
  const params = new URLSearchParams();
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.stateFilter) params.set('stateFilter', options.stateFilter);

  const query = params.toString();
  const path = `/v1/notifications${query ? `?${query}` : ''}`;

  return client.request<PaginatedInbox>(path, {
    method: 'GET',
    schema: paginatedInboxSchema,
  });
}

/** Get the current unread notification count (for badge display). */
export async function getUnreadCount(client: HttpClient): Promise<number> {
  const result = await client.request<{ count: number }>('/v1/notifications/unread-count', {
    method: 'GET',
    schema: unreadCountSchema,
  });
  return result.count;
}

/** Transition a notification's state (mark as read or dismiss). */
export async function transitionState(
  client: HttpClient,
  notificationId: string,
  newState: 'read' | 'dismissed',
): Promise<void> {
  await client.request<unknown>(`/v1/notifications/${notificationId}`, {
    method: 'PATCH',
    body: { state: newState },
  });
}

/** Execute a bulk action on the user's notifications. */
export async function bulkAction(
  client: HttpClient,
  action: BulkAction,
): Promise<number> {
  const result = await client.request<{ affected: number }>('/v1/notifications/bulk', {
    method: 'POST',
    body: { action },
    schema: bulkResultSchema,
  });
  return result.affected;
}
