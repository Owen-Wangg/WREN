/**
 * Org-Owner-defined custom metadata fields, scoped to a Writing Type
 * (REQ-ORG-CONFIG-01 / Requirement 30.3). Each field carries a required/optional
 * flag enforced by the Document_Service at submission (Requirement 30.4).
 *
 * Product decision (tasks.md, top-of-file decision 1): ONLY "Writing Topic" is
 * ever seeded as the illustrative field. "Location Reference" is intentionally
 * never seeded anywhere in this service. {@link WRITING_TOPIC_LABEL} and
 * {@link seedWritingTopicField} are the single place that constant is written —
 * the mechanism itself remains fully configurable/arbitrary Org-Owner-defined
 * DATA; nothing here constrains field labels to a fixed set beyond this one
 * illustrative default.
 *
 * Business management of the catalog — including custom metadata fields —
 * reuses the existing `writingType.manageCatalog` capability (Org Owner within
 * an owned Organization, or Admin); there is deliberately NO separate
 * capability for custom metadata fields, matching the capability matrix's
 * documented scope (`@wren/auth` `capabilityMatrix.ts`).
 *
 * Every mutation re-checks the capability BEFORE touching the database and
 * denies with no mutation when disallowed (Requirements 36.2, 36.3). All
 * persistence uses the injected parameterized {@link QueryExecutor}
 * (Requirement 39.2).
 */
import {
  createCustomMetadataFieldInputSchema,
  customMetadataFieldSchema,
  updateCustomMetadataFieldInputSchema,
  type AuthContext,
  type CreateCustomMetadataFieldInput,
  type CustomMetadataField,
  type UpdateCustomMetadataFieldInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/**
 * The ONLY illustrative custom metadata field label this service ever seeds.
 * Product decision: "Location Reference" is never seeded (tasks.md decision 1).
 */
export const WRITING_TOPIC_LABEL = 'Writing Topic';

/** Raw `custom_metadata_field` row (snake_case columns from PostgreSQL). */
interface CustomMetadataFieldRow {
  readonly id: string;
  readonly writing_type_id: string;
  readonly label: string;
  readonly required: boolean;
}

const RETURNING = 'id, writing_type_id, label, required';

/** Map a raw row to the validated shared {@link CustomMetadataField} DTO. */
function toCustomMetadataField(row: CustomMetadataFieldRow): CustomMetadataField {
  return customMetadataFieldSchema.parse({
    id: row.id,
    writingTypeId: row.writing_type_id,
    label: row.label,
    required: row.required,
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
 * Create a custom metadata field within a Writing Type (`Org Owner` for owned
 * orgs, or `Admin`). `required` defaults to `false` (the DB default) when not
 * supplied. Throws {@link NotFoundError} when the Writing Type does not exist.
 */
export async function createCustomMetadataField(
  actor: AuthContext,
  input: CreateCustomMetadataFieldInput,
  db: QueryExecutor,
): Promise<CustomMetadataField> {
  const { writingTypeId, label, required } =
    createCustomMetadataFieldInputSchema.parse(input);

  const organizationId = await findOrganizationId(writingTypeId, db);
  if (organizationId === null) {
    throw new NotFoundError(`Writing Type '${writingTypeId}' not found`);
  }

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'writingType', writingTypeId, organizationId },
  });

  const rows = await db.query<CustomMetadataFieldRow>(
    `INSERT INTO custom_metadata_field (writing_type_id, label, required)
     VALUES ($1, $2, $3) RETURNING ${RETURNING}`,
    [writingTypeId, label, required ?? false],
  );

  return toCustomMetadataField(rows[0]!);
}

/**
 * Seed the single illustrative "Writing Topic" custom metadata field for a
 * newly created (or existing) Writing Type. This is the ONLY field this
 * service ever seeds — "Location Reference" is never created here or anywhere
 * else (tasks.md decision 1). Callers (e.g. the Writing Type creation flow)
 * invoke this explicitly; it is not an automatic side effect of any other
 * operation, so a Writing Type may exist with zero, one, or many custom
 * metadata fields entirely under Org-Owner control.
 */
export async function seedWritingTopicField(
  actor: AuthContext,
  writingTypeId: string,
  db: QueryExecutor,
): Promise<CustomMetadataField> {
  return createCustomMetadataField(
    actor,
    { writingTypeId, label: WRITING_TOPIC_LABEL, required: false },
    db,
  );
}

/** Read a single custom metadata field by id, or `null` when it does not exist. */
export async function getCustomMetadataField(
  id: string,
  db: QueryExecutor,
): Promise<CustomMetadataField | null> {
  const rows = await db.query<CustomMetadataFieldRow>(
    `SELECT ${RETURNING} FROM custom_metadata_field WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toCustomMetadataField(row) : null;
}

/** List the custom metadata fields for one Writing Type, ordered by label. */
export async function listCustomMetadataFields(
  writingTypeId: string,
  db: QueryExecutor,
): Promise<CustomMetadataField[]> {
  const rows = await db.query<CustomMetadataFieldRow>(
    `SELECT ${RETURNING} FROM custom_metadata_field WHERE writing_type_id = $1 ORDER BY label ASC`,
    [writingTypeId],
  );
  return rows.map(toCustomMetadataField);
}

/**
 * Update a custom metadata field's mutable fields (label and/or required flag).
 * Throws {@link NotFoundError} when the field does not exist.
 */
export async function updateCustomMetadataField(
  actor: AuthContext,
  id: string,
  input: UpdateCustomMetadataFieldInput,
  db: QueryExecutor,
): Promise<CustomMetadataField> {
  const patch = updateCustomMetadataFieldInputSchema.parse(input);

  const existingRows = await db.query<CustomMetadataFieldRow>(
    `SELECT ${RETURNING} FROM custom_metadata_field WHERE id = $1`,
    [id],
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new NotFoundError(`Custom metadata field '${id}' not found`);
  }

  const organizationId = await findOrganizationId(existing.writing_type_id, db);
  if (organizationId === null) {
    throw new NotFoundError(`Writing Type '${existing.writing_type_id}' not found`);
  }

  requireCapability(actor, {
    capability: 'writingType.manageCatalog',
    scope: { kind: 'writingType', writingTypeId: existing.writing_type_id, organizationId },
  });

  // Build a parameterized partial update from only the supplied fields.
  const assignments: string[] = [];
  const params: unknown[] = [id];
  if (patch.label !== undefined) {
    params.push(patch.label);
    assignments.push(`label = $${params.length}`);
  }
  if (patch.required !== undefined) {
    params.push(patch.required);
    assignments.push(`required = $${params.length}`);
  }

  if (assignments.length === 0) {
    return toCustomMetadataField(existing);
  }

  const rows = await db.query<CustomMetadataFieldRow>(
    `UPDATE custom_metadata_field SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${RETURNING}`,
    params,
  );
  return toCustomMetadataField(rows[0]!);
}

/**
 * Delete a custom metadata field (`Org Owner` for owned orgs, or `Admin`).
 * Returns `true` when a row was removed, `false` when no field had that id.
 */
export async function deleteCustomMetadataField(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  const existingRows = await db.query<CustomMetadataFieldRow>(
    `SELECT ${RETURNING} FROM custom_metadata_field WHERE id = $1`,
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
    'DELETE FROM custom_metadata_field WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
