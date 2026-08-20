/**
 * App-database identity mapping (REQ-SEC-AUTHDECOUPLE-01 / Requirements 37.2,
 * 37.3, 37.5).
 *
 * Given a *verified* identity-provider subject (e.g. a Cognito `sub`), this
 * module looks up the application-side identity and builds the {@link AuthContext}
 * that downstream services consume. Every authorization fact — roles,
 * Department scopes, Access Grants — is read from Postgres. The IdP token's
 * groups/claims/attributes are deliberately NOT an input here: the only thing
 * that crosses the boundary from authentication into authorization is the opaque
 * subject string. Swapping the IdP therefore changes no logic in this file
 * (Requirement 37.4).
 *
 * All queries are parameterized ($1..$N); no value is interpolated into SQL
 * (UBC CIC security steering / Requirement 39.2). The executor is accepted as a
 * structural interface so the real `@wren/db-node` `DataAccess` (or a test fake)
 * satisfies it without a hard dependency.
 */
import {
  accessGrantSchema,
  authContextSchema,
  roleSchema,
  type AccessGrant,
  type AuthContext,
  type Role,
} from '@wren/types';

/**
 * Minimal parameterized-query surface. `@wren/db-node`'s `DataAccess` satisfies
 * this structurally (`query<Row>(text, params)`), and so does any test fake.
 */
export interface QueryExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

/** Raw `app_user` row (authentication mapping only; never an authz source). */
export interface AppUserRow {
  readonly id: string;
  readonly email: string;
  readonly idp_subject: string;
}

/** Raw `role_assignment` row. `scope` is JSONB (already parsed to an object). */
export interface RoleAssignmentRow {
  readonly role: Role;
  readonly scope: unknown;
}

/** Raw `access_grant` row. Flat `document_type_id` column (V4). */
export interface AccessGrantRow {
  readonly id: string;
  readonly user_id: string;
  readonly document_type_id: string;
  readonly granted_by: string | null;
  readonly granted_at: Date | string;
  readonly revoked_at: Date | string | null;
}

const APP_USER_SQL =
  'SELECT id, email, idp_subject FROM app_user WHERE idp_subject = $1';

const ROLE_ASSIGNMENT_SQL =
  'SELECT role, scope FROM role_assignment WHERE user_id = $1';

// Only active (non-revoked) grants participate in authorization.
// V4: access_grant has a flat document_type_id column (no JSONB scope).
const ACCESS_GRANT_SQL =
  'SELECT id, user_id, document_type_id, granted_by, granted_at, revoked_at ' +
  'FROM access_grant WHERE user_id = $1 AND revoked_at IS NULL';

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Extract the Department ids this user administers, from `DepartmentAdmin`
 * role-assignment scopes shaped `{ departmentIds: ["..."] }`.
 */
function collectAdministeredDepartmentIds(rows: readonly RoleAssignmentRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.role !== 'DepartmentAdmin') continue;
    const scope = asRecord(row.scope);
    const deptIds = scope?.['departmentIds'];
    if (Array.isArray(deptIds)) {
      for (const id of deptIds) {
        if (typeof id === 'string' && id.length > 0) {
          ids.add(id);
        }
      }
    }
    // Also support a single departmentId for backward compat
    const singleId = scope?.['departmentId'];
    if (typeof singleId === 'string' && singleId.length > 0) {
      ids.add(singleId);
    }
  }
  return [...ids];
}

/** De-duplicated role identities (the app DB is the source of truth). */
function collectRoles(rows: readonly RoleAssignmentRow[]): Role[] {
  const roles = new Set<Role>();
  for (const row of rows) {
    const parsed = roleSchema.safeParse(row.role);
    if (parsed.success) roles.add(parsed.data);
  }
  return [...roles];
}

/** Map a flat `access_grant` row to the shared {@link AccessGrant} type (V4). */
function toAccessGrant(row: AccessGrantRow): AccessGrant | undefined {
  if (!row.granted_by) return undefined;
  const candidate = {
    id: row.id,
    userId: row.user_id,
    documentTypeId: row.document_type_id,
    grantedBy: row.granted_by,
    grantedAt: toIso(row.granted_at),
    ...(row.revoked_at ? { revokedAt: toIso(row.revoked_at) } : {}),
  };
  const parsed = accessGrantSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Resolve a verified IdP subject to its application-side {@link AuthContext}.
 *
 * @returns the resolved context, or `null` when the subject maps to no
 *   application identity (an authenticated-but-unknown user, which the
 *   authorizer must deny — Requirement 37.5).
 */
export async function mapSubjectToAuthContext(
  idpSubject: string,
  db: QueryExecutor,
): Promise<AuthContext | null> {
  const users = await db.query<AppUserRow>(APP_USER_SQL, [idpSubject]);
  const user = users[0];
  if (!user) {
    return null;
  }

  const [roleRows, grantRows] = await Promise.all([
    db.query<RoleAssignmentRow>(ROLE_ASSIGNMENT_SQL, [user.id]),
    db.query<AccessGrantRow>(ACCESS_GRANT_SQL, [user.id]),
  ]);

  const context: AuthContext = {
    userId: String(user.id),
    idpSubject: String(user.idp_subject),
    email: String(user.email ?? '').trim().toLowerCase(),
    roles: collectRoles(roleRows),
    administeredDepartmentIds: collectAdministeredDepartmentIds(roleRows),
    grants: grantRows
      .map(toAccessGrant)
      .filter((g): g is AccessGrant => g !== undefined),
  };

  // Validate the assembled context against the shared schema so a malformed
  // DB row fails safely rather than producing a bad authorization payload.
  const parsed = authContextSchema.safeParse(context);
  if (!parsed.success) {
    console.error('Auth context schema failed', parsed.error.flatten());
    throw parsed.error;
  }
  return parsed.data;
}
