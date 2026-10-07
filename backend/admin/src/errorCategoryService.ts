/**
 * Document-Type-scoped error taxonomy (REQ-TAXONOMY-01 / Requirement 15;
 * Task 12.1).
 *
 * Error categories are stored as DATA, never an enum (Requirement 15.1),
 * scoped to one Document Type. A DepartmentAdmin who administers that
 * Document Type's Department may add/remove/rename categories
 * (Requirement 15.2). Rename updates only `name`; `id` — the value Feedback
 * Items classify against — never changes, so an existing Feedback Item's
 * classification survives a rename (Requirement 15.3, Property 15).
 *
 * `internalGuidance` is a Feedback-Engine prompt-assembly detection aid ONLY
 * (`wren_engine.prompt_assembly` consumes it as part of the Document-Type
 * inner layer) — it must NEVER be surfaced to a Student (Requirement 15.4 /
 * REQ-CORE-NOGHOST-01). Callers building a Student-facing response must
 * project only `{id, name}` and omit `internalGuidance` and
 * `documentTypeId` is safe to keep (it identifies scope, not detection
 * guidance).
 *
 * **Save-time prompt-injection guardrail**: because `internalGuidance` is
 * folded into the Feedback Engine's trusted (undelimited) Document-Type
 * configuration block, every write to it is screened by
 * {@link assertPromptInjectionFree} BEFORE the database is touched. A flagged
 * value throws and the write does not happen — the same "deny with no
 * mutation" posture used for the capability checks and for the sibling prompt
 * fields in {@link upsertDocumentTypeConfig}.
 *
 * Every mutation re-checks the `documentType.modifyConfig` capability
 * BEFORE touching the database and denies with no mutation when disallowed
 * (Requirements 36.2, 36.3). Adding/removing/renaming a category updates the
 * owning Document Type's `document_type_config.updated_at`, which drives the
 * Feedback Engine's carry-forward cache invalidation (Requirement 27.3).
 */
import {
  createErrorCategoryInputSchema,
  errorCategorySchema,
  updateErrorCategoryInputSchema,
  type AuthContext,
  type CreateErrorCategoryInput,
  type ErrorCategory,
  type UpdateErrorCategoryInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';
import { assertPromptInjectionFree } from './promptGuardrail';

/** Raw `error_category` row (snake_case columns from PostgreSQL). */
interface ErrorCategoryRow {
  readonly id: string;
  readonly document_type_id: string;
  readonly name: string;
  readonly internal_guidance: string | null;
}

const RETURNING = 'id, document_type_id, name, internal_guidance';

/** Map a raw row to the validated shared {@link ErrorCategory} DTO. */
function toErrorCategory(row: ErrorCategoryRow): ErrorCategory {
  return errorCategorySchema.parse({
    id: row.id,
    documentTypeId: row.document_type_id,
    name: row.name,
    internalGuidance: row.internal_guidance,
  });
}

/** Load a Document Type's owning Department id, or `null` when it is unknown. */
async function findDepartmentIdForDocumentType(
  documentTypeId: string,
  db: QueryExecutor,
): Promise<string | null> {
  const rows = await db.query<{ department_id: string }>(
    'SELECT department_id FROM document_type WHERE id = $1',
    [documentTypeId],
  );
  return rows[0]?.department_id ?? null;
}

/** Load an error category's owning Document Type + Department ids. */
async function findScope(
  categoryId: string,
  db: QueryExecutor,
): Promise<{ documentTypeId: string; departmentId: string } | null> {
  const rows = await db.query<{ document_type_id: string }>(
    'SELECT document_type_id FROM error_category WHERE id = $1',
    [categoryId],
  );
  const documentTypeId = rows[0]?.document_type_id;
  if (!documentTypeId) return null;

  const departmentId = await findDepartmentIdForDocumentType(documentTypeId, db);
  if (!departmentId) return null;

  return { documentTypeId, departmentId };
}

/** Touch `document_type_config.updated_at` so carry-forward caching invalidates (Requirement 27.3). */
async function touchConfigUpdatedAt(documentTypeId: string, db: QueryExecutor): Promise<void> {
  await db.query(
    `INSERT INTO document_type_config (document_type_id, updated_at)
     VALUES ($1, now())
     ON CONFLICT (document_type_id) DO UPDATE SET updated_at = now()`,
    [documentTypeId],
  );
}

/**
 * Add a new error category to a Document Type's taxonomy (`DepartmentAdmin`
 * for the Department administering that Document Type).
 */
export async function createErrorCategory(
  actor: AuthContext,
  input: CreateErrorCategoryInput,
  db: QueryExecutor,
): Promise<ErrorCategory> {
  const { documentTypeId, name, internalGuidance } =
    createErrorCategoryInputSchema.parse(input);

  const departmentId = await findDepartmentIdForDocumentType(documentTypeId, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${documentTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.modifyConfig',
    scope: { kind: 'documentType', documentTypeId, departmentId },
  });

  // Screen the prompt-bearing field before any DB write (deny-with-no-mutation).
  if (typeof internalGuidance === 'string' && internalGuidance.trim().length > 0) {
    await assertPromptInjectionFree(internalGuidance);
  }

  const rows = await db.query<ErrorCategoryRow>(
    `INSERT INTO error_category (document_type_id, name, internal_guidance)
     VALUES ($1, $2, $3) RETURNING ${RETURNING}`,
    [documentTypeId, name, internalGuidance ?? null],
  );

  await touchConfigUpdatedAt(documentTypeId, db);

  return toErrorCategory(rows[0]!);
}

/** Read a single error category by id, or `null` when it does not exist. */
export async function getErrorCategory(
  id: string,
  db: QueryExecutor,
): Promise<ErrorCategory | null> {
  const rows = await db.query<ErrorCategoryRow>(
    `SELECT ${RETURNING} FROM error_category WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toErrorCategory(row) : null;
}

/** List a Document Type's taxonomy, ordered by name. */
export async function listErrorCategories(
  documentTypeId: string,
  db: QueryExecutor,
): Promise<ErrorCategory[]> {
  const rows = await db.query<ErrorCategoryRow>(
    `SELECT ${RETURNING} FROM error_category WHERE document_type_id = $1 ORDER BY name ASC`,
    [documentTypeId],
  );
  return rows.map(toErrorCategory);
}

/**
 * Rename and/or update the internal guidance of an error category. `id` is
 * immutable, so a rename NEVER breaks an existing Feedback Item's category
 * linkage (Requirement 15.3, Property 15). Throws {@link NotFoundError} when
 * the category does not exist.
 */
export async function updateErrorCategory(
  actor: AuthContext,
  id: string,
  input: UpdateErrorCategoryInput,
  db: QueryExecutor,
): Promise<ErrorCategory> {
  const patch = updateErrorCategoryInputSchema.parse(input);

  const scope = await findScope(id, db);
  if (scope === null) {
    throw new NotFoundError(`Error category '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.modifyConfig',
    scope: { kind: 'documentType', documentTypeId: scope.documentTypeId, departmentId: scope.departmentId },
  });

  // Screen the prompt-bearing field before any DB write (deny-with-no-mutation).
  if (typeof patch.internalGuidance === 'string' && patch.internalGuidance.trim().length > 0) {
    await assertPromptInjectionFree(patch.internalGuidance);
  }

  const assignments: string[] = [];
  const params: unknown[] = [id];
  if (patch.name !== undefined) {
    params.push(patch.name);
    assignments.push(`name = $${params.length}`);
  }
  if (patch.internalGuidance !== undefined) {
    params.push(patch.internalGuidance);
    assignments.push(`internal_guidance = $${params.length}`);
  }

  if (assignments.length === 0) {
    const current = await getErrorCategory(id, db);
    if (!current) {
      throw new NotFoundError(`Error category '${id}' not found`);
    }
    return current;
  }

  const rows = await db.query<ErrorCategoryRow>(
    `UPDATE error_category SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${RETURNING}`,
    params,
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Error category '${id}' not found`);
  }

  await touchConfigUpdatedAt(scope.documentTypeId, db);

  return toErrorCategory(row);
}

/**
 * Remove an error category from a Document Type's taxonomy
 * (`DepartmentAdmin` for the administering Department). Returns `true` when
 * a row was removed, `false` when no category had that id. Existing Feedback
 * Items that classified against this category id keep their historical
 * classification (removal never cascades into Feedback Item records).
 */
export async function deleteErrorCategory(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  const scope = await findScope(id, db);
  if (scope === null) {
    return false;
  }

  requireCapability(actor, {
    capability: 'documentType.modifyConfig',
    scope: { kind: 'documentType', documentTypeId: scope.documentTypeId, departmentId: scope.departmentId },
  });

  const rows = await db.query<{ id: string }>(
    'DELETE FROM error_category WHERE id = $1 RETURNING id',
    [id],
  );
  const deleted = rows.length > 0;
  if (deleted) {
    await touchConfigUpdatedAt(scope.documentTypeId, db);
  }
  return deleted;
}
