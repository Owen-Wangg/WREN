/**
 * Org Owner business-console shapes (task 19.3; Requirement 34 —
 * REQ-ORGOWNER-FEATURES-01).
 *
 * These schemas compose the shared domain contract (`@wren/types`) wherever a
 * shape already exists there (frontend steering §7: shared types are the single
 * source of truth). `WritingType`, `Role`, `AccessState` and the access-state
 * enums are all re-used from `@wren/types` rather than redefined here. Only the
 * console-specific read models (Organization view, Content Type, business
 * Topic, org member row, and the owned-org aggregate analytics projection) and
 * the CRUD form-input schemas live in this file.
 *
 * Two compliance constraints shape the analytics schema below and are enforced
 * structurally (`.strict()`), not just by convention:
 *
 *  - **Owned-org scope only** (Requirement 34.4): every read model is keyed by
 *    an `organizationId`; the console never fetches or renders a platform-wide
 *    projection.
 *  - **Aggregate-only, no surveillance** (Requirement 34.5; REQ-AUDIT-01c):
 *    {@link orgAggregateAnalyticsSchema} carries all-users aggregate totals
 *    ONLY. There is deliberately no per-User row, no user identity, and no
 *    numeric per-User score anywhere in the analytics shape — `.strict()`
 *    rejects any payload that tries to add one.
 */
import { z } from 'zod';

import { accessStateSchema, idSchema, roleSchema, writingTypeAccessStateSchema } from '@wren/types';

/* -------------------------------------------------------------------------- */
/* Organization (owned-org read model)                                        */
/* -------------------------------------------------------------------------- */

export const organizationSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    /** Org-grouping default access state (Admin-controlled; shown read-only here). */
    accessState: accessStateSchema,
  })
  .strict();
export type Organization = z.infer<typeof organizationSchema>;
export const organizationsSchema = z.array(organizationSchema);

/* -------------------------------------------------------------------------- */
/* Content Type (Org-Owner-defined document category within a Writing Type)   */
/* -------------------------------------------------------------------------- */

export const contentTypeSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    writingTypeId: idSchema,
    name: z.string().min(1),
  })
  .strict();
export type ContentType = z.infer<typeof contentTypeSchema>;
export const contentTypesSchema = z.array(contentTypeSchema);

/* -------------------------------------------------------------------------- */
/* Business Topic (Requirement 35 — organizational metadata, never taxonomy)  */
/* -------------------------------------------------------------------------- */

/**
 * A business Topic is scoped to exactly one owned Organization grouping. It is
 * organizational metadata only and NEVER drives error taxonomy, reference-
 * material selection, or feedback generation (REQ-TOPIC-01 criterion 3).
 */
export const topicSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    name: z.string().min(1),
  })
  .strict();
export type Topic = z.infer<typeof topicSchema>;
export const topicsSchema = z.array(topicSchema);

/* -------------------------------------------------------------------------- */
/* Custom metadata field config (boundary schema for the shared field shape)  */
/* -------------------------------------------------------------------------- */

/**
 * Boundary schema mirroring `MetadataFieldConfig`
 * (`features/documents/documentMetadataConfig.ts`, task 18.6). The console
 * reuses that exact shape for "configurable custom metadata fields" rather than
 * redefining it — this schema exists only to validate the field list at the API
 * boundary. "Writing Topic" is the sole seeded field; "Location Reference" is
 * intentionally excluded (tasks.md product decision 1).
 */
export const metadataFieldConfigSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    required: z.boolean(),
  })
  .strict();
export type MetadataFieldConfigDto = z.infer<typeof metadataFieldConfigSchema>;
export const metadataFieldsSchema = z.array(metadataFieldConfigSchema);

/* -------------------------------------------------------------------------- */
/* Org member row (Requirement 34.1/34.2 — members + Field-Expert assignment) */
/* -------------------------------------------------------------------------- */

/**
 * A global User associated with an owned Organization grouping via an Access
 * Grant (Users remain global — REQ-ORG-GROUPING-01). Identifying members by
 * name/email here is by design: membership management is about identified
 * users. This is distinct from analytics, which is strictly de-identified and
 * aggregate (see {@link orgAggregateAnalyticsSchema}).
 *
 * `assignedWritingTypeIds` is populated for `Field Expert` members; the Org
 * Owner may assign one or more Writing Types **from the owned Organization
 * only** (Requirement 34.2).
 */
export const orgMemberSchema = z
  .object({
    userId: idSchema,
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    role: roleSchema,
    assignedWritingTypeIds: z.array(idSchema),
  })
  .strict();
export type OrgMember = z.infer<typeof orgMemberSchema>;
export const orgMembersSchema = z.array(orgMemberSchema);

/* -------------------------------------------------------------------------- */
/* Owned-org aggregate analytics (Requirement 34.5 — all-users aggregate only) */
/* -------------------------------------------------------------------------- */

/** Aggregate totals for one Writing Type within the owned Organization. */
export const orgWritingTypeAggregateSchema = z
  .object({
    writingTypeId: idSchema,
    writingTypeName: z.string().min(1),
    documentCount: z.number().int().nonnegative(),
    draftCount: z.number().int().nonnegative(),
    feedbackItemCount: z.number().int().nonnegative(),
  })
  .strict();
export type OrgWritingTypeAggregate = z.infer<typeof orgWritingTypeAggregateSchema>;

/**
 * Owned-org aggregate analytics projection. All-users aggregate totals ONLY:
 * there is no per-User entry, no user identity, no per-User score, and no
 * platform-wide field anywhere in this shape (Requirement 34.5;
 * REQ-AUDIT-01c). `activeWriterCount` is a COUNT — never a list of writers.
 */
export const orgAggregateAnalyticsSchema = z
  .object({
    organizationId: idSchema,
    totalDocuments: z.number().int().nonnegative(),
    totalDrafts: z.number().int().nonnegative(),
    totalFeedbackItems: z.number().int().nonnegative(),
    /** Distinct-writer COUNT only — no identities are ever exposed. */
    activeWriterCount: z.number().int().nonnegative(),
    byWritingType: z.array(orgWritingTypeAggregateSchema),
  })
  .strict();
export type OrgAggregateAnalytics = z.infer<typeof orgAggregateAnalyticsSchema>;

/* -------------------------------------------------------------------------- */
/* CRUD form-input schemas (React Hook Form + Zod — frontend steering §9)      */
/* -------------------------------------------------------------------------- */

export const createWritingTypeInputSchema = z
  .object({
    organizationId: idSchema,
    name: z.string().min(1, 'Enter a writing type name'),
    accessState: writingTypeAccessStateSchema,
  })
  .strict();
export type CreateWritingTypeInput = z.infer<typeof createWritingTypeInputSchema>;

export const createContentTypeInputSchema = z
  .object({
    organizationId: idSchema,
    writingTypeId: z.string().min(1, 'Select a writing type'),
    name: z.string().min(1, 'Enter a content type name'),
  })
  .strict();
export type CreateContentTypeInput = z.infer<typeof createContentTypeInputSchema>;

export const createTopicInputSchema = z
  .object({
    organizationId: idSchema,
    name: z.string().min(1, 'Enter a topic name'),
  })
  .strict();
export type CreateTopicInput = z.infer<typeof createTopicInputSchema>;

export const createMetadataFieldInputSchema = z
  .object({
    organizationId: idSchema,
    label: z.string().min(1, 'Enter a field label'),
    required: z.boolean(),
  })
  .strict();
export type CreateMetadataFieldInput = z.infer<typeof createMetadataFieldInputSchema>;

export const addMemberInputSchema = z
  .object({
    organizationId: idSchema,
    email: z.string().email('Enter a valid email'),
  })
  .strict();
export type AddMemberInput = z.infer<typeof addMemberInputSchema>;

/**
 * Assign the Field Expert role to a member with one or more Writing Types.
 * `writingTypeIds` is validated to contain at least one id; the UI populates the
 * options from the owned Organization's Writing Types only, so a platform-wide
 * assignment is not expressible (Requirement 34.2/34.4).
 */
export const assignFieldExpertInputSchema = z
  .object({
    organizationId: idSchema,
    userId: z.string().min(1, 'Select a member'),
    writingTypeIds: z.array(idSchema).min(1, 'Assign at least one writing type'),
  })
  .strict();
export type AssignFieldExpertInput = z.infer<typeof assignFieldExpertInputSchema>;
