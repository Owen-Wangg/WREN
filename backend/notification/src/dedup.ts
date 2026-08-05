/**
 * Notification deduplication.
 *
 * Dedup key = type + recipient + entity + time-window bucket.
 * The database enforces uniqueness via a partial unique index on `dedup_key`
 * WHERE state != 'dismissed'. INSERT ... ON CONFLICT DO NOTHING makes duplicate
 * triggers safe (REQ-NOTIF-DEDUP-01).
 */
import type { DedupStrategy } from './types.js';

/**
 * Build a deduplication key for a notification.
 *
 * Returns `null` if the type has deduplication disabled, meaning every event
 * creates an independent notification.
 */
export function buildDedupKey(
  typeSlug: string,
  recipientUserId: string,
  entityId: string,
  dedupStrategy: DedupStrategy,
  nowMs: number = Date.now(),
): string | null {
  if (!dedupStrategy.enabled) return null;

  const windowMs = (dedupStrategy.windowMinutes ?? 60) * 60_000;
  const windowBucket = Math.floor(nowMs / windowMs);

  return `${typeSlug}:${recipientUserId}:${entityId}:${windowBucket}`;
}
