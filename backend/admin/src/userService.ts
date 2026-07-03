/**
 * System-wide global User directory search (REQ-ORG-02 / Requirement 29.1,
 * 29.5; Requirements 2.1, 2.2, 2.3, 2.5).
 *
 * Users are GLOBAL — `app_user` carries no Organization foreign key, and this
 * service never partitions the directory by Organization (Requirement 28.2 /
 * 29.4). Search/filter is by first name, last name, email, and/or role, and the
 * result is paginated (Requirement 29.5).
 *
 * This is gated by the `user.search` capability, which the `@wren/auth`
 * capability matrix restricts to `Admin` only (Requirements 2.1-2.3, 2.5): an
 * `Org Owner`'s user-facing authority is limited to Access Grants within owned
 * Organizations (see `accessGrantService.ts`), never a system-wide directory
 * search. The capability is re-checked here BEFORE any query runs.
 *
 * All persistence uses the injected parameterized {@link QueryExecutor}; no
 * value is ever interpolated into SQL (Requirement 39.2).
 */
import {
  userSearchInputSchema,
  userSearchResultSchema,
  userSummarySchema,
  type AuthContext,
  type Role,
  type UserSearchInput,
  type UserSearchResult,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';

/** Raw `app_user` row projected for directory search (snake_case columns). */
interface AppUserRow {
  readonly id: string;
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
}

/**
 * Fixed, parameterized WHERE clause: every filter is a nullable bind parameter
 * ($1..$4) rather than a dynamically assembled clause, so the statement text
 * never varies with which filters were supplied — every value still reaches
 * PostgreSQL as a bind parameter (Requirement 39.2).
 */
const WHERE_CLAUSE = `
  WHERE ($1::text IS NULL OR first_name ILIKE $1)
    AND ($2::text IS NULL OR last_name ILIKE $2)
    AND ($3::text IS NULL OR email ILIKE $3)
    AND ($4::text IS NULL OR EXISTS (
      SELECT 1 FROM role_assignment ra WHERE ra.user_id = app_user.id AND ra.role = $4
    ))
`;

const COUNT_SQL = `SELECT COUNT(*)::int AS count FROM app_user ${WHERE_CLAUSE}`;

const SELECT_SQL = `
  SELECT id, email, first_name, last_name FROM app_user ${WHERE_CLAUSE}
  ORDER BY last_name ASC, first_name ASC
  LIMIT $5 OFFSET $6
`;

const ROLES_FOR_USERS_SQL =
  'SELECT user_id, role FROM role_assignment WHERE user_id = ANY($1)';

/** Wrap a substring filter as an ILIKE pattern, or `null` when not supplied. */
function likePattern(value: string | undefined): string | null {
  return value === undefined ? null : `%${value}%`;
}

/** Fetch the distinct held roles for each of `userIds`, keyed by user id. */
async function fetchRolesByUser(
  userIds: readonly string[],
  db: QueryExecutor,
): Promise<Map<string, Role[]>> {
  const rolesByUser = new Map<string, Role[]>();
  if (userIds.length === 0) {
    return rolesByUser;
  }

  const rows = await db.query<{ user_id: string; role: Role }>(ROLES_FOR_USERS_SQL, [
    userIds,
  ]);

  for (const row of rows) {
    const existing = rolesByUser.get(row.user_id);
    if (existing) {
      if (!existing.includes(row.role)) {
        existing.push(row.role);
      }
    } else {
      rolesByUser.set(row.user_id, [row.role]);
    }
  }
  return rolesByUser;
}

/**
 * Search the global User directory by first name, last name, email, and/or
 * role, paginated (Requirement 29.1, 29.5). `Admin` only (Requirements
 * 2.1-2.3, 2.5) — enforced via the `user.search` capability BEFORE any query
 * runs.
 */
export async function searchUsers(
  actor: AuthContext,
  input: UserSearchInput,
  db: QueryExecutor,
): Promise<UserSearchResult> {
  requireCapability(actor, { capability: 'user.search', scope: { kind: 'platform' } });

  const parsed = userSearchInputSchema.parse(input);

  const filterParams = [
    likePattern(parsed.firstName),
    likePattern(parsed.lastName),
    likePattern(parsed.email),
    parsed.role ?? null,
  ];

  const countRows = await db.query<{ count: number }>(COUNT_SQL, filterParams);
  const total = countRows[0]?.count ?? 0;

  const offset = (parsed.page - 1) * parsed.pageSize;
  const rows = await db.query<AppUserRow>(SELECT_SQL, [
    ...filterParams,
    parsed.pageSize,
    offset,
  ]);

  const rolesByUser = await fetchRolesByUser(rows.map((row) => row.id), db);

  const users = rows.map((row) =>
    userSummarySchema.parse({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      roles: rolesByUser.get(row.id) ?? [],
    }),
  );

  return userSearchResultSchema.parse({
    users,
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  });
}
