/**
 * DepartmentAdmin-defined Content Types, scoped to a Document Type
 * (REQ-ORG-CONFIG-01 / Requirement 30.2).
 *
 * A Content Type (e.g. "case brief", "memo", "tort claim proposal") organizes
 * Document submissions within a Document Type and scopes configuration.
 * Business management of the catalog — including Content Types — reuses the
 * existing `documentType.manageCatalog` capability (DepartmentAdmin within an
 * administered Department); there is deliberately NO separate capability for
 * Content Types, matching the capability matrix's documented scope.
 *
 * TechnicalAdmin may use this same capability for explicit platform catalog
 * bootstrap. This does not grant Topic, Access Grant, Department, or Reference
 * Material authority.
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
  readonly document_type_id: string;
  readonly label: string;
}

const RETURNING = 'id, document_type_id, label';

/** Map a raw row to the validated shared {@link ContentType} DTO. */
function toContentType(row: ContentTypeRow): ContentType {
  return contentTypeSchema.parse({
    id: row.id,
    documentTypeId: row.document_type_id,
    label: row.label,
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
 * Create a Content Type within a Document Type (`DepartmentAdmin` for
 * administered Departments). Throws {@link NotFoundError} when the Document
 * Type does not exist.
 */
export async function createContentType(
  actor: AuthContext,
  input: CreateContentTypeInput,
  db: QueryExecutor,
): Promise<ContentType> {
  const { documentTypeId, label } = createContentTypeInputSchema.parse(input);

  const departmentId = await findDepartmentId(documentTypeId, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${documentTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.manageCatalog',
    scope: { kind: 'documentType', documentTypeId, departmentId },
  });

  const rows = await db.query<ContentTypeRow>(
    `INSERT INTO content_type (document_type_id, label) VALUES ($1, $2) RETURNING ${RETURNING}`,
    [documentTypeId, label],
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

/** List the Content Types for one Document Type, ordered by label. */
export async function listContentTypes(
  documentTypeId: string,
  db: QueryExecutor,
): Promise<ContentType[]> {
  const rows = await db.query<ContentTypeRow>(
    `SELECT ${RETURNING} FROM content_type WHERE document_type_id = $1 ORDER BY label ASC`,
    [documentTypeId],
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

  const departmentId = await findDepartmentId(existing.document_type_id, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${existing.document_type_id}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.manageCatalog',
    scope: { kind: 'documentType', documentTypeId: existing.document_type_id, departmentId },
  });

  const rows = await db.query<ContentTypeRow>(
    `UPDATE content_type SET label = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, label],
  );
  return toContentType(rows[0]!);
}

/**
 * Delete a Content Type (`DepartmentAdmin` for administered Departments).
 * Returns `true` when a row was removed, `false` when no Content Type had
 * that id.
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

  const departmentId = await findDepartmentId(existing.document_type_id, db);
  if (departmentId === null) {
    return false;
  }

  requireCapability(actor, {
    capability: 'documentType.manageCatalog',
    scope: { kind: 'documentType', documentTypeId: existing.document_type_id, departmentId },
  });

  const rows = await db.query<{ id: string }>(
    'DELETE FROM content_type WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
