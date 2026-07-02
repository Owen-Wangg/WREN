/**
 * App-database identity mapping (REQ-SEC-AUTHDECOUPLE-01 / Requirements 37.2,
 * 37.3, 37.5).
 *
 * Given a *verified* identity-provider subject (e.g. a Cognito `sub`), this
 * module looks up the application-side identity and builds the {@link AuthContext}
 * that downstream services consume. Every authorization fact — roles,
 * Organization/Writing-Type scopes, Access Grants — is read from Postgres. The
 * IdP token's groups/claims/attributes are deliberately NOT an input here: the
 * only thing that crosses the boundary from authentication into authorization is
 * the opaque subject string. Swapping the IdP therefore changes no logic in this
 * file (Requirement 37.4).
 *
 * All queries are parameterized ($1..$N); no value is interpolated into SQL
 * (UBC CIC security steering / Requirement 39.2). The executor is accepted as a
 * structural interface so the real `@wren/db-node` `DataAccess` (or a test fake)
 * satisfies it without a hard dependency.
 */
import {
  authContextSchema,
  type AccessGrant,
  type AuthContext,
  type GrantScope,
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

/** Raw `access_grant` row. `scope` is JSONB; timestamps may arrive as Date. */
export interface AccessGrantRow {
  readonly id: string;
  readonly user_id: string;
  readonly scope: unknown;
  readonly granted_by: string | null;
  readonly granted_at: Date | string;
  readonly revoked_at: Date | string | null;
}

const APP_USER_SQL =
  'SELECT id, email, idp_subject FROM app_user WHERE idp_subject = $1';

const ROLE_ASSIGNMENT_SQL =
  'SELECT role, scope FROM role_assignment WHERE user_id = $1';

// Only active (non-revoked) grants participate in authorization.
const ACCESS_GRANT_SQL =
  'SELECT id, user_id, scope, granted_by, granted_at, revoked_at ' +
  'FROM access_grant WHERE user_id = $1 AND revoked_at IS NULL';

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Extract the Organization ids this user owns, from `Org Owner` role-assignment
 * scopes shaped `{ organizationId: "..." }`.
 */
function collectOwnedOrganizationIds(rows: readonly RoleAssignmentRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.role !== 'Org Owner') continue;
    const scope = asRecord(row.scope);
    const orgId = scope?.['organizationId'];
    if (typeof orgId === 'string' && orgId.length > 0) {
      ids.add(orgId);
    }
  }
  return [...ids];
}

/**
 * Extract the Writing Types this user is assigned to as a `Field Expert`, from
 * scopes shaped `{ writingTypeIds: ["...", ...] }`. A Field Expert may hold
 * assignments across multiple Organizations, so this is a flat, de-duplicated set.
 */
function collectAssignedWritingTypeIds(rows: readonly RoleAssignmentRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.role !== 'Field Expert') continue;
    const scope = asRecord(row.scope);
    const list = scope?.['writingTypeIds'];
    if (Array.isArray(list)) {
      for (const id of list) {
        if (typeof id === 'string' && id.length > 0) {
          ids.add(id);
        }
      }
    }
  }
  return [...ids];
}

/** De-duplicated role identities (the app DB is the source of truth). */
function collectRoles(rows: readonly RoleAssignmentRow[]): Role[] {
  return [...new Set(rows.map((r) => r.role))];
}

/** Map an `access_grant` scope JSONB to the shared {@link GrantScope} union. */
function toGrantScope(scope: unknown): GrantScope | undefined {
  const record = asRecord(scope);
  if (!record) return undefined;
  const writingTypeId = record['writingTypeId'];
  if (typeof writingTypeId === 'string' && writingTypeId.length > 0) {
    return { writingTypeId };
  }
  const organizationId = record['organizationId'];
  if (typeof organizationId === 'string' && organizationId.length > 0) {
    return { organizationId };
  }
  return undefined;
}

function toAccessGrant(row: AccessGrantRow): AccessGrant | undefined {
  const scope = toGrantScope(row.scope);
  if (!scope || !row.granted_by) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    scope,
    grantedBy: row.granted_by,
    grantedAt: toIso(row.granted_at),
    ...(row.revoked_at ? { revokedAt: toIso(row.revoked_at) } : {}),
  };
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
    userId: user.id,
    idpSubject: user.idp_subject,
    email: user.email,
    roles: collectRoles(roleRows),
    ownedOrganizationIds: collectOwnedOrganizationIds(roleRows),
    assignedWritingTypeIds: collectAssignedWritingTypeIds(roleRows),
    grants: grantRows
      .map(toAccessGrant)
      .filter((g): g is AccessGrant => g !== undefined),
  };

  // Validate the assembled context against the shared schema so a malformed
  // DB row fails safely rather than producing a bad authorization payload.
  return authContextSchema.parse(context);
}
