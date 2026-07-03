/**
 * Validation schemas for the document-creation and re-upload flows, colocated
 * with the forms/hooks that use them (frontend steering §9).
 */
import { z } from 'zod';

/**
 * Reference material tier — the two-tier reference model (frontend steering
 * §3, §11): tier 1 is org-wide, tier 2 is scoped to a single Writing Type.
 * `ReferenceFileUpload` always carries this field so the two tiers are never
 * flattened into a single generic upload, even before the backend distinction
 * is wired.
 */
export const referenceMaterialTierSchema = z.enum(['org-wide', 'writing-type']);
export type ReferenceMaterialTier = z.infer<typeof referenceMaterialTierSchema>;

/**
 * The new-document form's values. `metadata` is a free-form record keyed by
 * the configured `MetadataFieldConfig.key` (see `documentMetadataConfig.ts`)
 * so the schema does not hardcode "Writing Topic" — required-field enforcement
 * happens generically via `areRequiredFieldsFilled`, not via this schema.
 */
export const newDocumentSchema = z.object({
  writingTypeId: z.string().min(1, 'Select a document type.'),
  name: z.string().min(1, 'Document name is required.'),
  metadata: z.record(z.string(), z.string()),
  referenceFile: z
    .custom<File>((value) => value === undefined || value instanceof File, {
      message: 'Reference material must be a file.',
    })
    .optional(),
  referenceMaterialTier: referenceMaterialTierSchema,
});
export type NewDocumentFormValues = z.infer<typeof newDocumentSchema>;

/** The re-upload flow's input: a new file for an existing Document. */
export const reUploadSchema = z.object({
  documentId: z.string().min(1),
  file: z.custom<File>((value) => value instanceof File, {
    message: 'A file is required to re-upload.',
  }),
});
export type ReUploadFormValues = z.infer<typeof reUploadSchema>;
