/**
 * Configurable custom-metadata field mechanism for the new-document form
 * (task 18.6; Requirements 6.6, 6.7).
 *
 * Product decision 1 (tasks.md): "Writing Topic" is the only seeded
 * illustrative custom metadata field — "Location Reference" is intentionally
 * excluded (it appears in the source Figma frame but is not carried into this
 * implementation). Org-Owner-defined fields (task 5.2, backend) plug into this
 * same `MetadataFieldConfig` shape, so the required-field gating below scales
 * to any number of configured fields without changing the check itself.
 */

export interface MetadataFieldConfig {
  /** The key stored against `Document.metadata` (`@wren/types`). */
  readonly key: string;
  /** Label shown to the User. */
  readonly label: string;
  /** WHILE true and the field is empty, THE Activate Editor control stays disabled (Requirement 6.7). */
  readonly required: boolean;
}

/**
 * Default configured metadata fields for the new-document form. Only
 * "Writing Topic" is seeded as illustrative/required — see product decision 1.
 */
export const DEFAULT_METADATA_FIELDS: readonly MetadataFieldConfig[] = [
  { key: 'Writing Topic', label: 'Writing Topic', required: true },
];

/**
 * Returns the configured fields that are required but currently empty
 * (whitespace-only counts as empty). Generic over the field-config array so it
 * scales to N configured fields (Requirement 6.7).
 */
export function getMissingRequiredFields(
  fields: readonly MetadataFieldConfig[],
  values: Readonly<Record<string, string>>,
): MetadataFieldConfig[] {
  return fields.filter((field) => field.required && !values[field.key]?.trim());
}

/** True iff every required configured field has a non-empty value. */
export function areRequiredFieldsFilled(
  fields: readonly MetadataFieldConfig[],
  values: Readonly<Record<string, string>>,
): boolean {
  return getMissingRequiredFields(fields, values).length === 0;
}
