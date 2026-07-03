/**
 * Org-Owner-defined Content Types, scoped to a Writing Type (REQ-ORG-CONFIG-01 /
 * Requirement 30.2).
 *
 * A Content Type (e.g. "case brief", "memo", "tort claim proposal") organizes
 * Document submissions within a Writing Type and scopes configuration. Business
 * management of the catalog — including Content Types — reuses the existing
 * `writingType.manageCatalog` capability (Org Owner within an owned
 * Organization, or Admin); there is deliberately NO separate capability for
 * Content Types, matching the capability matrix's documented scope (`@wren/auth`
 * `capabilityMatrix.ts`: "Writing Type catalog, Content Types, and custom
 * metadata"). Business Topics are a distinct entity with their own
 * `topic.manage` capability (`topicService.ts`) — they are never part of the
 * Writing Type catalog.
 *
 * Every mutation re-checks the capability BEFORE touching the database and
 * denies with no mutation when disallowed (Requirements 36.2, 36.3). All
 * persistence uses the injected parameterized {@link QueryExecutor}
 * (Requirement 39.2).
 */
import {
  contentTypeSchema,
  createContentTypeInputSchema,
  updateContentTypeInputSchema,
  type AuthContext,
  type ContentType,
  type CreateContentTypeInput,
  type UpdateContentTypeInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `content_type` row (snake_case columns from PostgreSQL). */
interface ContentTypeRow {
  readonly id: string;
  readonly writing_type_id: string;
  readonly label: string;
}

const RETURNING = 'id, writing_type_id, label';

/** Map a raw row to the validated shared {@link ContentType} DTO. */
function toContentType(row: ContentTypeRow): ContentType {
  return contentTypeSchema.parse({
    id: row.id,
    writingTypeId: row.writing_type_id,
    label: row.label,
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
 * Create a Content Type within a Writing Type (`Org Owner` for owned orgs, or
 * `Admin`). Throws {@link NotFoundError} when the Writing Type does not exist.
 */
export async function createContentType(
  actor: AuthContext,
  input: CreateContentTypeInput,
  db: QueryExecutor,
): Promise<ContentType> {
  const { writingTypeId, label } = createContentTypeInputSchema.parse(input);

  const organizationId = await findOrganizationId(writingTypeId, db);
  if (organizationId === null) {
    throw new NotFoundError(`Writing Type '${writingTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'writingType', writingTypeId, organizationId },
  });

  const rows = await db.query<ContentTypeRow>(
    `INSERT INTO content_type (writing_type_id, label) VALUES ($1, $2) RETURNING ${RETURNING}`,
    [writingTypeId, label],
  );

  return toContentType(rows[0]!);
}

/** Read a single Content Type by id, or `null` when it does not exist. */
export async function getContentType(
  id: string,
  db: QueryExecutor,
): Promise<ContentType | null> {
  const rows = await db.query<ContentTypeRow>(
    `SELECT ${RETURNING} FROM content_type WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toContentType(row) : null;
}

/** List the Content Types for one Writing Type, ordered by label. */
export async function listContentTypes(
  writingTypeId: string,
  db: QueryExecutor,
): Promise<ContentType[]> {
  const rows = await db.query<ContentTypeRow>(
    `SELECT ${RETURNING} FROM content_type WHERE writing_type_id = $1 ORDER BY label ASC`,
    [writingTypeId],
  );
  return rows.map(toContentType);
}

/**
 * Update a Content Type's mutable field (its label). Throws
 * {@link NotFoundError} when the Content Type does not exist.
 */
export async function updateContentType(
  actor: AuthContext,
  id: string,
  input: UpdateContentTypeInput,
  db: QueryExecutor,
): Promise<ContentType> {
  const { label } = updateContentTypeInputSchema.parse(input);

  const existingRows = await db.query<ContentTypeRow>(
    `SELECT ${RETURNING} FROM content_type WHERE id = $1`,
    [id],
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new NotFoundError(`Content Type '${id}' not found`);
  }

  const organizationId = await findOrganizationId(existing.writing_type_id, db);
  if (organizationId === null) {
    throw new NotFoundError(`Writing Type '${existing.writing_type_id}' not found`);
  }

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'writingType', writingTypeId: existing.writing_type_id, organizationId },
  });

  const rows = await db.query<ContentTypeRow>(
    `UPDATE content_type SET label = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, label],
  );
  return toContentType(rows[0]!);
}

/**
 * Delete a Content Type (`Org Owner` for owned orgs, or `Admin`). Returns
 * `true` when a row was removed, `false` when no Content Type had that id.
 * Documents referencing this Content Type have their reference cleared
 * (`ON DELETE SET NULL` at the DB level) — deletion is never blocked by
 * Document references.
 */
export async function deleteContentType(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  const existingRows = await db.query<ContentTypeRow>(
    `SELECT ${RETURNING} FROM content_type WHERE id = $1`,
    [id],
  );
  const existing = existingRows[0];
  if (!existing) {
    return false;
  }

  const organizationId = await findOrganizationId(existing.writing_type_id, db);
  if (organizationId === null) {
    return false;
  }

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'writingType', writingTypeId: existing.writing_type_id, organizationId },
  });

  const rows = await db.query<{ id: string }>(
    'DELETE FROM content_type WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
