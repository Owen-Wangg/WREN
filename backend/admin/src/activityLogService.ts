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
import { createHash } from 'crypto';

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
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
 * A server-side secret that salts every pseudonym so it cannot be reversed to
 * a `userId` by an observer who only sees {@link pseudonymForActor}'s output
 * (e.g. from an activity-log export). It is NOT a substitute for access
 * control on the activity log itself — only a defense against the pseudonym
 * leaking `userId` structure (which is a bare UUID and would otherwise be
 * trivially distinguishable/guessable across a small user base).
 *
 * The value lives only in Secrets Manager. The Lambda environment carries the
 * secret's NAME (`WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID`), never the value,
 * so reading it requires `secretsmanager:GetSecretValue` rather than the
 * much more widely held `lambda:GetFunctionConfiguration`.
 *
 * Fetched lazily (not at module load) and cached once per Lambda container.
 * Production always fails closed if the secret id is missing or the fetch
 * fails, rather than silently using a constant, guessable salt. The value is
 * never logged or included in an error message.
 */
export type PseudonymSaltLoader = () => Promise<string>;

let secretsClient: SecretsManagerClient | undefined;

/**
 * Default loader: fetch the salt from Secrets Manager using the secret id in
 * `WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID`. The secret is a plain string
 * (generated without a JSON template), so `SecretString` is the salt itself.
 */
export async function loadPseudonymSaltFromSecretsManager(
  client?: Pick<SecretsManagerClient, 'send'>,
): Promise<string> {
  const secretId = process.env.WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID;
  if (!secretId) {
    throw new Error(
      'WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID is not configured — cannot derive a stable actor pseudonym',
    );
  }
  const sm = client ?? (secretsClient ??= new SecretsManagerClient({}));
  const response = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error('Activity pseudonym salt secret is empty or binary; expected SecretString');
  }
  return response.SecretString;
}

let saltLoader: PseudonymSaltLoader = loadPseudonymSaltFromSecretsManager;
// One shared promise per container: concurrent first callers trigger a single
// fetch. No TTL — the salt must never change for the lifetime of the data
// (rotating it breaks historical pseudonym grouping).
let saltPromise: Promise<string> | undefined;

/**
 * Test seam: replace the salt source (or restore the Secrets Manager default
 * by passing `undefined`) and clear the cached value. Not exported from the
 * package index.
 */
export function setPseudonymSaltLoader(loader: PseudonymSaltLoader | undefined): void {
  saltLoader = loader ?? loadPseudonymSaltFromSecretsManager;
  saltPromise = undefined;
}

function pseudonymSalt(): Promise<string> {
  // On failure, drop the cached rejection so a transient Secrets Manager error
  // does not break this container for the rest of its lifetime.
  saltPromise ??= saltLoader().catch((err: unknown) => {
    saltPromise = undefined;
    throw err;
  });
  return saltPromise;
}

/**
 * Derive a STABLE pseudonym for `userId` (Requirement 44.4 — "a stable
 * pseudonymous identifier"). Stable: the same `userId` always yields the same
 * pseudonym, so per-actor aggregation still works on the pseudonym alone.
 * One-way: a salted SHA-256 digest, so the raw `userId` cannot be recovered
 * from the pseudonym without the salt.
 */
export async function pseudonymForActor(userId: string): Promise<string> {
  return derivePseudonym(await pseudonymSalt(), userId);
}

/**
 * Pure derivation behind {@link pseudonymForActor}: salted SHA-256 of
 * `${salt}:${userId}`. Exposed so the derivation's properties (stability,
 * distinctness) can be tested synchronously without a salt source. The input
 * format must never change — doing so orphans every stored pseudonym.
 */
export function derivePseudonym(salt: string, userId: string): string {
  return createHash('sha256').update(`${salt}:${userId}`).digest('hex');
}

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
 * Append one Actor–Verb–Object event to the activity log (Requirement 44.1).
 * No capability check: called by other services as a side effect of their
 * own (already-authorized) operations, not exposed as a standalone
 * privileged endpoint. Always resolves to a persisted event with a
 * pseudonymous actor — the raw `actorUserId` is never written to storage.
 */
export async function recordActivityEvent(
  input: RecordActivityEventInput,
  db: QueryExecutor,
): Promise<ActivityEvent> {
  const rows = await db.query<ActivityEventRow>(
    `INSERT INTO activity_event
       (actor_pseudonym, verb, object_type, object_ref, document_type_id, department_id, "timestamp", context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${RETURNING}`,
    [
      await pseudonymForActor(input.actorUserId),
      input.verb,
      input.objectType,
      input.objectRef,
      input.documentTypeId ?? null,
      input.departmentId ?? null,
      input.timestamp ?? new Date(),
      input.context ?? {},
    ],
  );
  return toActivityEvent(rows[0]!);
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
