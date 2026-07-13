/**
 * Document-Type conventions and prompt content (REQ-CONFIG-CONV-01 /
 * Requirement 24, REQ-PROMPT-DOCTYPE-01 / Requirement 25, REQ-PROMPT-EDIT-01
 * / Requirement 32; Tasks 12.1, 12.3).
 *
 * Stores each Document Type's tone, density, category-priority order, and
 * its own Department-Admin-authored prompt instruction text
 * ({@link DocumentTypeConfig.typePromptText}).
 *
 * **Edit boundary** (design.md "Edit boundary", resolves CONFLICT-4): a
 * DepartmentAdmin may edit this record ONLY for Document Types within
 * Department(s) they administer (`documentType.modifyConfig`). System-level
 * scaffolding (system instructions, model configuration, guardrail
 * templates — `wren_engine.prompt_assembly.SystemScaffolding`) is owned
 * exclusively by the Technical Admin, is READ-ONLY to Department Admins, and
 * always takes precedence over this record's content when the Feedback
 * Engine assembles a prompt. This module therefore exposes NO write path for
 * system scaffolding at all — there is no capability that would allow a
 * DepartmentAdmin (or anyone) to modify it through this service.
 *
 * **Save-time no-ghostwriting guardrail** (Requirement 32.5): every write to
 * `typePromptText` is scanned by {@link assertGhostwritingFree} BEFORE the
 * database is touched. A violation throws {@link PromptGuardrailError}
 * (identifying the offending instruction) and the write does not happen —
 * consistent with the "deny with no mutation" pattern used by capability
 * checks elsewhere in the Admin_Service.
 *
 * `updatedAt` drives the Feedback Engine's carry-forward cache invalidation
 * (`wren_engine.carry_forward.ConfigSnapshot`) — any successful write here
 * updates it, so previously cached feedback for the Document Type is
 * invalidated on the next generation cycle (Requirement 27.3).
 */
import {
  updateDocumentTypeConfigInputSchema,
  documentTypeConfigSchema,
  type AuthContext,
  type DocumentTypeConfig,
  type UpdateDocumentTypeConfigInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';
import { assertGhostwritingFree } from './promptGuardrail';

/** Raw `document_type_config` row (snake_case columns from PostgreSQL). */
interface DocumentTypeConfigRow {
  readonly document_type_id: string;
  readonly tone: string | null;
  readonly density: string | null;
  readonly category_priority: string[];
  readonly type_prompt_text: string | null;
  readonly updated_at: string | Date;
}

const RETURNING =
  'document_type_id, tone, density, category_priority, type_prompt_text, updated_at';

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Map a raw row to the validated shared {@link DocumentTypeConfig} DTO. */
function toDocumentTypeConfig(row: DocumentTypeConfigRow): DocumentTypeConfig {
  return documentTypeConfigSchema.parse({
    documentTypeId: row.document_type_id,
    tone: row.tone,
    density: row.density,
    categoryPriority: row.category_priority ?? [],
    typePromptText: row.type_prompt_text,
    updatedAt: toIsoString(row.updated_at),
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
 * Read a Document Type's conventions/prompt config, or `null` if it does not
 * exist (a Document Type with no config row yet, before its first edit).
 * Readable by any DepartmentAdmin administering the Document Type's
 * Department (`documentType.readConfig`) — read access does not itself
 * expose system scaffolding, which lives entirely outside this record.
 */
export async function getDocumentTypeConfig(
  actor: AuthContext,
  documentTypeId: string,
  db: QueryExecutor,
): Promise<DocumentTypeConfig | null> {
  const departmentId = await findDepartmentId(documentTypeId, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${documentTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.readConfig',
    scope: { kind: 'documentType', documentTypeId, departmentId },
  });

  const rows = await db.query<DocumentTypeConfigRow>(
    `SELECT ${RETURNING} FROM document_type_config WHERE document_type_id = $1`,
    [documentTypeId],
  );
  const row = rows[0];
  return row ? toDocumentTypeConfig(row) : null;
}

/**
 * Create/update a Document Type's tone/density/category-priority/prompt
 * config (`DepartmentAdmin` for the administering Department only —
 * `documentType.modifyConfig`). Upserts: the first call for a Document Type
 * creates its config row; subsequent calls apply a partial update.
 *
 * When `typePromptText` is part of the patch, it is validated by
 * {@link assertGhostwritingFree} BEFORE any database write — a violation
 * throws {@link PromptGuardrailError} and performs NO mutation
 * (Requirement 32.5, 32.8).
 */
export async function upsertDocumentTypeConfig(
  actor: AuthContext,
  documentTypeId: string,
  input: UpdateDocumentTypeConfigInput,
  db: QueryExecutor,
): Promise<DocumentTypeConfig> {
  const patch = updateDocumentTypeConfigInputSchema.parse(input);

  const departmentId = await findDepartmentId(documentTypeId, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${documentTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'documentType.modifyConfig',
    scope: { kind: 'documentType', documentTypeId, departmentId },
  });

  // Save-time no-ghostwriting guardrail — validated BEFORE any DB write, so a
  // rejected save leaves the previously persisted config entirely untouched.
  if (patch.typePromptText !== undefined && patch.typePromptText !== null) {
    assertGhostwritingFree(patch.typePromptText);
  }

  const rows = await db.query<DocumentTypeConfigRow>(
    `INSERT INTO document_type_config (document_type_id, tone, density, category_priority, type_prompt_text, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (document_type_id) DO UPDATE SET
       tone = COALESCE($2, document_type_config.tone),
       density = COALESCE($3, document_type_config.density),
       category_priority = COALESCE($4, document_type_config.category_priority),
       type_prompt_text = CASE WHEN $6 THEN $5 ELSE document_type_config.type_prompt_text END,
       updated_at = now()
     RETURNING ${RETURNING}`,
    [
      documentTypeId,
      patch.tone ?? null,
      patch.density ?? null,
      patch.categoryPriority ? JSON.stringify(patch.categoryPriority) : null,
      patch.typePromptText ?? null,
      patch.typePromptText !== undefined,
    ],
  );

  return toDocumentTypeConfig(rows[0]!);
}
