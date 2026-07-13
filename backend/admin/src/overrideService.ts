/**
 * Temporary, Document-Type-scoped usage overrides (REQ-TOKEN-LIMIT-01 /
 * Requirement 54 criteria 5-8; Task 13.4).
 *
 * A Department Admin who administers a Document Type's Department, or a
 * Technical Admin, may grant a Student a temporary override raising their
 * effective usage bound for that ONE Document Type (Requirement 54.5).
 * Overrides are audited (actor identity/role, affected Student, Document
 * Type, reason, timestamp — Requirement 54.6) and expire automatically at
 * the next usage-period reset (Requirement 54.7) — {@link isOverrideActive}
 * is the single predicate every caller (including
 * `usageEnforcementService.checkAndReserve`) uses to decide whether an
 * override still applies, so "expiry" is never a separate cleanup job that
 * could drift out of sync with enforcement.
 *
 * This module intentionally grants capability via `usageOverride.grant`,
 * which — per the capability matrix — is held by BOTH `DepartmentAdmin`
 * (scoped to administered Departments) and `TechnicalAdmin` (platform-wide),
 * matching Requirement 54.5's "Department Admin ... or Technical Admin"
 * grantor rule directly, with no separate code path per role.
 */
import {
  createOverrideInputSchema,
  overrideSchema,
  type AuthContext,
  type CreateOverrideInput,
  type Override,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `override` row (snake_case columns from PostgreSQL, post-V4 rename). */
interface OverrideRow {
  readonly id: string;
  readonly user_id: string;
  readonly document_type_id: string;
  readonly bounds: { additionalActions: number };
  readonly reason: string;
  readonly granted_by: string | null;
  readonly expires_at: string | Date;
}

const RETURNING = 'id, user_id, document_type_id, bounds, reason, granted_by, expires_at';

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Map a raw row to the validated shared {@link Override} DTO. */
function toOverride(row: OverrideRow): Override {
  return overrideSchema.parse({
    id: row.id,
    userId: row.user_id,
    documentTypeId: row.document_type_id,
    bounds: row.bounds,
    reason: row.reason,
    grantedBy: row.granted_by ?? '',
    expiresAt: toIsoString(row.expires_at),
  });
}

/** Load a Document Type's owning Department id, or `null` when it is unknown. */
async function findDepartmentId(
  documentTypeId: string,
  db: QueryExecutor,
): Promise<string | null> {
  const rows = await db.query<{ department_id: string }>(
    'SELECT department_id FROM document_type WHERE id = $1',
    [documentTypeId],
  );
  return rows[0]?.department_id ?? null;
}

/**
 * Grant a Student a temporary, Document-Type-scoped usage override
 * (`DepartmentAdmin` administering the Document Type's Department, or
 * `TechnicalAdmin` — `usageOverride.grant`). `expiresAt` is the caller's
 * chosen usage-period reset boundary (Requirement 54.7); this function does
 * not compute it — the caller (typically the Usage_Service's period-reset
 * logic) supplies the next reset timestamp so this module has no
 * independent opinion on period length.
 *
 * The audit record required by Requirement 54.6 (granting actor's identity
 * + role, affected Student, Document Type, reason, timestamp) is emitted by
 * the caller via `activityLogService.ts` (Task 14.1/14.7) immediately after
 * a successful grant — this function returns everything needed for that
 * event (`actor`, the created {@link Override}) without importing the audit
 * module itself, keeping Usage_Service and Audit_Service decoupled per
 * design.md's service boundaries.
 */
export async function grantOverride(
  actor: AuthContext,
  input: CreateOverrideInput,
  db: QueryExecutor,
): Promise<Override> {
  const parsed = createOverrideInputSchema.parse(input);

  const departmentId = await findDepartmentId(parsed.documentTypeId, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${parsed.documentTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'usageOverride.grant',
    scope: { kind: 'documentType', documentTypeId: parsed.documentTypeId, departmentId },
  });

  const rows = await db.query<OverrideRow>(
    `INSERT INTO override (user_id, document_type_id, bounds, reason, granted_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${RETURNING}`,
    [
      parsed.userId,
      parsed.documentTypeId,
      parsed.bounds,
      parsed.reason,
      actor.userId,
      new Date(parsed.expiresAt),
    ],
  );

  return toOverride(rows[0]!);
}

/** Read a single override by id, or `null` when it does not exist. */
export async function getOverride(id: string, db: QueryExecutor): Promise<Override | null> {
  const rows = await db.query<OverrideRow>(`SELECT ${RETURNING} FROM override WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? toOverride(row) : null;
}

/**
 * List every override currently on record for a (Student, Document Type)
 * pair, including expired ones (callers that need only active overrides
 * should filter with {@link isOverrideActive}).
 */
export async function listOverridesForUserAndDocumentType(
  userId: string,
  documentTypeId: string,
  db: QueryExecutor,
): Promise<Override[]> {
  const rows = await db.query<OverrideRow>(
    `SELECT ${RETURNING} FROM override WHERE user_id = $1 AND document_type_id = $2 ORDER BY expires_at DESC`,
    [userId, documentTypeId],
  );
  return rows.map(toOverride);
}

/**
 * The single predicate for whether an override still applies (Requirement
 * 54.7 — overrides expire automatically at usage-period reset;
 * `usageEnforcementService.checkAndReserve` and any other caller MUST use
 * this rather than re-deriving expiry logic independently).
 */
export function isOverrideActive(override: Override, now: Date): boolean {
  return new Date(override.expiresAt).getTime() > now.getTime();
}

/**
 * Resolve the currently active override (if any) for a (Student, Document
 * Type) pair — the shape `usageEnforcementService.checkAndReserve` consumes
 * directly as its `ActiveOverride` parameter. Returns `null` when no
 * unexpired override exists; when more than one unexpired override exists
 * (e.g. a new one granted before the prior one's period reset), the one
 * with the LATEST `expiresAt` wins, since it is the most permissive still
 * in force (Requirement 54.8 — "up to the override's bounds").
 */
export async function getActiveOverrideBounds(
  userId: string,
  documentTypeId: string,
  now: Date,
  db: QueryExecutor,
): Promise<{ additionalActions: number } | null> {
  const overrides = await listOverridesForUserAndDocumentType(userId, documentTypeId, db);
  const active = overrides.filter((o) => isOverrideActive(o, now));
  if (active.length === 0) {
    return null;
  }
  // Already ordered by expires_at DESC from the query; the first active one
  // has the latest expiry.
  return active[0]!.bounds;
}
