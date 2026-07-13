/**
 * Zod schemas + inferred types for the Field Expert configuration surface
 * (task 19.2; Requirements 23.4, 24.1, 32.2, 40.1). Colocated with the feature
 * that uses them (frontend steering §9) and validated at the API boundary the
 * same way every other WREN payload is (frontend steering §7).
 *
 * Scope notes that shape these shapes:
 *
 *  - **Taxonomy is data, not an enum** (Requirement 24.1; product decision 3 in
 *    tasks.md; steering `sample-taxonomy.md`). Each {@link ErrorCategory} carries
 *    a stable `id`; the UI edits `label` only. Renaming therefore preserves
 *    Feedback-Item linkage by `id` — the backend Config Service property test
 *    (task 12.2 / Property 15) is the authority for that invariant; here we
 *    simply never send a delete+recreate for a rename.
 *  - **No `replacementProse`, ever** (REQ-CORE-NOGHOST-01). Every schema is
 *    `.strict()`, so a payload that tries to smuggle replacement prose / a
 *    candidate rewrite in fails validation at the boundary. The prompt editor's
 *    Field-Expert-editable content is plain instruction text with no "generate a
 *    rewrite" field — the authoritative save-time guardrail is backend task 12.3.
 *  - **Admin/Field-Expert edit boundary** (Requirement 32.2, 32.3, 32.7): the
 *    Writing-Type prompt content is Field-Expert-editable; the system
 *    scaffolding / guardrail is Admin-owned, shown read-only, and always takes
 *    precedence.
 *  - **Aggregate, domain-scoped analytics only** (Requirement 40.1, 40.6): the
 *    analytics shape has NO per-user field, NO named entries — only all-users
 *    aggregate totals for the expert's assigned Writing Type(s).
 */
import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from '@wren/types';

/* -------------------------------------------------------------------------- */
/* Error taxonomy (Requirement 24.1) — categories are data with a stable id.   */
/* -------------------------------------------------------------------------- */

/**
 * A single error category in a Writing Type's taxonomy. `id` is stable and
 * server-assigned; `label` is the human-facing name the Field Expert edits.
 * Rename == change `label`, keep `id` (preserves Feedback-Item linkage).
 */
export const errorCategorySchema = z
  .object({
    id: idSchema,
    writingTypeId: idSchema,
    label: z.string().min(1),
    /** Display order within the taxonomy (0-based). */
    order: z.number().int().nonnegative(),
  })
  .strict();
export type ErrorCategory = z.infer<typeof errorCategorySchema>;

export const taxonomySchema = z.array(errorCategorySchema);
export type Taxonomy = z.infer<typeof taxonomySchema>;

/** Add-category form input — only a label; the server assigns the stable id. */
export const addCategorySchema = z
  .object({
    label: z.string().trim().min(1, 'Category name is required.'),
  })
  .strict();
export type AddCategoryValues = z.infer<typeof addCategorySchema>;

/** Rename-category form input — a new label for an existing, stable id. */
export const renameCategorySchema = z
  .object({
    label: z.string().trim().min(1, 'Category name is required.'),
  })
  .strict();
export type RenameCategoryValues = z.infer<typeof renameCategorySchema>;

/* -------------------------------------------------------------------------- */
/* Prompt + convention config (Requirement 32.2) — the edit boundary.          */
/* -------------------------------------------------------------------------- */

/** Qualitative annotation density (never a raw numeric writer-facing score). */
export const feedbackDensitySchema = z.enum(['low', 'standard', 'high']);
export type FeedbackDensity = z.infer<typeof feedbackDensitySchema>;

/**
 * The Field-Expert-editable inner prompt layer for one Writing Type
 * (Requirement 32.2). Plain labeled convention fields + domain instruction
 * text — there is deliberately no field that asks the model to produce a
 * rewrite / replacement prose (REQ-CORE-NOGHOST-01).
 */
export const domainPromptSchema = z
  .object({
    /** Free-text domain instructions referencing the domain's conventions. */
    instructionText: z.string(),
    /** Tone of the Socratic questions (e.g. "Encouraging, direct"). */
    tone: z.string(),
    density: feedbackDensitySchema,
    /** What to prioritise when the annotation cap binds (e.g. recurring issues). */
    priority: z.string(),
  })
  .strict();
export type DomainPrompt = z.infer<typeof domainPromptSchema>;

/**
 * The Admin-owned system scaffolding (Requirement 32.3, 32.7, 32.8). Read-only
 * to Field Experts and always the authoritative outer layer at generation time.
 * Modelled as read-only strings here purely for display.
 */
export const systemScaffoldingSchema = z
  .object({
    systemInstructions: z.string(),
    guardrailTemplate: z.string(),
  })
  .strict();
export type SystemScaffolding = z.infer<typeof systemScaffoldingSchema>;

export const promptConfigSchema = z
  .object({
    writingTypeId: idSchema,
    /** Field-Expert-editable (Requirement 32.2). */
    domainPrompt: domainPromptSchema,
    /** Admin-owned, read-only to Field Experts (Requirement 32.3, 32.7). */
    systemScaffolding: systemScaffoldingSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type PromptConfig = z.infer<typeof promptConfigSchema>;

/** The Writing-Type prompt content a Field Expert can submit on save. */
export const domainPromptFormSchema = z
  .object({
    instructionText: z.string(),
    tone: z.string(),
    density: feedbackDensitySchema,
    priority: z.string(),
  })
  .strict();
export type DomainPromptFormValues = z.infer<typeof domainPromptFormSchema>;

/* -------------------------------------------------------------------------- */
/* Domain-scoped reference material (Requirement 26 / task 19.2 manager).       */
/* -------------------------------------------------------------------------- */

/**
 * The three content input methods the manager must accept (Requirement 26.5):
 * file attachment, pasted plain text, and rich/HTML content.
 */
export const referenceInputTypeSchema = z.enum(['file', 'pasted-text', 'rich-html']);
export type ReferenceInputType = z.infer<typeof referenceInputTypeSchema>;

/**
 * A domain-scoped Reference Material entry (tier 2 — visible only to Field
 * Experts assigned to `writingTypeId`; Requirement 26.2, 26.3). We never store
 * replacement prose here; this is grounding material, not model output.
 */
export const referenceMaterialSchema = z
  .object({
    id: idSchema,
    writingTypeId: idSchema,
    title: z.string().min(1),
    inputType: referenceInputTypeSchema,
    /** File name for `file`; a short preview for pasted/HTML content. */
    preview: z.string(),
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type ReferenceMaterial = z.infer<typeof referenceMaterialSchema>;

export const referenceMaterialsSchema = z.array(referenceMaterialSchema);

/** Add-reference form input. `content` meaning depends on `inputType`. */
export const addReferenceSchema = z
  .object({
    title: z.string().trim().min(1, 'A title is required.'),
    inputType: referenceInputTypeSchema,
    /** Pasted text / HTML body, or the selected file's name. */
    content: z.string().trim().min(1, 'Reference content is required.'),
  })
  .strict();
export type AddReferenceValues = z.infer<typeof addReferenceSchema>;

/* -------------------------------------------------------------------------- */
/* Aggregate, domain-scoped analytics (Requirement 40.1, 40.6).                */
/* -------------------------------------------------------------------------- */

/**
 * An all-users aggregate total for one error category within the Writing Type.
 * There is NO per-user breakdown — this is a cohort total (Requirement 40.6).
 */
export const categoryAggregateSchema = z
  .object({
    errorCategoryId: idSchema,
    label: z.string().min(1),
    /** All-users total occurrences of this category (aggregate, not per-user). */
    total: z.number().int().nonnegative(),
  })
  .strict();
export type CategoryAggregate = z.infer<typeof categoryAggregateSchema>;

/**
 * Aggregate analytics for one assigned Writing Type. Every field is an
 * all-users aggregate total; there are deliberately no per-user rows, names,
 * or per-user scores (Requirement 40.1, 40.2, 40.6). The writer-facing
 * no-numeric-scoring rule (Requirement 18.3 / Property 19) does not apply to
 * this Field-Expert view — aggregate totals across all users are permitted here.
 */
export const aggregateAnalyticsSchema = z
  .object({
    writingTypeId: idSchema,
    /** All-users total documents in this Writing Type. */
    totalDocuments: z.number().int().nonnegative(),
    /** All-users total drafts submitted. */
    totalDrafts: z.number().int().nonnegative(),
    /** All-users total feedback items generated. */
    totalFeedbackItems: z.number().int().nonnegative(),
    /** All-users totals per error category. */
    categoryTotals: z.array(categoryAggregateSchema),
  })
  .strict();
export type AggregateAnalytics = z.infer<typeof aggregateAnalyticsSchema>;
