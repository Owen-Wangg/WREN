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

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

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
 * The value lives only in Secrets Manager. The Lambda environment carries the
 * secret's NAME (`WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID`), never the value,
 * so reading it requires `secretsmanager:GetSecretValue` rather than the much
 * more widely held `lambda:GetFunctionConfiguration`. Every service that writes
 * through this module (Admin, Audit, Document) reads the SAME secret, which is
 * what keeps pseudonyms correlatable across services.
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
 * by passing `undefined`) and clear the cached value.
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
 * Derive a STABLE, one-way pseudonym for `userId` (Requirement 44.4). Stable:
 * the same `userId` always yields the same pseudonym, so per-actor aggregation
 * still works on the pseudonym alone. One-way: a salted SHA-256 digest, so the
 * raw `userId` cannot be recovered from the pseudonym without the salt.
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

const INSERT_ACTIVITY_EVENT_SQL = `INSERT INTO activity_event
       (actor_pseudonym, verb, object_type, object_ref, document_type_id, department_id, "timestamp", context)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

/** Bind parameters for an activity_event insert; the raw actor id is pseudonymized first. */
async function activityEventParams(input: RecordActivityEventInput): Promise<unknown[]> {
  return [
    await pseudonymForActor(input.actorUserId),
    input.verb,
    input.objectType,
    input.objectRef,
    input.documentTypeId ?? null,
    input.departmentId ?? null,
    input.timestamp ?? new Date(),
    input.context ?? {},
  ];
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
    `${INSERT_ACTIVITY_EVENT_SQL}
     RETURNING ${ACTIVITY_EVENT_COLUMNS}`,
    await activityEventParams(input),
  );
  return rows[0]!;
}

/**
 * Write-only variant of {@link recordActivityEventRow}: appends the event
 * without reading it back. A role that only records events (e.g. the
 * authorizer auditing identity relinks) then needs INSERT on `activity_event`
 * but not SELECT, so it cannot read the rest of the activity log.
 */
export async function appendActivityEventRow(
  input: RecordActivityEventInput,
  db: ActivityLogQueryExecutor,
): Promise<void> {
  await db.query(INSERT_ACTIVITY_EVENT_SQL, await activityEventParams(input));
}
