/**
 * Configurable Document Type catalog (REQ-ORG-CONFIG-01 / Requirement 30.1;
 * REQ-ADMIN-FEATURES-01 / Requirement 33.2; product decision 2 in tasks.md).
 *
 * A Document Type is configurable, self-selectable DATA — a catalog row a
 * `DepartmentAdmin` maintains within Departments they administer — NEVER a
 * hardcoded domain enumeration. Arbitrary new Document Types can be added at
 * runtime; nothing here constrains their names to a fixed set.
 *
 * Two authority boundaries are enforced through the `@wren/auth` capability
 * matrix (never a parallel scheme):
 *
 *   - Catalog management (create / read / update / delete) →
 *     `documentType.manageCatalog`: a `DepartmentAdmin` within an administered
 *     Department (Requirement 30.1).
 *   - OPEN / LOCKED access-state control → `documentType.setAccessState`:
 *     `TechnicalAdmin` only (Requirement 28.4 / 33.2). This is a
 *     platform-level operation, not an educational one — a `DepartmentAdmin`
 *     may manage the catalog but may NOT change a Document Type's access
 *     state.
 *
 * No superuser fallback — TechnicalAdmin CANNOT perform educational
 * (catalog-management) operations; the reverse also holds: DepartmentAdmin
 * cannot perform the platform-level access-state operation above.
 *
 * Every mutation re-checks the capability BEFORE touching the database and
 * denies with no mutation when disallowed (Requirements 36.2, 36.3). All
 * persistence uses the injected parameterized {@link QueryExecutor}
 * (Requirement 39.2).
 */
import {
  createDocumentTypeInputSchema,
  documentTypeDeletionImpactSchema,
  documentTypeSchema,
  updateDocumentTypeInputSchema,
  type AuthContext,
  type CreateDocumentTypeInput,
  type DocumentType,
  type DocumentTypeAccessState,
  type DocumentTypeDeletionImpact,
  type UpdateDocumentTypeInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `document_type` row (snake_case columns from PostgreSQL). */
interface DocumentTypeRow {
  readonly id: string;
  readonly department_id: string;
  readonly name: string;
  readonly access_state: DocumentTypeAccessState;
  readonly size_limit_words: number | null;
}

const RETURNING = 'id, department_id, name, access_state, size_limit_words';

/** Map a raw row to the validated shared {@link DocumentType} DTO. */
function toDocumentType(row: DocumentTypeRow): DocumentType {
  return documentTypeSchema.parse({
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    accessState: row.access_state,
    sizeLimitWords: row.size_limit_words,
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
 * Create a Document Type catalog record within a Department (`DepartmentAdmin`
 * for administered Departments). New records always start with a `LOCKED`
 * access state (the DB default); promoting to OPEN is a separate access-state
 * operation ({@link setDocumentTypeAccessState}).
 */
export async function createDocumentType(
  actor: AuthContext,
  input: CreateDocumentTypeInput,
  db: QueryExecutor,
): Promise<DocumentType> {
  const { departmentId, name, sizeLimitWords } =
    createDocumentTypeInputSchema.parse(input);

  requireCapability(actor, {
    capability: 'documentType.manageCatalog',
    scope: { kind: 'department', departmentId },
  });

  const rows = await db.query<DocumentTypeRow>(
    `INSERT INTO document_type (department_id, name, size_limit_words)
     VALUES ($1, $2, $3) RETURNING ${RETURNING}`,
    [departmentId, name, sizeLimitWords ?? null],
  );

  return toDocumentType(rows[0]!);
}

/** Read a single Document Type by id, or `null` when it does not exist. */
export async function getDocumentType(
  id: string,
  db: QueryExecutor,
): Promise<DocumentType | null> {
  const rows = await db.query<DocumentTypeRow>(
    `SELECT ${RETURNING} FROM document_type WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toDocumentType(row) : null;
}

/** List the Document Type catalog for one Department, ordered by name. */
export async function listDocumentTypes(
  departmentId: string,
  db: QueryExecutor,
): Promise<DocumentType[]> {
  const rows = await db.query<DocumentTypeRow>(
    `SELECT ${RETURNING} FROM document_type WHERE department_id = $1 ORDER BY name ASC`,
    [departmentId],
  );
  return rows.map(toDocumentType);
}

/**
 * Update a Document Type's mutable catalog fields (name and/or size limit).
 * Access state is intentionally NOT updatable here — use
 * {@link setDocumentTypeAccessState}. Throws {@link NotFoundError} when the
 * Document Type does not exist.
 */
export async function updateDocumentType(
  actor: AuthContext,
  id: string,
  input: UpdateDocumentTypeInput,
  db: QueryExecutor,
): Promise<DocumentType> {
  const patch = updateDocumentTypeInputSchema.parse(input);

  const departmentId = await findDepartmentId(id, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.manageCatalog',
    scope: { kind: 'documentType', documentTypeId: id, departmentId },
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
    const current = await getDocumentType(id, db);
    if (!current) {
      throw new NotFoundError(`Document Type '${id}' not found`);
    }
    return current;
  }

  const rows = await db.query<DocumentTypeRow>(
    `UPDATE document_type SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${RETURNING}`,
    params,
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Document Type '${id}' not found`);
  }
  return toDocumentType(row);
}

/**
 * Set a Document Type's access state to OPEN or LOCKED (TechnicalAdmin only —
 * a platform-level operation, not delegated to DepartmentAdmin). Throws
 * {@link NotFoundError} when the Document Type does not exist.
 */
export async function setDocumentTypeAccessState(
  actor: AuthContext,
  id: string,
  accessState: DocumentTypeAccessState,
  db: QueryExecutor,
): Promise<DocumentType> {
  const departmentId = await findDepartmentId(id, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.setAccessState',
    scope: { kind: 'documentType', documentTypeId: id, departmentId },
  });

  const rows = await db.query<DocumentTypeRow>(
    `UPDATE document_type SET access_state = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, accessState],
  );
  return toDocumentType(rows[0]!);
}

/** Count `document` rows scoped to `documentTypeId`. */
async function countDocuments(documentTypeId: string, db: QueryExecutor): Promise<number> {
  const rows = await db.query<{ count: number }>(
    'SELECT COUNT(*)::int AS count FROM document WHERE document_type_id = $1',
    [documentTypeId],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Report the impact of removing a Document Type — count of Documents — BEFORE
 * any deletion, so the caller can present an explicit confirmation describing
 * that impact (REQ-ORG-CONFIG-01 / Requirement 30.5). This is read-only: it
 * never deletes anything, and a Document Type that still has Documents remains
 * RESTRICTed at the DB level regardless of this report. Throws
 * {@link NotFoundError} when the Document Type does not exist.
 */
export async function getDocumentTypeDeletionImpact(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<DocumentTypeDeletionImpact> {
  const departmentId = await findDepartmentId(id, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.manageCatalog',
    scope: { kind: 'documentType', documentTypeId: id, departmentId },
  });

  const documentCount = await countDocuments(id, db);

  return documentTypeDeletionImpactSchema.parse({
    documentTypeId: id,
    documentCount,
  });
}

/**
 * Delete a Document Type catalog record (`DepartmentAdmin` for administered
 * Departments). Returns `true` when a row was removed, `false` when no
 * Document Type had that id. Callers MUST first call
 * {@link getDocumentTypeDeletionImpact} and obtain explicit confirmation when
 * it reports Documents (Requirement 30.5); this function itself performs no
 * impact check and simply attempts the delete — a Document Type that still
 * scopes Documents is RESTRICTed at the DB level and the delete will
 * fail/reject accordingly.
 */
export async function deleteDocumentType(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  const departmentId = await findDepartmentId(id, db);
  if (departmentId === null) {
    return false;
  }

  requireCapability(actor, {
    capability: 'documentType.manageCatalog',
    scope: { kind: 'documentType', documentTypeId: id, departmentId },
  });

  const rows = await db.query<{ id: string }>(
    'DELETE FROM document_type WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
