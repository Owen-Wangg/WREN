/**
 * Required-field gating for document metadata (design "Document / Draft Service
 * — Metadata"; REQ-DOC-SUBMIT-01 / Requirements 6.6, 6.7, 30.4).
 *
 * An Org Owner defines custom metadata fields on a Writing Type, each flagged
 * `required` or optional (REQ-ORG-CONFIG-01 / Requirement 30.3). When a required
 * field is marked required, the Document_Service MUST enforce its presence at
 * submission (Requirement 30.4) and the create/Activate-Editor control MUST stay
 * DISABLED while any required field is still empty (Requirement 6.7).
 *
 * This module is the PURE, deterministic core of that gate — no I/O — mirroring
 * the {@link ../sizeLimit} `SizeLimitResult` pattern: the caller loads the
 * configured {@link CustomMetadataField}s for the Writing Type and the submitted
 * metadata map, and this function produces a discriminated-union result telling
 * the caller whether document creation is ENABLED (all required fields
 * satisfied) or DISABLED (which required fields are missing/empty). That keeps it
 * directly unit- and property-testable (task 6.5 / design Property 3).
 *
 * Design decisions, made explicit:
 *
 *   - **Keying by field id.** The submitted metadata map is keyed by each
 *     {@link CustomMetadataField.id} (the stable identifier), not by its label.
 *     Labels are Org-Owner-editable and may be renamed without breaking the gate
 *     or a Document's stored values; ids are stable. The persisted
 *     `Document.metadata` uses the same id-keyed shape (see
 *     `documentMetadataRepository.ts`).
 *
 *   - **Whitespace-only is empty.** A required field whose submitted value is
 *     absent, the empty string, or only whitespace counts as EMPTY and keeps the
 *     gate disabled (Requirement 6.7 "WHILE any required field is empty"). This
 *     matches how the size gate treats whitespace-only text as zero words.
 *
 *   - **Optional fields never gate.** Optional fields — present, empty, or absent
 *     — never affect the decision (Requirement 30.4 enforces *required* fields
 *     only). Unknown extra keys in the metadata map are likewise ignored here;
 *     the shared `documentSchema` is the authority on the stored map's shape.
 */
import type { CustomMetadataField } from '@wren/types';

/**
 * Whether a submitted metadata value counts as EMPTY for gating: `undefined`
 * (absent), the empty string, or whitespace-only all count as empty. Pure.
 */
export function isBlankMetadataValue(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/** Every required custom field has a non-empty value; creation is ENABLED. */
export interface RequiredFieldsSatisfied {
  readonly status: 'satisfied';
}

/**
 * At least one required custom field is missing or empty; the create/Activate
 * control MUST stay DISABLED (Requirement 6.7). Carries both the field ids and
 * their human-readable labels so the caller can surface which fields still need
 * a value without a second lookup.
 */
export interface RequiredFieldsMissing {
  readonly status: 'missing-required-fields';
  /** The `id`s of the required fields that are still empty, in field order. */
  readonly missingRequiredFieldIds: readonly string[];
  /** The `label`s of those same fields, in the same order, for messaging. */
  readonly missingRequiredFieldLabels: readonly string[];
}

export type RequiredFieldGateResult = RequiredFieldsSatisfied | RequiredFieldsMissing;

/**
 * Evaluate the required-field gate for a Writing Type's configured custom
 * metadata fields against a submitted metadata map (keyed by field id).
 *
 * Returns `satisfied` when every `required` field has a non-empty
 * (non-whitespace) value; otherwise `missing-required-fields` listing the
 * offending fields. Optional fields never affect the result (Requirement 30.4).
 * Pure — no I/O.
 */
export function evaluateRequiredFields(
  fields: readonly CustomMetadataField[],
  metadata: Readonly<Record<string, string>>,
): RequiredFieldGateResult {
  const missing = fields.filter(
    (field) => field.required && isBlankMetadataValue(metadata[field.id]),
  );

  if (missing.length === 0) {
    return { status: 'satisfied' };
  }

  return {
    status: 'missing-required-fields',
    missingRequiredFieldIds: missing.map((field) => field.id),
    missingRequiredFieldLabels: missing.map((field) => field.label),
  };
}

/**
 * Convenience predicate mirroring the create/Activate-Editor enablement decision
 * (Requirement 6.7): `true` iff every required field is satisfied. Callers that
 * only need the boolean (e.g. to enable/disable a control) can use this; callers
 * that need to report *which* fields are missing use {@link evaluateRequiredFields}.
 */
export function isDocumentCreationEnabled(
  fields: readonly CustomMetadataField[],
  metadata: Readonly<Record<string, string>>,
): boolean {
  return evaluateRequiredFields(fields, metadata).status === 'satisfied';
}
