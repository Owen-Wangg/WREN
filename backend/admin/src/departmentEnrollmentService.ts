/**
 * Department roster (System Admin bulk enrollment by email).
 *
 * The roster is the list of students enrolled in a Department. Being on it
 * issues an explicit visibility permission and an Access Grant for every
 * Document Type in the Department (and, via a database trigger, for Document
 * Types added later). Students are matched by the email they signed up with:
 *
 *   - an email that already belongs to an account is enrolled immediately;
 *   - any other email is held as a pending roster row and redeemed by the
 *     authorizer right after that user's first-login provisioning (which only
 *     succeeds for a Cognito-verified email).
 *
 * The roster is maintained by uploading a CSV (adding to it, or replacing it
 * so the file is the whole list) and by removing individual rows. Removing a
 * student takes away their Department access: the visibility permission and
 * every active Access Grant on the Department's Document Types are revoked.
 *
 * All linking and grant issuing happens inside the SQL function
 * `apply_department_enrollments` (migration 0014) — the same code path the
 * authorizer uses on first sign-in.
 */
import {
  departmentEnrollmentImportResultSchema,
  departmentEnrollmentListSchema,
  importDepartmentEnrollmentsInputSchema,
  type AuthContext,
  type DepartmentEnrollmentImportResult,
  type DepartmentEnrollmentList,
  type ImportDepartmentEnrollmentsInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

// Deliberately permissive: Cognito is the authority on deliverability. This
// only rejects values that cannot be an address (blank cells, names, ids).
const EMAIL_PATTERN = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export interface NormalizedEmails {
  readonly valid: string[];
  readonly invalid: string[];
}

/** Trim, lower-case, de-duplicate, and split values into valid / invalid emails. */
export function normalizeEnrollmentEmails(values: readonly string[]): NormalizedEmails {
  const valid = new Set<string>();
  const invalid = new Set<string>();
  for (const raw of values) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (EMAIL_PATTERN.test(value) && value.length <= 320) {
      valid.add(value);
    } else {
      invalid.add(raw.trim());
    }
  }
  return { valid: [...valid], invalid: [...invalid] };
}

function requireRosterManager(actor: AuthContext, departmentId: string): void {
  requireCapability(actor, {
    capability: 'departmentEnrollment.manage',
    scope: { kind: 'department', departmentId },
  });
}

async function assertActiveDepartment(departmentId: string, db: QueryExecutor): Promise<void> {
  const departments = await db.query<{ id: string }>(
    'SELECT id FROM department WHERE id = $1 AND archived_at IS NULL',
    [departmentId],
  );
  if (departments.length === 0) {
    throw new NotFoundError(`Department '${departmentId}' not found`);
  }
}

/**
 * Revoke roster rows and the Department access they gave. Returns the emails
 * of the rows actually revoked (already-revoked rows are skipped).
 */
async function revokeEnrollments(
  departmentId: string,
  enrollmentIds: readonly string[],
  db: QueryExecutor,
): Promise<string[]> {
  if (enrollmentIds.length === 0) return [];
  const revoked = await db.query<{ email: string; user_id: string | null }>(
    `UPDATE department_enrollment
     SET revoked_at = now()
     WHERE department_id = $1 AND id = ANY($2::uuid[]) AND revoked_at IS NULL
     RETURNING email, user_id`,
    [departmentId, enrollmentIds],
  );
  const userIds = revoked.flatMap((row) => (row.user_id ? [row.user_id] : []));
  if (userIds.length > 0) {
    await db.query(
      `UPDATE access_grant SET revoked_at = now()
       WHERE user_id = ANY($2::uuid[])
         AND revoked_at IS NULL
         AND document_type_id IN (SELECT id FROM document_type WHERE department_id = $1)`,
      [departmentId, userIds],
    );
    await db.query(
      `UPDATE department_visibility_grant SET revoked_at = now()
       WHERE department_id = $1 AND user_id = ANY($2::uuid[]) AND revoked_at IS NULL`,
      [departmentId, userIds],
    );
  }
  return revoked.map((row) => row.email).sort();
}

export interface EnrollmentImportOutcome {
  readonly result: DepartmentEnrollmentImportResult;
  /** Roster rows created by this import (for the audit record). */
  readonly added: number;
}

/**
 * Upload a roster (`departmentEnrollment.manage`, TechnicalAdmin only).
 *
 * `add` enrolls every email and keeps the existing roster. `replace` also
 * removes roster rows whose email is not in the upload. Re-importing an email
 * already on the roster re-applies its grants but creates no duplicate row.
 *
 * `dryRun` is reported back in the result; the CALLER must run this inside a
 * transaction and roll it back so nothing is saved.
 */
export async function importDepartmentEnrollments(
  actor: AuthContext,
  departmentId: string,
  input: ImportDepartmentEnrollmentsInput,
  db: QueryExecutor,
): Promise<EnrollmentImportOutcome> {
  const { emails, mode, dryRun } = importDepartmentEnrollmentsInputSchema.parse(input);
  requireRosterManager(actor, departmentId);
  await assertActiveDepartment(departmentId, db);

  const { valid, invalid } = normalizeEnrollmentEmails(emails);
  if (valid.length === 0) {
    if (mode === 'replace') {
      // Never let a malformed file empty the roster.
      throw Object.assign(
        new Error('The upload has no valid email addresses, so the roster was not replaced.'),
        { statusCode: 400 },
      );
    }
    return {
      result: departmentEnrollmentImportResultSchema.parse({
        enrolled: [],
        pending: [],
        invalid,
        alreadyOnRoster: 0,
        removed: [],
        dryRun,
      }),
      added: 0,
    };
  }

  const inserted = await db.query<{ email: string }>(
    `INSERT INTO department_enrollment (department_id, email, invited_by)
     SELECT $1, email, $3 FROM unnest($2::text[]) AS email
     ON CONFLICT (department_id, email) WHERE revoked_at IS NULL DO NOTHING
     RETURNING email`,
    [departmentId, valid, actor.userId],
  );

  await db.query(
    'SELECT apply_department_enrollments($1::uuid, NULL::uuid, $2::text[])',
    [departmentId, valid],
  );

  let removed: string[] = [];
  if (mode === 'replace') {
    const stale = await db.query<{ id: string }>(
      `SELECT id FROM department_enrollment
       WHERE department_id = $1 AND revoked_at IS NULL AND NOT (email = ANY($2::text[]))`,
      [departmentId, valid],
    );
    removed = await revokeEnrollments(departmentId, stale.map((row) => row.id), db);
  }

  const rows = await db.query<{ email: string; linked: boolean }>(
    `SELECT email, user_id IS NOT NULL AS linked
     FROM department_enrollment
     WHERE department_id = $1 AND revoked_at IS NULL AND email = ANY($2::text[])
     ORDER BY email ASC`,
    [departmentId, valid],
  );

  return {
    result: departmentEnrollmentImportResultSchema.parse({
      enrolled: rows.filter((row) => row.linked).map((row) => row.email),
      pending: rows.filter((row) => !row.linked).map((row) => row.email),
      invalid,
      alreadyOnRoster: valid.length - inserted.length,
      removed,
      dryRun,
    }),
    added: inserted.length,
  };
}

interface EnrollmentRow {
  readonly id: string;
  readonly department_id: string;
  readonly email: string;
  readonly user_id: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly invited_at: Date | string;
  readonly linked_at: Date | string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export interface EnrollmentListOptions {
  readonly q?: string;
  readonly status?: 'enrolled' | 'pending';
  readonly limit?: number;
  readonly offset?: number;
}

/** List a Department's active roster, searchable by email or name. */
export async function listDepartmentEnrollments(
  actor: AuthContext,
  departmentId: string,
  db: QueryExecutor,
  options: EnrollmentListOptions = {},
): Promise<DepartmentEnrollmentList> {
  requireRosterManager(actor, departmentId);
  await assertActiveDepartment(departmentId, db);

  const search = options.q?.trim();
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const params = [departmentId, search ? `%${search}%` : null, options.status ?? null];
  const where = `de.department_id = $1
       AND de.revoked_at IS NULL
       AND ($2::text IS NULL
         OR de.email ILIKE $2
         OR u.first_name ILIKE $2
         OR u.last_name ILIKE $2)
       AND ($3::text IS NULL
         OR ($3 = 'enrolled' AND de.user_id IS NOT NULL)
         OR ($3 = 'pending' AND de.user_id IS NULL))`;

  const countRows = await db.query<{ total: string | number }>(
    `SELECT COUNT(*)::int AS total
     FROM department_enrollment de
     LEFT JOIN app_user u ON u.id = de.user_id
     WHERE ${where}`,
    params,
  );

  const rows = await db.query<EnrollmentRow>(
    `SELECT de.id, de.department_id, de.email, de.user_id,
            u.first_name, u.last_name, de.invited_at, de.linked_at
     FROM department_enrollment de
     LEFT JOIN app_user u ON u.id = de.user_id
     WHERE ${where}
     ORDER BY de.email ASC
     LIMIT $4 OFFSET $5`,
    [...params, limit, offset],
  );

  return departmentEnrollmentListSchema.parse({
    items: rows.map((row) => ({
      id: row.id,
      departmentId: row.department_id,
      email: row.email,
      status: row.user_id ? 'enrolled' : 'pending',
      userId: row.user_id,
      firstName: row.first_name,
      lastName: row.last_name,
      invitedAt: toIso(row.invited_at),
      linkedAt: row.linked_at ? toIso(row.linked_at) : null,
    })),
    total: Number(countRows[0]?.total ?? 0),
    limit,
    offset,
  });
}

/**
 * Remove one student from the roster and take away the Department access the
 * enrollment gave them. Returns the removed email, or `null` when the row was
 * already removed (idempotent).
 */
export async function removeDepartmentEnrollment(
  actor: AuthContext,
  departmentId: string,
  enrollmentId: string,
  db: QueryExecutor,
): Promise<string | null> {
  requireRosterManager(actor, departmentId);
  await assertActiveDepartment(departmentId, db);

  const existing = await db.query<{ id: string }>(
    'SELECT id FROM department_enrollment WHERE id = $1 AND department_id = $2',
    [enrollmentId, departmentId],
  );
  if (existing.length === 0) {
    throw new NotFoundError(
      `Enrollment '${enrollmentId}' not found for Department '${departmentId}'`,
    );
  }
  const [email] = await revokeEnrollments(departmentId, [enrollmentId], db);
  return email ?? null;
}
