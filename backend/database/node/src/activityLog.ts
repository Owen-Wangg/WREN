/**
 * Shared Actor–Verb–Object activity-log writer (Requirement 44; Issue #187).
 *
 * The activity log is the platform's edtech-style (xAPI-shaped) record of
 * "who did what" — {actor, verb, object, timestamp, context}. It lives here in
 * the shared `@wren/db-node` layer, rather than inside a single service, so
 * that EVERY service that performs a security-critical mutation (Admin,
 * Document, …) records events through ONE writer with ONE pseudonymization
 * algorithm and salt. That is what makes an actor's pseudonym correlatable
 * across services (an Admin config edit and a Document deletion by the same
 * user share the same `actor_pseudonym`).
 *
 * Design invariants carried over from the original Admin_Service implementation:
 *
 *   - Every event is recorded against a STABLE PSEUDONYM
 *     ({@link pseudonymForActor}), never the raw `userId`, so the log is
 *     de-identified from the moment of creation (Requirement 44.4).
 *   - The writer takes NO capability check of its own: it is called by other
 *     services as a side effect of their own (already-authorized) operations.
 *   - `context` MUST hold only structured, non-content data (Requirement 44.1);
 *     this module cannot enforce that at the type level (callers choose what to
 *     log) but never populates content itself.
 *
 * This module intentionally returns the RAW database row (snake_case columns)
 * rather than a validated `@wren/types` DTO, so the shared DB layer stays free
 * of a dependency on the domain-contract package. Callers that need the
 * validated {@link https://github.com/ | ActivityEvent} DTO (e.g. the
 * Admin_Service) map the row themselves.
 */
import { createHash } from 'crypto';

/**
 * Minimal parameterized data-access surface the writer needs. Both the
 * `@wren/db-node` `DataAccess` class and every service's local `QueryExecutor`
 * satisfy this structurally (`query<Row>(text, params)`), so the writer depends
 * on the shape, not a concrete class. Values are always sent as bind
 * parameters — never interpolated into SQL text.
 */
export interface ActivityLogQueryExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

/** Raw `activity_event` row (snake_case columns from PostgreSQL). */
export interface ActivityEventRow {
  readonly id: string;
  readonly actor_pseudonym: string;
  readonly verb: string;
  readonly object_type: string;
  readonly object_ref: string;
  readonly document_type_id: string | null;
  readonly department_id: string | null;
  readonly timestamp: string | Date;
  readonly context: Record<string, unknown>;
}

/** The `activity_event` column list shared by INSERT ... RETURNING and SELECT. */
export const ACTIVITY_EVENT_COLUMNS =
  'id, actor_pseudonym, verb, object_type, object_ref, document_type_id, department_id, "timestamp", context';

/** One Actor–Verb–Object activity to record. */
export interface RecordActivityEventInput {
  /** The acting User's app-database id; converted to a pseudonym, never stored raw. */
  readonly actorUserId: string;
  readonly verb: string;
  readonly objectType: string;
  readonly objectRef: string;
  /** Document Type scope, when the activity is Document-Type-scoped. */
  readonly documentTypeId?: string;
  /** Department scope, when the activity is Department-scoped. */
  readonly departmentId?: string;
  /** Structured context only — never raw document content (Requirement 44.1). */
  readonly context?: Record<string, unknown>;
  /** Defaults to `now()`; overridable so callers/tests can pin the timestamp. */
  readonly timestamp?: Date;
}

/**
 * A server-side secret that salts every pseudonym so it cannot be reversed to
 * a `userId` by an observer who only sees {@link pseudonymForActor}'s output.
 * It is NOT a substitute for access control on the activity log itself — only a
 * defense against the pseudonym leaking `userId` structure.
 *
 * Read lazily (not at module load) so tests never need the environment variable
 * set unless they exercise the writer, and production fails closed if it is
 * missing rather than silently using a constant, guessable salt.
 */
function pseudonymSalt(): string {
  const salt = process.env.WREN_ACTIVITY_PSEUDONYM_SALT;
  if (!salt) {
    throw new Error(
      'WREN_ACTIVITY_PSEUDONYM_SALT is not configured — cannot derive a stable actor pseudonym',
    );
  }
  return salt;
}

/**
 * Derive a STABLE, one-way pseudonym for `userId` (Requirement 44.4). Stable:
 * the same `userId` always yields the same pseudonym, so per-actor aggregation
 * still works on the pseudonym alone. One-way: a salted SHA-256 digest, so the
 * raw `userId` cannot be recovered from the pseudonym without the salt.
 */
export function pseudonymForActor(userId: string): string {
  return createHash('sha256').update(`${pseudonymSalt()}:${userId}`).digest('hex');
}

/**
 * Append one Actor–Verb–Object event to the activity log (Requirement 44.1)
 * and return the raw inserted row. No capability check: called by other
 * services as a side effect of their own (already-authorized) operations. The
 * raw `actorUserId` is never written to storage — only its pseudonym.
 */
export async function recordActivityEventRow(
  input: RecordActivityEventInput,
  db: ActivityLogQueryExecutor,
): Promise<ActivityEventRow> {
  const rows = await db.query<ActivityEventRow>(
    `INSERT INTO activity_event
       (actor_pseudonym, verb, object_type, object_ref, document_type_id, department_id, "timestamp", context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${ACTIVITY_EVENT_COLUMNS}`,
    [
      pseudonymForActor(input.actorUserId),
      input.verb,
      input.objectType,
      input.objectRef,
      input.documentTypeId ?? null,
      input.departmentId ?? null,
      input.timestamp ?? new Date(),
      input.context ?? {},
    ],
  );
  return rows[0]!;
}
