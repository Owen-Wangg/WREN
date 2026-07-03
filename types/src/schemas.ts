/**
 * Domain entity types and Zod validation schemas for WREN Writing Coach.
 *
 * This file is the single source of truth for the platform's core data shapes
 * (frontend steering §7: shared types live in `/types`). Each schema is declared
 * `.strict()` so unknown keys — including the forbidden `replacementProse` field
 * (REQ-CORE-NOGHOST-01) — are rejected at the API boundary at runtime. The
 * matching TypeScript types are derived with `z.infer`, and `index.ts` runs each
 * DTO type through a compile-time no-ghostwriting guard.
 *
 * Naming note: the design's "Writing Domain" entity is implemented here as the
 * configurable, user-selectable {@link WritingType} (see tasks.md product
 * decision 2). It is data, never a hardcoded domain enumeration.
 */
import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';
import { assignmentScopeSchema } from './authorization';

/* -------------------------------------------------------------------------- */
/* Role (Requirement 1.1 — stored role identities)                            */
/* -------------------------------------------------------------------------- */

/** Canonical role identifiers stored in the application database. */
export const roleSchema = z.enum(['User', 'Field Expert', 'Org Owner', 'Admin']);
export type Role = z.infer<typeof roleSchema>;

/* -------------------------------------------------------------------------- */
/* Access state (Requirement 4 / 28 — OPEN / LOCKED, + INHERIT for WritingType)*/
/* -------------------------------------------------------------------------- */

/** Access state for an Organization grouping (the effective submission control). */
export const accessStateSchema = z.enum(['OPEN', 'LOCKED']);
export type AccessState = z.infer<typeof accessStateSchema>;

/**
 * Access state for a Writing Type. A Writing Type may set its own OPEN/LOCKED
 * state, or `INHERIT` the access state of its Organization grouping
 * (Requirement 4.1).
 */
export const writingTypeAccessStateSchema = z.enum(['OPEN', 'LOCKED', 'INHERIT']);
export type WritingTypeAccessState = z.infer<typeof writingTypeAccessStateSchema>;

/**
 * Outcome of the Auth_Service access-resolution check for a (User, Writing Type)
 * pair, consumed by the Document submission gate (design "Admin / Auth / Usage
 * Service"; Requirements 4.2, 4.3, 6.8, 28.3).
 *
 * - `OPEN`    — the effective access state is OPEN; any authenticated global
 *               User may self-select and submit without an Access Grant.
 * - `GRANTED` — the effective access state is LOCKED, but the User holds an
 *               applicable Access Grant (scoped to the Writing Type or its
 *               Organization grouping), so submission is permitted.
 * - `DENIED`  — the effective access state is LOCKED and the User holds no
 *               applicable grant; submission is refused and the access-request
 *               flow should be offered (Requirement 4.6).
 *
 * `OPEN` and `GRANTED` both permit submission; `DENIED` does not.
 */
export const accessDecisionSchema = z.enum(['OPEN', 'GRANTED', 'DENIED']);
export type AccessDecision = z.infer<typeof accessDecisionSchema>;

/* -------------------------------------------------------------------------- */
/* Organization (Requirement 28 — a grouping that owns NO Users)               */
/* -------------------------------------------------------------------------- */

/**
 * An Organization is a GROUPING of Writing Types, the Field Experts who maintain
 * them, org-wide Reference Material, and business Topics — never a data-isolation
 * boundary and never an owner of Users (Requirement 28.1 / 28.2). Its
 * `accessState` is the OPEN/LOCKED default that a Writing Type inherits when its
 * own access state is `INHERIT` (Requirement 4.1 / 28.4).
 */
export const organizationSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    accessState: accessStateSchema,
  })
  .strict();
export type Organization = z.infer<typeof organizationSchema>;

/**
 * Input to create an Organization. The access state is optional and defaults to
 * `LOCKED` (the safe default the schema uses); the Admin may open it later via
 * the access-state control (Requirement 28.4 / 33.2).
 */
export const createOrganizationInputSchema = z
  .object({
    name: z.string().min(1),
    accessState: accessStateSchema.optional(),
  })
  .strict();
export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

/** Input to update an Organization's mutable catalog fields (its name). */
export const updateOrganizationInputSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationInputSchema>;

/* -------------------------------------------------------------------------- */
/* WritingType (configurable, self-selectable — design "Writing Domain")       */
/* -------------------------------------------------------------------------- */

export const writingTypeSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    name: z.string().min(1),
    accessState: writingTypeAccessStateSchema,
    /** Null → inherit the Organization / platform default size limit. */
    sizeLimitWords: z.number().int().positive().nullable(),
  })
  .strict();
export type WritingType = z.infer<typeof writingTypeSchema>;

/**
 * Input to create a Writing Type catalog record. A Writing Type is configurable,
 * self-selectable DATA — never a hardcoded domain enumeration (tasks.md product
 * decision 2). New records always start with an `INHERIT` access state: changing
 * a Writing Type to OPEN/LOCKED is a separate, Admin-controlled access-state
 * operation (Requirement 28.4 / 33.2), kept distinct from catalog management
 * (Requirement 30.1). `sizeLimitWords` is optional catalog configuration.
 */
export const createWritingTypeInputSchema = z
  .object({
    organizationId: idSchema,
    name: z.string().min(1),
    sizeLimitWords: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type CreateWritingTypeInput = z.infer<typeof createWritingTypeInputSchema>;

/** Input to update a Writing Type's mutable catalog fields (name / size limit). */
export const updateWritingTypeInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    sizeLimitWords: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type UpdateWritingTypeInput = z.infer<typeof updateWritingTypeInputSchema>;

/* -------------------------------------------------------------------------- */
/* ContentType (Requirement 30.2 — Org-Owner-defined, scoped to a WritingType) */
/* -------------------------------------------------------------------------- */

/**
 * An Org-Owner-defined category of document within a Writing Type (for example,
 * "case brief", "memo", "tort claim proposal"), used to organize submissions and
 * scope configuration (REQ-ORG-CONFIG-01 / Requirement 30.2).
 */
export const contentTypeSchema = z
  .object({
    id: idSchema,
    writingTypeId: idSchema,
    label: z.string().min(1),
  })
  .strict();
export type ContentType = z.infer<typeof contentTypeSchema>;

/** Input to create a Content Type within a Writing Type. */
export const createContentTypeInputSchema = z
  .object({
    writingTypeId: idSchema,
    label: z.string().min(1),
  })
  .strict();
export type CreateContentTypeInput = z.infer<typeof createContentTypeInputSchema>;

/** Input to update a Content Type's mutable field (its label). */
export const updateContentTypeInputSchema = z
  .object({
    label: z.string().min(1),
  })
  .strict();
export type UpdateContentTypeInput = z.infer<typeof updateContentTypeInputSchema>;

/* -------------------------------------------------------------------------- */
/* Topic (REQ-TOPIC-01 / Requirement 35 — business label, scoped to ONE org)   */
/* -------------------------------------------------------------------------- */

/**
 * A business Topic used to organize Users' work, scoped to exactly ONE owned
 * Organization (REQ-TOPIC-01 / Requirement 35.1, 35.2). A Topic is purely a
 * business-layer label — it is NOT a data-isolation boundary
 * (REQ-ORG-GROUPING-01) and it NEVER drives error taxonomy, Reference Material
 * selection, or feedback generation (Requirement 35.3); those remain Writing
 * Type / Writing Domain concerns. A Topic is distinct from a Document's
 * per-document "Writing Topic" Custom Metadata Field value — the catalog entry
 * here and the free-form value stored on a Document are independent
 * (Requirement 35.4); deleting a Topic never alters a Document's stored value.
 */
export const topicSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    name: z.string().min(1),
  })
  .strict();
export type Topic = z.infer<typeof topicSchema>;

/** Input to create a Topic within an owned Organization. */
export const createTopicInputSchema = z
  .object({
    organizationId: idSchema,
    name: z.string().min(1),
  })
  .strict();
export type CreateTopicInput = z.infer<typeof createTopicInputSchema>;

/** Input to update a Topic's mutable field (its name). */
export const updateTopicInputSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();
export type UpdateTopicInput = z.infer<typeof updateTopicInputSchema>;

/**
 * Reports the impact of removing a Topic BEFORE deletion, so an Org Owner (or
 * Admin) can be shown an explicit confirmation when Documents currently carry
 * this Topic's name as their "Writing Topic" custom-metadata value
 * (REQ-TOPIC-01 / Requirement 35.5). This is a read-only, best-effort report —
 * Document metadata values are independent per-document strings, not a foreign
 * key to `topic.id`, so deleting a Topic never cascades into or blanks any
 * Document's stored metadata; this count exists solely so the caller can
 * present an informed confirmation before deleting.
 */
export const topicDeletionImpactSchema = z
  .object({
    topicId: idSchema,
    documentCountReferencingName: z.number().int().nonnegative(),
  })
  .strict();
export type TopicDeletionImpact = z.infer<typeof topicDeletionImpactSchema>;

/* -------------------------------------------------------------------------- */
/* CustomMetadataField (Requirement 30.3 — required/optional, scoped to a       */
/* WritingType)                                                                */
/* -------------------------------------------------------------------------- */

/**
 * An Org-Owner-defined field attached to Documents within a Writing Type (for
 * example, "Writing Topic"), captured as structured data and enforced at
 * submission when `required` (REQ-ORG-CONFIG-01 / Requirements 30.3, 30.4).
 *
 * Product decision (tasks.md): only "Writing Topic" is ever seeded as the
 * illustrative field — "Location Reference" is intentionally never seeded. The
 * mechanism itself remains fully configurable/arbitrary Org-Owner-defined DATA.
 */
export const customMetadataFieldSchema = z
  .object({
    id: idSchema,
    writingTypeId: idSchema,
    label: z.string().min(1),
    required: z.boolean(),
  })
  .strict();
export type CustomMetadataField = z.infer<typeof customMetadataFieldSchema>;

/** Input to create a custom metadata field within a Writing Type. */
export const createCustomMetadataFieldInputSchema = z
  .object({
    writingTypeId: idSchema,
    label: z.string().min(1),
    required: z.boolean().optional(),
  })
  .strict();
export type CreateCustomMetadataFieldInput = z.infer<
  typeof createCustomMetadataFieldInputSchema
>;

/** Input to update a custom metadata field's mutable fields (label / required). */
export const updateCustomMetadataFieldInputSchema = z
  .object({
    label: z.string().min(1).optional(),
    required: z.boolean().optional(),
  })
  .strict();
export type UpdateCustomMetadataFieldInput = z.infer<
  typeof updateCustomMetadataFieldInputSchema
>;

/* -------------------------------------------------------------------------- */
/* WritingTypeDeletionImpact (Requirement 30.5 — confirmation before removal)  */
/* -------------------------------------------------------------------------- */

/**
 * Reports the impact of removing a Writing Type BEFORE deletion, so an Org
 * Owner (or Admin) can be shown an explicit confirmation describing what is
 * still attached (REQ-ORG-CONFIG-01 / Requirement 30.5). This is a read-only
 * report — it does not itself delete anything, and does not force deletion
 * through; a Writing Type with Documents is still RESTRICTed at the DB level.
 */
export const writingTypeDeletionImpactSchema = z
  .object({
    writingTypeId: idSchema,
    assignedFieldExpertCount: z.number().int().nonnegative(),
    documentCount: z.number().int().nonnegative(),
  })
  .strict();
export type WritingTypeDeletionImpact = z.infer<typeof writingTypeDeletionImpactSchema>;

/* -------------------------------------------------------------------------- */
/* Document (Requirement 6 — owned by a global User, scoped to a WritingType)  */
/* -------------------------------------------------------------------------- */

/** Document status is an extensible enum mapped to color tokens in the UI. */
export const documentStatusSchema = z.enum(['Still Drafting', 'Polishing']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentSchema = z
  .object({
    id: idSchema,
    ownerUserId: idSchema,
    writingTypeId: idSchema,
    contentTypeId: idSchema,
    name: z.string().min(1),
    /** Org-Owner-defined custom metadata field values (e.g. "Writing Topic"). */
    metadata: z.record(z.string(), z.string()),
    status: documentStatusSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type Document = z.infer<typeof documentSchema>;

/* -------------------------------------------------------------------------- */
/* Draft (Requirement 8 — immutable, monotonically versioned)                  */
/* -------------------------------------------------------------------------- */

/** An ordered paragraph segment; the substrate for anchoring and diffing. */
export const segmentSchema = z
  .object({
    index: z.number().int().nonnegative(),
    text: z.string(),
  })
  .strict();
export type Segment = z.infer<typeof segmentSchema>;

export const draftSchema = z
  .object({
    id: idSchema,
    documentId: idSchema,
    versionNumber: z.number().int().positive(),
    s3Key: z.string().min(1),
    segments: z.array(segmentSchema),
    wordCount: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;

/* -------------------------------------------------------------------------- */
/* ResolutionStatus (Requirement 17 — per Feedback Item)                       */
/* -------------------------------------------------------------------------- */

export const resolutionStatusSchema = z.enum([
  'resolved',
  'partially_resolved',
  'still_unresolved',
  'removed',
  'unchanged',
]);
export type ResolutionStatus = z.infer<typeof resolutionStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Anchor (Requirement 9 — ties feedback to a text span, re-mapped per draft)  */
/* -------------------------------------------------------------------------- */

export const anchorStateSchema = z.enum(['active', 'removed']);
export type AnchorState = z.infer<typeof anchorStateSchema>;

export const anchorSchema = z
  .object({
    id: idSchema,
    feedbackItemId: idSchema,
    draftId: idSchema,
    paragraphIndex: z.number().int().nonnegative(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    /** Normalized text hash + bounded surrounding context. */
    contentFingerprint: z.string().min(1),
    state: anchorStateSchema,
  })
  .strict();
export type Anchor = z.infer<typeof anchorSchema>;

/* -------------------------------------------------------------------------- */
/* FeedbackItem (Requirement 11 — NEVER carries replacement prose)             */
/* -------------------------------------------------------------------------- */

/** Inline (anchored) vs document-wide structural feedback. */
export const feedbackKindSchema = z.enum(['inline', 'structural']);
export type FeedbackKind = z.infer<typeof feedbackKindSchema>;

/**
 * A single unit of Socratic feedback. There is deliberately NO `replacementProse`
 * field; `.strict()` rejects any payload that tries to add one (REQ-CORE-NOGHOST-01).
 */
export const feedbackItemSchema = z
  .object({
    id: idSchema,
    documentId: idSchema,
    errorCategoryId: idSchema,
    kind: feedbackKindSchema,
    /** The Socratic question / error-type flag shown to the writer. */
    questionText: z.string().min(1),
    currentAnchorId: idSchema.optional(),
    citationReferenceId: idSchema.optional(),
    sourceDraftId: idSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

/* -------------------------------------------------------------------------- */
/* AccessGrant (Requirement 4.4 — associates a global User with a LOCKED scope) */
/* -------------------------------------------------------------------------- */

/** A grant is scoped to either a single Writing Type or an Organization grouping. */
export const grantScopeSchema = z.union([
  z.object({ writingTypeId: idSchema }).strict(),
  z.object({ organizationId: idSchema }).strict(),
]);
export type GrantScope = z.infer<typeof grantScopeSchema>;

export const accessGrantSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    scope: grantScopeSchema,
    grantedBy: idSchema,
    grantedAt: isoDateTimeSchema,
    revokedAt: isoDateTimeSchema.optional(),
  })
  .strict();
export type AccessGrant = z.infer<typeof accessGrantSchema>;

/** Input to create an Access Grant, associating a global User with a LOCKED scope. */
export const createAccessGrantInputSchema = z
  .object({
    userId: idSchema,
    scope: grantScopeSchema,
  })
  .strict();
export type CreateAccessGrantInput = z.infer<typeof createAccessGrantInputSchema>;

/**
 * A pending access request for a LOCKED scope (Requirement 4.6): a User
 * requesting a Writing Type or Organization they cannot currently reach.
 * Approving a request creates an Access Grant through the same code path as
 * direct grant creation — there is exactly one "grant creation" path.
 */
export const accessRequestApprovalInputSchema = z
  .object({
    userId: idSchema,
    scope: grantScopeSchema,
  })
  .strict();
export type AccessRequestApprovalInput = z.infer<typeof accessRequestApprovalInputSchema>;

/* -------------------------------------------------------------------------- */
/* AppUser (Requirement 29.1 — global, never owned by an Organization)         */
/* -------------------------------------------------------------------------- */

/**
 * A global User summary for system-wide directory search (REQ-ORG-02 /
 * Requirement 29.1). Carries no Organization ownership field — Users remain
 * global regardless of any Access Grant or role assignment they hold
 * (Requirement 29.4 / REQ-ORG-GROUPING-01).
 */
export const userSummarySchema = z
  .object({
    id: idSchema,
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    roles: z.array(roleSchema),
  })
  .strict();
export type UserSummary = z.infer<typeof userSummarySchema>;

/**
 * Search/filter/pagination input for the system-wide User directory.
 * `page`/`pageSize` are optional on input (defaulted to `1`/`20` inside
 * {@link userSearchInputSchema}'s `.parse()`), so callers may omit them
 * entirely for an unfiltered first-page search.
 */
export const userSearchInputSchema = z
  .object({
    /** Case-insensitive substring match against first name. */
    firstName: z.string().min(1).optional(),
    /** Case-insensitive substring match against last name. */
    lastName: z.string().min(1).optional(),
    /** Case-insensitive substring match against email. */
    email: z.string().min(1).optional(),
    /** Restrict to Users holding this role. */
    role: roleSchema.optional(),
    page: z.number().int().positive().default(1),
    pageSize: z.number().int().positive().max(100).default(20),
  })
  .strict();
/** The caller-supplied shape (defaults applied by `.parse()`, not required here). */
export type UserSearchInput = z.input<typeof userSearchInputSchema>;
/** The fully-resolved shape after `.parse()` applies `page`/`pageSize` defaults. */
export type ParsedUserSearchInput = z.output<typeof userSearchInputSchema>;

/** A single page of a User search, with the total match count for pagination UI. */
export const userSearchResultSchema = z
  .object({
    users: z.array(userSummarySchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .strict();
export type UserSearchResult = z.infer<typeof userSearchResultSchema>;

/* -------------------------------------------------------------------------- */
/* Role assignment input (Requirement 5 / 29.2, 29.3 — matrix-enforced)        */
/* -------------------------------------------------------------------------- */

/**
 * Input to assign a role to a User. `scope` follows {@link AssignmentScope}:
 * `{kind:'platform'}` for global roles (`User`, `Admin`), or
 * `{kind:'organization', organizationId}` for `Org Owner` (the Organization
 * being granted). `writingTypeId` is REQUIRED when `role` is `Field Expert` —
 * it is merged into that Field Expert's existing `writingTypeIds` array rather
 * than clobbering other assignments (Requirement 29.3); the owning
 * Organization for the authority check is resolved server-side from the
 * Writing Type, so `scope` is ignored for this role.
 */
export const assignRoleInputSchema = z
  .object({
    userId: idSchema,
    role: roleSchema,
    scope: assignmentScopeSchema,
    writingTypeId: idSchema.optional(),
  })
  .strict()
  .refine((value) => (value.role === 'Field Expert' ? value.writingTypeId !== undefined : true), {
    message: "'writingTypeId' is required when assigning the 'Field Expert' role",
    path: ['writingTypeId'],
  });
export type AssignRoleInput = z.infer<typeof assignRoleInputSchema>;

/**
 * Input to revoke a role from a User. `writingTypeId` is REQUIRED when `role`
 * is `Field Expert` — it removes only that Writing Type from the assignment's
 * `writingTypeIds` array, and the row is deleted entirely once none remain
 * (Requirement 29.3).
 */
export const revokeRoleInputSchema = z
  .object({
    userId: idSchema,
    role: roleSchema,
    scope: assignmentScopeSchema,
    writingTypeId: idSchema.optional(),
  })
  .strict()
  .refine((value) => (value.role === 'Field Expert' ? value.writingTypeId !== undefined : true), {
    message: "'writingTypeId' is required when revoking the 'Field Expert' role",
    path: ['writingTypeId'],
  });
export type RevokeRoleInput = z.infer<typeof revokeRoleInputSchema>;

/* -------------------------------------------------------------------------- */
/* Override (Requirement 54 — temporary, Writing-Type-scoped usage override)   */
/* -------------------------------------------------------------------------- */

/** Bounds an override permits while active. */
export const overrideBoundsSchema = z
  .object({
    additionalActions: z.number().int().positive(),
  })
  .strict();
export type OverrideBounds = z.infer<typeof overrideBoundsSchema>;

export const overrideSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    writingTypeId: idSchema,
    bounds: overrideBoundsSchema,
    reason: z.string().min(1),
    grantedBy: idSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();
export type Override = z.infer<typeof overrideSchema>;

/* -------------------------------------------------------------------------- */
/* ActivityEvent (Requirement 44 — Actor–Verb–Object, independent of documents)*/
/* -------------------------------------------------------------------------- */

export const activityEventSchema = z
  .object({
    id: idSchema,
    /** Stable pseudonymous actor id; never raw PII. */
    actorPseudonym: idSchema,
    verb: z.string().min(1),
    objectType: z.string().min(1),
    objectRef: z.string().min(1),
    writingTypeId: idSchema.optional(),
    organizationId: idSchema.optional(),
    timestamp: isoDateTimeSchema,
    /** Structured context; never raw document content. */
    context: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ActivityEvent = z.infer<typeof activityEventSchema>;
