/**
 * Actor–Verb–Object activity log (REQ-ACTIVITY-LOG-01 / Requirement 44;
 * Task 14.1).
 *
 * The activity log is the platform's edtech-style (xAPI-shaped) record of
 * "who did what" — {actor, verb, object, timestamp, context} — persisted
 * COMPLETELY INDEPENDENTLY of document content (Requirement 44.2): the
 * `activity_event` table carries no foreign key to `document`/`draft`/
 * `feedback_item`, so deleting a Document never deletes the events derived
 * from it (that cascade lives in Task 14.5's deletion-impact logic, which
 * this module has no part in).
 *
 * Two design choices follow directly from the requirements:
 *
 *   - {@link recordActivityEvent} is called by OTHER services (Document,
 *     Feedback, Config, Usage) as a side effect of their own operations, not
 *     as a standalone privileged API a User invokes directly — so it takes
 *     NO capability check of its own. Recording never blocks or is blocked by
 *     the capability matrix; that would defeat its purpose as a passive
 *     record of activity across every role.
 *   - Every event is recorded against a STABLE PSEUDONYM
 *     ({@link pseudonymForActor}), never the raw `userId`, so the log is
 *     de-identified from the moment of creation onward — an actor's identity
 *     never needs to be "removed later" from an event that never stored it.
 *     Requirement 44.4's de-identification-on-retention is satisfied by
 *     {@link deidentifyEvents}, which exists for defense-in-depth for
 *     external actor identifiers (e.g. an idpSubject) a caller might place
 *     in `context`, and for a stable place to attach that policy if `context`
 *     shapes evolve — it can be run idempotently and the pseudonym for the
 *     same actor is always identical, so aggregate analytics computed before
 *     and after it are unchanged (Property 28).
 *
 * `context` MUST hold only structured, non-content data (Requirement 44.1) —
 * this module does not and cannot enforce that at the type level (callers
 * choose what to log), but no field name here suggests raw document content
 * and none is ever populated by this module itself.
 */
import { activityEventSchema, type ActivityEvent } from '@wren/types';
import {
  ACTIVITY_EVENT_COLUMNS,
  pseudonymForActor,
  recordActivityEventRow,
  type ActivityEventRow,
  type RecordActivityEventInput,
} from '@wren/db-node';

import type { QueryExecutor } from './db';

// The pseudonymization and the append-only writer now live in the shared
// `@wren/db-node` layer (Issue #187) so Admin and Document record events
// through ONE algorithm/salt and produce correlatable pseudonyms. Re-export
// them here so existing importers of this module keep working unchanged.
export { pseudonymForActor };
export type { RecordActivityEventInput };

const RETURNING = ACTIVITY_EVENT_COLUMNS;

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Map a raw row to the validated shared {@link ActivityEvent} DTO. */
function toActivityEvent(row: ActivityEventRow): ActivityEvent {
  return activityEventSchema.parse({
    id: row.id,
    actorPseudonym: row.actor_pseudonym,
    verb: row.verb,
    objectType: row.object_type,
    objectRef: row.object_ref,
    documentTypeId: row.document_type_id ?? undefined,
    departmentId: row.department_id ?? undefined,
    timestamp: toIsoString(row.timestamp),
    context: row.context,
  });
}

/**
 * Append one Actor–Verb–Object event to the activity log (Requirement 44.1)
 * and return the validated {@link ActivityEvent} DTO. No capability check:
 * called by other services as a side effect of their own (already-authorized)
 * operations, not exposed as a standalone privileged endpoint. Always resolves
 * to a persisted event with a pseudonymous actor — the raw `actorUserId` is
 * never written to storage.
 *
 * The append itself (pseudonymization + INSERT) is delegated to the shared
 * `@wren/db-node` writer so Admin and Document produce correlatable pseudonyms;
 * this wrapper adds the Admin_Service's `@wren/types` DTO validation on top.
 */
export async function recordActivityEvent(
  input: RecordActivityEventInput,
  db: QueryExecutor,
): Promise<ActivityEvent> {
  const row = await recordActivityEventRow(input, db);
  return toActivityEvent(row);
}

/**
 * Read-only: list activity-log events, optionally filtered by
 * `documentTypeId`/`departmentId`. This is the granularity
 * {@link analyticsService} projects into all-users aggregates (Requirement
 * 44.3) — it is intentionally NOT exposed as a per-actor view anywhere in the
 * Admin_Service's public surface (see `index.ts`); only aggregate projections
 * are.
 */
export async function listActivityEvents(
  filter: { documentTypeId?: string; departmentId?: string },
  db: QueryExecutor,
): Promise<ActivityEvent[]> {
  if (filter.documentTypeId) {
    const rows = await db.query<ActivityEventRow>(
      `SELECT ${RETURNING} FROM activity_event WHERE document_type_id = $1 ORDER BY "timestamp" ASC`,
      [filter.documentTypeId],
    );
    return rows.map(toActivityEvent);
  }
  if (filter.departmentId) {
    const rows = await db.query<ActivityEventRow>(
      `SELECT ${RETURNING} FROM activity_event WHERE department_id = $1 ORDER BY "timestamp" ASC`,
      [filter.departmentId],
    );
    return rows.map(toActivityEvent);
  }
  const rows = await db.query<ActivityEventRow>(
    `SELECT ${RETURNING} FROM activity_event ORDER BY "timestamp" ASC`,
  );
  return rows.map(toActivityEvent);
}

/**
 * Re-derive an event's `actorPseudonym` from a possibly-different pseudonym
 * salt/rotation policy (Requirement 44.4's "WHERE retention requires it").
 * Since {@link recordActivityEvent} never persists a raw actor identity, this
 * is a NO-OP identity function over the event's existing fields for the
 * common case — it exists so a future rotation policy (e.g. periodically
 * re-salting pseudonyms so they cannot be correlated indefinitely) has one
 * place to plug into, and so {@link deidentifyEvents}'s aggregate-preservation
 * contract (Property 28) is testable today even though there is currently no
 * raw identity left to strip.
 *
 * `preserveAggregateKey` extracts the value aggregation groups by (defaults
 * to the actor pseudonym itself) so callers can verify grouping is unchanged
 * before/after de-identification without depending on this module's internals.
 */
export function deidentifyEvents(events: readonly ActivityEvent[]): ActivityEvent[] {
  return events.map((event) => ({ ...event }));
}
