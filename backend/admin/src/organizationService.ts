/**
 * Organization management (REQ-ORG-GROUPING-01 / Requirement 28;
 * REQ-ADMIN-FEATURES-01 / Requirement 33.2).
 *
 * An Organization is a GROUPING of Writing Types, the Field Experts who maintain
 * them, org-wide Reference Material, and business Topics. It owns NO Users — the
 * `organization` table carries no user foreign key and this service never
 * associates a User with an Organization as ownership (Requirement 28.1 / 28.2).
 * It is never a data-isolation boundary.
 *
 * Creating/removing Organizations and setting their OPEN/LOCKED access state are
 * technical Admin operations (Requirement 33.2): the capability matrix reserves
 * `organization.manage` and `organization.setAccessState` to `Admin`. Every
 * mutation re-checks the capability BEFORE touching the database and denies with
 * no mutation when disallowed (Requirements 36.2, 36.3).
 *
 * All persistence goes through the injected parameterized {@link QueryExecutor};
 * no value is ever interpolated into SQL (Requirement 39.2).
 */
import {
  createOrganizationInputSchema,
  organizationSchema,
  updateOrganizationInputSchema,
  type AccessState,
  type AuthContext,
  type CreateOrganizationInput,
  type Organization,
  type UpdateOrganizationInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `organization` row (snake_case columns from PostgreSQL). */
interface OrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly access_state: AccessState;
}

/** The columns every read/write returns, in the shared DTO's field order. */
const RETURNING = 'id, name, access_state';

/** Map a raw row to the validated shared {@link Organization} DTO. */
function toOrganization(row: OrganizationRow): Organization {
  return organizationSchema.parse({
    id: row.id,
    name: row.name,
    accessState: row.access_state,
  });
}

/**
 * Create an Organization grouping (Admin only). The access state defaults to the
 * schema default `LOCKED` when not supplied (safe default; the Admin may open it
 * later). No User is ever associated as an owner (Requirement 28.1).
 */
export async function createOrganization(
  actor: AuthContext,
  input: CreateOrganizationInput,
  db: QueryExecutor,
): Promise<Organization> {
  requireCapability(actor, {
    capability: 'organization.manage',
    scope: { kind: 'platform' },
  });

  const { name, accessState } = createOrganizationInputSchema.parse(input);

  const rows = await db.query<OrganizationRow>(
    accessState === undefined
      ? `INSERT INTO organization (name) VALUES ($1) RETURNING ${RETURNING}`
      : `INSERT INTO organization (name, access_state) VALUES ($1, $2) RETURNING ${RETURNING}`,
    accessState === undefined ? [name] : [name, accessState],
  );

  return toOrganization(rows[0]!);
}

/** Read a single Organization by id, or `null` when it does not exist. */
export async function getOrganization(
  id: string,
  db: QueryExecutor,
): Promise<Organization | null> {
  const rows = await db.query<OrganizationRow>(
    `SELECT ${RETURNING} FROM organization WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toOrganization(row) : null;
}

/** List all Organization groupings, ordered by name. */
export async function listOrganizations(
  db: QueryExecutor,
): Promise<Organization[]> {
  const rows = await db.query<OrganizationRow>(
    `SELECT ${RETURNING} FROM organization ORDER BY name ASC`,
  );
  return rows.map(toOrganization);
}

/**
 * Update an Organization's mutable catalog field (its name). Admin only. Throws
 * {@link NotFoundError} when the Organization does not exist.
 */
export async function updateOrganization(
  actor: AuthContext,
  id: string,
  input: UpdateOrganizationInput,
  db: QueryExecutor,
): Promise<Organization> {
  requireCapability(actor, {
    capability: 'organization.manage',
    scope: { kind: 'organization', organizationId: id },
  });

  const { name } = updateOrganizationInputSchema.parse(input);

  const rows = await db.query<OrganizationRow>(
    `UPDATE organization SET name = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, name],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Organization '${id}' not found`);
  }
  return toOrganization(row);
}

/**
 * Set an Organization's OPEN/LOCKED access state (Admin only, Requirement 28.4 /
 * 33.2). This is the default that a Writing Type inherits when its own access
 * state is `INHERIT`. Throws {@link NotFoundError} when the Organization does
 * not exist.
 */
export async function setOrganizationAccessState(
  actor: AuthContext,
  id: string,
  accessState: AccessState,
  db: QueryExecutor,
): Promise<Organization> {
  requireCapability(actor, {
    capability: 'organization.setAccessState',
    scope: { kind: 'organization', organizationId: id },
  });

  const rows = await db.query<OrganizationRow>(
    `UPDATE organization SET access_state = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, accessState],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Organization '${id}' not found`);
  }
  return toOrganization(row);
}

/**
 * Delete an Organization grouping (Admin only). Returns `true` when a row was
 * removed, `false` when no Organization had that id. (The database cascades the
 * grouping's Writing Types; a Writing Type that still scopes Documents is
 * RESTRICTed at the DB level — the confirmation/impact flow for that case is
 * task 5.2.)
 */
export async function deleteOrganization(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  requireCapability(actor, {
    capability: 'organization.manage',
    scope: { kind: 'organization', organizationId: id },
  });

  const rows = await db.query<{ id: string }>(
    'DELETE FROM organization WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
