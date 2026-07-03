/**
 * Configurable Writing Type catalog (REQ-ORG-CONFIG-01 / Requirement 30.1;
 * REQ-ADMIN-FEATURES-01 / Requirement 33.2; product decision 2 in tasks.md).
 *
 * A Writing Type is configurable, self-selectable DATA — a catalog row an
 * `Org Owner` maintains within Organizations they own — NEVER a hardcoded domain
 * enumeration. Arbitrary new Writing Types can be added at runtime; nothing here
 * constrains their names to a fixed set.
 *
 * Two authority boundaries are enforced through the `@wren/auth` capability
 * matrix (never a parallel scheme):
 *
 *   - Catalog management (create / read / update / delete) → `writingType.
 *     manageCatalog`: an `Org Owner` within an owned Organization, or an `Admin`
 *     (Requirement 30.1).
 *   - OPEN / LOCKED / INHERIT access-state control → `organization.
 *     setAccessState`: an `Admin` (Requirement 28.4 / 33.2). Keeping access
 *     control distinct from catalog management is why new Writing Types are
 *     always created with `INHERIT` and only the Admin promotes them to a fixed
 *     OPEN/LOCKED state.
 *
 * Every mutation re-checks the capability BEFORE touching the database and
 * denies with no mutation when disallowed (Requirements 36.2, 36.3). All
 * persistence uses the injected parameterized {@link QueryExecutor}
 * (Requirement 39.2).
 */
import {
  createWritingTypeInputSchema,
  updateWritingTypeInputSchema,
  writingTypeDeletionImpactSchema,
  writingTypeSchema,
  type AuthContext,
  type CreateWritingTypeInput,
  type UpdateWritingTypeInput,
  type WritingType,
  type WritingTypeAccessState,
  type WritingTypeDeletionImpact,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `writing_type` row (snake_case columns from PostgreSQL). */
interface WritingTypeRow {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
  readonly access_state: WritingTypeAccessState;
  readonly size_limit_words: number | null;
}

const RETURNING = 'id, organization_id, name, access_state, size_limit_words';

/** Map a raw row to the validated shared {@link WritingType} DTO. */
function toWritingType(row: WritingTypeRow): WritingType {
  return writingTypeSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    accessState: row.access_state,
    sizeLimitWords: row.size_limit_words,
  });
}

/** Load a Writing Type's owning Organization id, or `null` when it is unknown. */
async function findOrganizationId(
  writingTypeId: string,
  db: QueryExecutor,
): Promise<string | null> {
  const rows = await db.query<{ organization_id: string }>(
    'SELECT organization_id FROM writing_type WHERE id = $1',
    [writingTypeId],
  );
  return rows[0]?.organization_id ?? null;
}

/**
 * Create a Writing Type catalog record within an Organization (`Org Owner` for
 * owned orgs, or `Admin`). New records always start with an `INHERIT` access
 * state (the DB default); promoting to OPEN/LOCKED is a separate, Admin-only
 * access-state operation ({@link setWritingTypeAccessState}).
 */
export async function createWritingType(
  actor: AuthContext,
  input: CreateWritingTypeInput,
  db: QueryExecutor,
): Promise<WritingType> {
  const { organizationId, name, sizeLimitWords } =
    createWritingTypeInputSchema.parse(input);

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'organization', organizationId },
  });

  const rows = await db.query<WritingTypeRow>(
    `INSERT INTO writing_type (organization_id, name, size_limit_words)
     VALUES ($1, $2, $3) RETURNING ${RETURNING}`,
    [organizationId, name, sizeLimitWords ?? null],
  );

  return toWritingType(rows[0]!);
}

/** Read a single Writing Type by id, or `null` when it does not exist. */
export async function getWritingType(
  id: string,
  db: QueryExecutor,
): Promise<WritingType | null> {
  const rows = await db.query<WritingTypeRow>(
    `SELECT ${RETURNING} FROM writing_type WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toWritingType(row) : null;
}

/** List the Writing Type catalog for one Organization, ordered by name. */
export async function listWritingTypes(
  organizationId: string,
  db: QueryExecutor,
): Promise<WritingType[]> {
  const rows = await db.query<WritingTypeRow>(
    `SELECT ${RETURNING} FROM writing_type WHERE organization_id = $1 ORDER BY name ASC`,
    [organizationId],
  );
  return rows.map(toWritingType);
}

/**
 * Update a Writing Type's mutable catalog fields (name and/or size limit). Access
 * state is intentionally NOT updatable here — use {@link setWritingTypeAccessState}.
 * Throws {@link NotFoundError} when the Writing Type does not exist.
 */
export async function updateWritingType(
  actor: AuthContext,
  id: string,
  input: UpdateWritingTypeInput,
  db: QueryExecutor,
): Promise<WritingType> {
  const patch = updateWritingTypeInputSchema.parse(input);

  const organizationId = await findOrganizationId(id, db);
  if (organizationId === null) {
    throw new NotFoundError(`Writing Type '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'writingType', writingTypeId: id, organizationId },
  });

  // Build a parameterized partial update from only the supplied fields.
  const assignments: string[] = [];
  const params: unknown[] = [id];
  if (patch.name !== undefined) {
    params.push(patch.name);
    assignments.push(`name = $${params.length}`);
  }
  if (patch.sizeLimitWords !== undefined) {
    params.push(patch.sizeLimitWords);
    assignments.push(`size_limit_words = $${params.length}`);
  }

  if (assignments.length === 0) {
    // No-op update: return the current record unchanged.
    const current = await getWritingType(id, db);
    if (!current) {
      throw new NotFoundError(`Writing Type '${id}' not found`);
    }
    return current;
  }

  const rows = await db.query<WritingTypeRow>(
    `UPDATE writing_type SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${RETURNING}`,
    params,
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Writing Type '${id}' not found`);
  }
  return toWritingType(row);
}

/**
 * Set a Writing Type's access state to OPEN, LOCKED, or INHERIT (Admin only,
 * Requirement 28.4 / 33.2). INHERIT defers to the owning Organization's
 * OPEN/LOCKED default. Throws {@link NotFoundError} when the Writing Type does
 * not exist.
 */
export async function setWritingTypeAccessState(
  actor: AuthContext,
  id: string,
  accessState: WritingTypeAccessState,
  db: QueryExecutor,
): Promise<WritingType> {
  const organizationId = await findOrganizationId(id, db);
  if (organizationId === null) {
    throw new NotFoundError(`Writing Type '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'organization.setAccessState',
    scope: { kind: 'writingType', writingTypeId: id, organizationId },
  });

  const rows = await db.query<WritingTypeRow>(
    `UPDATE writing_type SET access_state = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, accessState],
  );
  return toWritingType(rows[0]!);
}

/**
 * Count `role_assignment` rows scoping a `Field Expert` to `writingTypeId` (the
 * `scope` column is JSONB shaped `{writingTypeIds: [...]}` for that role — see
 * `@wren/auth` `identityMapping.ts`). Used only for the read-only deletion-impact
 * report; never for authorization.
 */
async function countAssignedFieldExperts(
  writingTypeId: string,
  db: QueryExecutor,
): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM role_assignment
     WHERE role = 'Field Expert' AND scope -> 'writingTypeIds' ? $1`,
    [writingTypeId],
  );
  return rows[0]?.count ?? 0;
}

/** Count `document` rows scoped to `writingTypeId`. */
async function countDocuments(writingTypeId: string, db: QueryExecutor): Promise<number> {
  const rows = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM document WHERE writing_type_id = $1',
    [writingTypeId],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Report the impact of removing a Writing Type — counts of assigned Field
 * Experts and Documents — BEFORE any deletion, so the caller can present an
 * explicit confirmation describing that impact (REQ-ORG-CONFIG-01 / Requirement
 * 30.5). This is read-only: it never deletes anything, and a Writing Type that
 * still has Documents remains RESTRICTed at the DB level regardless of this
 * report. Throws {@link NotFoundError} when the Writing Type does not exist.
 */
export async function getWritingTypeDeletionImpact(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<WritingTypeDeletionImpact> {
  const organizationId = await findOrganizationId(id, db);
  if (organizationId === null) {
    throw new NotFoundError(`Writing Type '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'writingType', writingTypeId: id, organizationId },
  });

  const [assignedFieldExpertCount, documentCount] = await Promise.all([
    countAssignedFieldExperts(id, db),
    countDocuments(id, db),
  ]);

  return writingTypeDeletionImpactSchema.parse({
    writingTypeId: id,
    assignedFieldExpertCount,
    documentCount,
  });
}

/**
 * Delete a Writing Type catalog record (`Org Owner` for owned orgs, or `Admin`).
 * Returns `true` when a row was removed, `false` when no Writing Type had that
 * id. Callers MUST first call {@link getWritingTypeDeletionImpact} and obtain
 * explicit confirmation when it reports any assigned Field Experts or Documents
 * (Requirement 30.5); this function itself performs no impact check and simply
 * attempts the delete — a Writing Type that still scopes Documents is
 * RESTRICTed at the DB level and the delete will fail/reject accordingly.
 */
export async function deleteWritingType(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  const organizationId = await findOrganizationId(id, db);
  if (organizationId === null) {
    return false;
  }

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'writingType', writingTypeId: id, organizationId },
  });

  const rows = await db.query<{ id: string }>(
    'DELETE FROM writing_type WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
