/**
 * Document-Type-scoped Reference Material management (REQ-REFMAT-MGMT-01 /
 * Requirement 26; Task 12.5).
 *
 * Manages the two-tier Reference Material catalog rows: Department-wide
 * (tier 1) and Document-Type-scoped (tier 2) entries, each supplied as a
 * file, pasted text, or rich HTML (Requirement 26.1).
 *
 * This service manages the CATALOG row only.The
 * Feedback Engine reads the UTF-8 text objects under the reference bucket's
 * `document-types/{documentTypeId}/` prefix and places them in the prompt,
 * capped by `wren_engine.debrief_budget`.
 *
 * **No partial persistence** (Requirement 26.4, 26.5): the content-kind /
 * content-source pairing (`file` -> `s3Key`, `text`|`html` -> `inlineContent`)
 * is validated BEFORE any row is inserted, so an invalid upload never leaves
 * a half-written catalog row for the caller's upload-loading/error-state UI
 * to reconcile.
 *
 * **Visibility scoping** (Requirement 26.6): tier-1 (department-wide)
 * entries are visible/manageable by any DepartmentAdmin administering that
 * Department; tier-2 (Document-Type-scoped) entries are visible/manageable
 * only by DepartmentAdmins administering the Document Type's Department —
 * enforced by an explicit DepartmentAdmin role-and-owning-Department check,
 * followed by the normal `documentType.modifyConfig` /
 * `documentType.manageCatalog` capability check. TechnicalAdmin is deliberately
 * not a superuser fallback for educational Reference Material.
 *
 * Every mutation re-checks the relevant capability BEFORE touching the
 * database and denies with no mutation when disallowed (Requirements 36.2,
 * 36.3).
 */
import {
  createReferenceMaterialInputSchema,
  referenceMaterialSchema,
  type AuthContext,
  type CreateReferenceMaterialInput,
  type ReferenceMaterial,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { AuthorizationError, NotFoundError } from './errors';

/**
 * Reference Material is educational content, so mutation requires an explicit
 * DepartmentAdmin appointment for the owning Department. This additional
 * role-and-scope check prevents TechnicalAdmin capabilities from acting as a
 * superuser fallback while still allowing a mixed-role actor through their
 * correctly scoped DepartmentAdmin appointment.
 */
function requireReferenceMaterialDepartmentAdmin(
  actor: AuthContext,
  departmentId: string,
): void {
  if (
    !actor.roles.includes('DepartmentAdmin') ||
    !actor.administeredDepartmentIds.includes(departmentId)
  ) {
    throw new AuthorizationError(
      `Reference Material mutation requires DepartmentAdmin scope for Department '${departmentId}'`,
    );
  }
}

/** Raw `reference_material` row (snake_case columns from PostgreSQL). */
interface ReferenceMaterialRow {
  readonly id: string;
  readonly tier: 'department' | 'type';
  readonly department_id: string;
  readonly document_type_id: string | null;
  readonly title: string;
  readonly section: string | null;
  readonly content_kind: 'file' | 'text' | 'html';
  readonly s3_key: string | null;
  readonly inline_content: string | null;
}

const RETURNING =
  'id, tier, department_id, document_type_id, title, section, content_kind, s3_key, inline_content';

/** Map a raw row to the validated shared {@link ReferenceMaterial} DTO. */
function toReferenceMaterial(row: ReferenceMaterialRow): ReferenceMaterial {
  return referenceMaterialSchema.parse({
    id: row.id,
    tier: row.tier,
    departmentId: row.department_id,
    documentTypeId: row.document_type_id,
    title: row.title,
    section: row.section,
    contentKind: row.content_kind,
    s3Key: row.s3_key,
    inlineContent: row.inline_content,
  });
}

/**
 * Validate that the content-kind and content-source fields are consistently
 * paired BEFORE any persistence is attempted (Requirement 26.4, 26.5 — no
 * partial persistence on a mismatched or incomplete upload).
 */
function assertContentSourceMatchesKind(input: CreateReferenceMaterialInput): void {
  if (input.contentKind === 'file') {
    if (!input.s3Key || input.s3Key.trim() === '') {
      throw new Error("s3Key is required when contentKind is 'file'");
    }
  } else {
    // 'text' | 'html'
    if (!input.inlineContent || input.inlineContent.trim() === '') {
      throw new Error(`inlineContent is required when contentKind is '${input.contentKind}'`);
    }
  }
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

/**
 * Create a Reference Material catalog entry. Tier 1 (department-wide)
 * requires `documentType.modifyConfig`-equivalent Department-level
 * authority — modeled here as `documentType.manageCatalog` scoped to the
 * Department, matching the "DepartmentAdmin administering that Department"
 * rule for department-wide material. Tier 2 (Document-Type-scoped) requires
 * `documentType.modifyConfig` scoped to that Document Type.
 *
 * Content-kind/content-source pairing is validated FIRST (Requirement 26.4,
 * 26.5): a mismatched upload throws before any capability check or database
 * write, so the caller's upload UI can surface a validation error without
 * ever creating a half-written row.
 */
export async function createReferenceMaterial(
  actor: AuthContext,
  input: CreateReferenceMaterialInput,
  db: QueryExecutor,
): Promise<ReferenceMaterial> {
  const parsed = createReferenceMaterialInputSchema.parse(input);
  assertContentSourceMatchesKind(parsed);

  if (parsed.tier === 'type') {
    if (!parsed.documentTypeId) {
      throw new Error("documentTypeId is required when tier is 'type'");
    }
    const departmentId = await findDepartmentIdForDocumentType(parsed.documentTypeId, db);
    if (departmentId === null) {
      throw new NotFoundError(`Document Type '${parsed.documentTypeId}' not found`);
    }
    if (departmentId !== parsed.departmentId) {
      throw new Error(
        `documentTypeId '${parsed.documentTypeId}' does not belong to departmentId '${parsed.departmentId}'`,
      );
    }

    requireReferenceMaterialDepartmentAdmin(actor, departmentId);
    requireCapability(actor, {
      capability: 'documentType.modifyConfig',
      scope: { kind: 'documentType', documentTypeId: parsed.documentTypeId, departmentId },
    });
  } else {
    // tier === 'department': department-wide baseline material.
    requireReferenceMaterialDepartmentAdmin(actor, parsed.departmentId);
    requireCapability(actor, {
      capability: 'documentType.manageCatalog',
      scope: { kind: 'department', departmentId: parsed.departmentId },
    });
  }

  const rows = await db.query<ReferenceMaterialRow>(
    `INSERT INTO reference_material
       (tier, department_id, document_type_id, title, section, content_kind, s3_key, inline_content)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${RETURNING}`,
    [
      parsed.tier,
      parsed.departmentId,
      parsed.documentTypeId ?? null,
      parsed.title,
      parsed.section ?? null,
      parsed.contentKind,
      parsed.s3Key ?? null,
      parsed.inlineContent ?? null,
    ],
  );

  return toReferenceMaterial(rows[0]!);
}

/** Read a single Reference Material entry by id, or `null` when it does not exist. */
export async function getReferenceMaterial(
  id: string,
  db: QueryExecutor,
): Promise<ReferenceMaterial | null> {
  const rows = await db.query<ReferenceMaterialRow>(
    `SELECT ${RETURNING} FROM reference_material WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toReferenceMaterial(row) : null;
}

/** List a Department's tier-1 (department-wide) Reference Material, ordered by title. */
export async function listDepartmentReferenceMaterial(
  departmentId: string,
  db: QueryExecutor,
): Promise<ReferenceMaterial[]> {
  const rows = await db.query<ReferenceMaterialRow>(
    `SELECT ${RETURNING} FROM reference_material WHERE tier = 'department' AND department_id = $1 ORDER BY title ASC`,
    [departmentId],
  );
  return rows.map(toReferenceMaterial);
}

/** List a Document Type's tier-2 (type-scoped) Reference Material, ordered by title. */
export async function listDocumentTypeReferenceMaterial(
  documentTypeId: string,
  db: QueryExecutor,
): Promise<ReferenceMaterial[]> {
  const rows = await db.query<ReferenceMaterialRow>(
    `SELECT ${RETURNING} FROM reference_material WHERE tier = 'type' AND document_type_id = $1 ORDER BY title ASC`,
    [documentTypeId],
  );
  return rows.map(toReferenceMaterial);
}

/**
 * Delete a Reference Material entry (`DepartmentAdmin` for the owning
 * Department, scoped per tier as in {@link createReferenceMaterial}).
 * Returns `true` when a row was removed, `false` when no entry had that id.
 * Removing the catalog row does not delete any underlying S3 object.
 */
export async function deleteReferenceMaterial(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  const existing = await getReferenceMaterial(id, db);
  if (existing === null) {
    return false;
  }

  if (existing.tier === 'type' && existing.documentTypeId) {
    requireReferenceMaterialDepartmentAdmin(actor, existing.departmentId);
    requireCapability(actor, {
      capability: 'documentType.modifyConfig',
      scope: {
        kind: 'documentType',
        documentTypeId: existing.documentTypeId,
        departmentId: existing.departmentId,
      },
    });
  } else {
    requireReferenceMaterialDepartmentAdmin(actor, existing.departmentId);
    requireCapability(actor, {
      capability: 'documentType.manageCatalog',
      scope: { kind: 'department', departmentId: existing.departmentId },
    });
  }

  const rows = await db.query<{ id: string }>(
    'DELETE FROM reference_material WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
