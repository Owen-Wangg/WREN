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
 * Naming note: the design's "Document Type" entity is implemented here as the
 * configurable, user-selectable {@link DocumentType} (see tasks.md product
 * decision 2). It is data, never a hardcoded domain enumeration.
 */
import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';
import { assignmentScopeSchema } from './authorization';

/* -------------------------------------------------------------------------- */
/* Role (Requirement 1.1 — stored role identities)                            */
/* -------------------------------------------------------------------------- */

/** Canonical role identifiers stored in the application database. */
export const roleSchema = z.enum(['Student', 'DepartmentAdmin', 'TechnicalAdmin']);
export type Role = z.infer<typeof roleSchema>;

/* -------------------------------------------------------------------------- */
/* Access state (Requirement 4 / 28 — OPEN / LOCKED for Document Types)        */
/* -------------------------------------------------------------------------- */

/**
 * Access state for a Document Type. A Document Type is either OPEN (any
 * authenticated Student may self-select and submit) or LOCKED (submission
 * requires an Access Grant scoped to that Document Type).
 */
export const documentTypeAccessStateSchema = z.enum(['OPEN', 'LOCKED']);
export type DocumentTypeAccessState = z.infer<typeof documentTypeAccessStateSchema>;

/**
 * Outcome of the Auth_Service access-resolution check for a (User, Document
 * Type) pair, consumed by the Document submission gate (design "Admin / Auth /
 * Usage Service"; Requirements 4.2, 4.3, 6.8, 28.3).
 *
 * - `OPEN`    — the Document Type's access state is OPEN; any authenticated
 *               global Student may self-select and submit without an Access Grant.
 * - `GRANTED` — the Document Type's access state is LOCKED, but the User holds
 *               an applicable Access Grant scoped to that Document Type, so
 *               submission is permitted.
 * - `DENIED`  — the Document Type's access state is LOCKED and the User holds
 *               no applicable grant; submission is refused and the
 *               access-request flow should be offered (Requirement 4.6).
 *
 * `OPEN` and `GRANTED` both permit submission; `DENIED` does not.
 */
export const accessDecisionSchema = z.enum(['OPEN', 'GRANTED', 'DENIED']);
export type AccessDecision = z.infer<typeof accessDecisionSchema>;

/* -------------------------------------------------------------------------- */
/* Department (Requirement 28 — a grouping that owns NO Users)                 */
/* -------------------------------------------------------------------------- */

/**
 * A Department is a GROUPING of Document Types, the DepartmentAdmins who
 * maintain them, department-wide Reference Material, and business Topics —
 * never a data-isolation boundary and never an owner of Users (Requirement 28.1
 * / 28.2). Departments are created implicitly via DepartmentAdmin appointment.
 */
export const departmentSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    prompt: z.string().nullable().optional(),
    /**
     * Department-wide student access. OPEN = any student may self-select
     * document types in this department; LOCKED = grant required. Controlled
     * by TechnicalAdmin only.
     */
    accessState: documentTypeAccessStateSchema.optional(),
    /** Count of distinct users who have uploaded at least one document under this department. */
    activeUserCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type Department = z.infer<typeof departmentSchema>;

/**
 * Input to create a Department.
 */
export const createDepartmentInputSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();
export type CreateDepartmentInput = z.infer<typeof createDepartmentInputSchema>;

/** Input to update a Department's mutable catalog fields (its name). */
export const updateDepartmentInputSchema = z
  .object({
    name: z.string().min(1),
  })
  .strict();
export type UpdateDepartmentInput = z.infer<typeof updateDepartmentInputSchema>;

/** Input to update a Department's department-level prompt text. */
export const updateDepartmentPromptInputSchema = z
  .object({
    prompt: z.string().nullable(),
  })
  .strict();
export type UpdateDepartmentPromptInput = z.infer<typeof updateDepartmentPromptInputSchema>;

/* -------------------------------------------------------------------------- */
/* DocumentType (configurable, self-selectable — design "Document Type")        */
/* -------------------------------------------------------------------------- */

export const documentTypeSchema = z
  .object({
    id: idSchema,
    departmentId: idSchema,
    name: z.string().min(1),
    accessState: documentTypeAccessStateSchema,
    /** Null → inherit the platform default size limit. */
    sizeLimitWords: z.number().int().positive().nullable(),
  })
  .strict();
export type DocumentType = z.infer<typeof documentTypeSchema>;

/**
 * Input to create a Document Type catalog record. A Document Type is
 * configurable, self-selectable DATA — never a hardcoded domain enumeration
 * (tasks.md product decision 2). New records always start with a `LOCKED`
 * access state: changing a Document Type to OPEN is a separate,
 * Admin-controlled access-state operation (Requirement 28.4 / 33.2), kept
 * distinct from catalog management (Requirement 30.1). `sizeLimitWords` is
 * optional catalog configuration.
 */
export const createDocumentTypeInputSchema = z
  .object({
    departmentId: idSchema,
    name: z.string().min(1),
    sizeLimitWords: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type CreateDocumentTypeInput = z.infer<typeof createDocumentTypeInputSchema>;

/** Input to update a Document Type's mutable catalog fields (name / size limit). */
export const updateDocumentTypeInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    sizeLimitWords: z.number().int().positive().nullable().optional(),
  })
  .strict();
export type UpdateDocumentTypeInput = z.infer<typeof updateDocumentTypeInputSchema>;

/* -------------------------------------------------------------------------- */
/* ContentType (Requirement 30.2 — DepartmentAdmin-defined, scoped to a         */
/* DocumentType)                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A DepartmentAdmin-defined category of document within a Document Type (for
 * example, "case brief", "memo", "tort claim proposal"), used to organize
 * submissions and scope configuration (REQ-ORG-CONFIG-01 / Requirement 30.2).
 */
export const contentTypeSchema = z
  .object({
    id: idSchema,
    documentTypeId: idSchema,
    label: z.string().min(1),
  })
  .strict();
export type ContentType = z.infer<typeof contentTypeSchema>;

/** Input to create a Content Type within a Document Type. */
export const createContentTypeInputSchema = z
  .object({
    documentTypeId: idSchema,
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
/* Topic (REQ-TOPIC-01 / Requirement 35 — business label, scoped to ONE dept)  */
/* -------------------------------------------------------------------------- */

/**
 * A business Topic used to organize Users' work, scoped to exactly ONE
 * administered Department (REQ-TOPIC-01 / Requirement 35.1, 35.2). A Topic is
 * purely a business-layer label — it is NOT a data-isolation boundary
 * (REQ-ORG-GROUPING-01) and it NEVER drives error taxonomy, Reference Material
 * selection, or feedback generation (Requirement 35.3); those remain Document
 * Type concerns. A Topic is distinct from a Document's per-document "Writing
 * Topic" Custom Metadata Field value — the catalog entry here and the free-form
 * value stored on a Document are independent (Requirement 35.4); deleting a
 * Topic never alters a Document's stored value.
 */
export const topicSchema = z
  .object({
    id: idSchema,
    departmentId: idSchema,
    name: z.string().min(1),
  })
  .strict();
export type Topic = z.infer<typeof topicSchema>;

/** Input to create a Topic within an administered Department. */
export const createTopicInputSchema = z
  .object({
    departmentId: idSchema,
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
 * Reports the impact of removing a Topic BEFORE deletion, so a DepartmentAdmin
 * (or TechnicalAdmin) can be shown an explicit confirmation when Documents
 * currently carry this Topic's name as their "Writing Topic" custom-metadata
 * value (REQ-TOPIC-01 / Requirement 35.5). This is a read-only, best-effort
 * report — Document metadata values are independent per-document strings, not a
 * foreign key to `topic.id`, so deleting a Topic never cascades into or blanks
 * any Document's stored metadata; this count exists solely so the caller can
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
/* DocumentType)                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A DepartmentAdmin-defined field attached to Documents within a Document Type
 * (for example, "Writing Topic"), captured as structured data and enforced at
 * submission when `required` (REQ-ORG-CONFIG-01 / Requirements 30.3, 30.4).
 *
 * Product decision (tasks.md): only "Writing Topic" is ever seeded as the
 * illustrative field — "Location Reference" is intentionally never seeded. The
 * mechanism itself remains fully configurable/arbitrary DepartmentAdmin-defined
 * DATA.
 */
export const customMetadataFieldSchema = z
  .object({
    id: idSchema,
    documentTypeId: idSchema,
    label: z.string().min(1),
    required: z.boolean(),
  })
  .strict();
export type CustomMetadataField = z.infer<typeof customMetadataFieldSchema>;

/** Input to create a custom metadata field within a Document Type. */
export const createCustomMetadataFieldInputSchema = z
  .object({
    documentTypeId: idSchema,
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
/* DocumentTypeDeletionImpact (Requirement 30.5 — confirmation before removal) */
/* -------------------------------------------------------------------------- */

/**
 * Reports the impact of removing a Document Type BEFORE deletion, so a
 * DepartmentAdmin (or TechnicalAdmin) can be shown an explicit confirmation
 * describing what is still attached (REQ-ORG-CONFIG-01 / Requirement 30.5).
 * This is a read-only report — it does not itself delete anything, and does not
 * force deletion through; a Document Type with Documents is still RESTRICTed at
 * the DB level.
 */
export const documentTypeDeletionImpactSchema = z
  .object({
    documentTypeId: idSchema,
    documentCount: z.number().int().nonnegative(),
  })
  .strict();
export type DocumentTypeDeletionImpact = z.infer<typeof documentTypeDeletionImpactSchema>;

/* -------------------------------------------------------------------------- */
/* Document (Requirement 6 — owned by a global User, scoped to a DocumentType) */
/* -------------------------------------------------------------------------- */

/** Document status is an extensible enum mapped to color tokens in the UI. */
export const documentStatusSchema = z.enum(['Still Drafting', 'Polishing']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentSchema = z
  .object({
    id: idSchema,
    ownerUserId: idSchema,
    documentTypeId: idSchema,
    contentTypeId: idSchema.nullable().optional(),
    name: z.string().min(1),
    /** DepartmentAdmin-defined custom metadata field values (e.g. "Writing Topic"). */
    metadata: z.record(z.string(), z.string()),
    status: documentStatusSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type Document = z.infer<typeof documentSchema>;

/**
 * Input to create a Document from a file upload or pasted text. `source.kind`
 * distinguishes an S3-uploaded file (`key`) from pasted text (`text`).
 * `contentTypeId` is optional at creation; `metadata` carries any
 * DepartmentAdmin-defined custom field values captured at submission.
 */
export const createDocumentSourceSchema = z
  .object({
    kind: z.enum(['file', 'paste']),
    text: z.string().optional(),
    key: z.string().optional(),
  })
  .strict();
export type CreateDocumentSource = z.infer<typeof createDocumentSourceSchema>;

/** Loose TipTap document JSON (type: "doc"). Not fully schema-validated. */
export const tipTapDocSchema = z
  .object({
    type: z.literal('doc'),
  })
  .passthrough();
export type TipTapDoc = z.infer<typeof tipTapDocSchema>;

export const createDocumentInputSchema = z
  .object({
    documentTypeId: idSchema,
    contentTypeId: idSchema.optional(),
    name: z.string().min(1),
    metadata: z.record(z.string(), z.string()).default({}),
    source: createDocumentSourceSchema,
    /** Optional client-parsed TipTap JSON; server derives segments when present. */
    content: tipTapDocSchema.optional(),
  })
  .strict();
export type CreateDocumentInput = z.infer<typeof createDocumentInputSchema>;

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
    /** TipTap JSONContent when rich formatting was persisted; omit for legacy. */
    content: tipTapDocSchema.optional(),
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
 * `quotedText` is an optional exact quote from the document that triggered this
 * feedback, for context without generation.
 */
export const feedbackItemSchema = z
  .object({
    id: idSchema,
    documentId: idSchema,
    errorCategoryId: idSchema,
    kind: feedbackKindSchema,
    /** The Socratic question / error-type flag shown to the writer. */
    questionText: z.string().min(1),
    /** Exact quote from the document that triggered this feedback (no generation). */
    quotedText: z.string().optional(),
    currentAnchorId: idSchema.optional(),
    citationReferenceId: idSchema.optional(),
    sourceDraftId: idSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

/* -------------------------------------------------------------------------- */
/* AccessGrant (Requirement 4.4 — associates a global User with a LOCKED        */
/* Document Type)                                                              */
/* -------------------------------------------------------------------------- */

/**
 * An Access Grant associates a global User with a LOCKED Document Type,
 * permitting submission to that Document Type (Requirement 4.4).
 */
export const accessGrantSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    documentTypeId: idSchema,
    grantedBy: idSchema,
    grantedAt: isoDateTimeSchema,
    revokedAt: isoDateTimeSchema.optional(),
  })
  .strict();
export type AccessGrant = z.infer<typeof accessGrantSchema>;

/** Input to create an Access Grant, associating a global User with a LOCKED Document Type. */
export const createAccessGrantInputSchema = z
  .object({
    userId: idSchema,
    documentTypeId: idSchema,
  })
  .strict();
export type CreateAccessGrantInput = z.infer<typeof createAccessGrantInputSchema>;

/**
 * A pending access request for a LOCKED Document Type (Requirement 4.6): a
 * User requesting a Document Type they cannot currently reach. Approving a
 * request creates an Access Grant through the same code path as direct grant
 * creation — there is exactly one "grant creation" path.
 */
export const accessRequestApprovalInputSchema = z
  .object({
    userId: idSchema,
    documentTypeId: idSchema,
  })
  .strict();
export type AccessRequestApprovalInput = z.infer<typeof accessRequestApprovalInputSchema>;

/* -------------------------------------------------------------------------- */
/* AppUser (Requirement 29.1 — global, never owned by a Department)            */
/* -------------------------------------------------------------------------- */

/**
 * A global User summary for system-wide directory search (REQ-ORG-02 /
 * Requirement 29.1). Carries no Department ownership field — Users remain
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
 * `{kind:'platform'}` for global roles (`Student`, `TechnicalAdmin`), or
 * `{kind:'department', departmentId}` for `DepartmentAdmin` (the Department
 * being administered). `departmentId` is REQUIRED when `role` is
 * `DepartmentAdmin` — it identifies the Department being administered; the
 * assignment scope is resolved server-side from this field.
 */
export const assignRoleInputSchema = z
  .object({
    userId: idSchema,
    role: roleSchema,
    scope: assignmentScopeSchema,
    departmentId: idSchema.optional(),
  })
  .strict()
  .refine(
    (value) => (value.role === 'DepartmentAdmin' ? value.departmentId !== undefined : true),
    {
      message: "'departmentId' is required when assigning the 'DepartmentAdmin' role",
      path: ['departmentId'],
    },
  );
export type AssignRoleInput = z.infer<typeof assignRoleInputSchema>;

/**
 * Input to revoke a role from a User. `departmentId` is REQUIRED when `role`
 * is `DepartmentAdmin` — it identifies which Department administration to
 * revoke.
 */
export const revokeRoleInputSchema = z
  .object({
    userId: idSchema,
    role: roleSchema,
    scope: assignmentScopeSchema,
    departmentId: idSchema.optional(),
  })
  .strict()
  .refine(
    (value) => (value.role === 'DepartmentAdmin' ? value.departmentId !== undefined : true),
    {
      message: "'departmentId' is required when revoking the 'DepartmentAdmin' role",
      path: ['departmentId'],
    },
  );
export type RevokeRoleInput = z.infer<typeof revokeRoleInputSchema>;

/* -------------------------------------------------------------------------- */
/* Override (Requirement 54 — temporary, Document-Type-scoped usage override)   */
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
    documentTypeId: idSchema,
    bounds: overrideBoundsSchema,
    reason: z.string().min(1),
    grantedBy: idSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();
export type Override = z.infer<typeof overrideSchema>;

/**
 * Input to grant a temporary, Document-Type-scoped usage override
 * (Requirement 54.5). `expiresAt` is the usage-period reset boundary the
 * override is bound to (Requirement 54.7); the grantor's identity is taken
 * from the authenticated actor, not from this input.
 */
export const createOverrideInputSchema = z
  .object({
    userId: idSchema,
    documentTypeId: idSchema,
    bounds: overrideBoundsSchema,
    reason: z.string().min(1),
    expiresAt: isoDateTimeSchema,
  })
  .strict();
export type CreateOverrideInput = z.infer<typeof createOverrideInputSchema>;

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
    documentTypeId: idSchema.optional(),
    departmentId: idSchema.optional(),
    timestamp: isoDateTimeSchema,
    /** Structured context; never raw document content. */
    context: z.record(z.string(), z.unknown()),
  })
  .strict();
export type ActivityEvent = z.infer<typeof activityEventSchema>;

/* -------------------------------------------------------------------------- */
/* AggregateCounter (Requirements 40-43 — all-users aggregate read model;      */
/* never per-Student; retained across document deletion)                       */
/* -------------------------------------------------------------------------- */

/**
 * A single all-users aggregate metric value for one scope and time window.
 * `scopeKind`/`scopeId` mirror {@link UsageScope}'s shape (platform or one
 * Document Type) so analytics and usage share one scoping vocabulary.
 * `value` is a plain count/total across every Student in scope — this type
 * carries NO per-Student breakdown, name, or identity (Requirement 43.2).
 */
export const aggregateCounterSchema = z
  .object({
    id: idSchema,
    scopeKind: z.enum(['platform', 'documentType']),
    scopeId: idSchema.optional(),
    metric: z.string().min(1),
    windowStart: isoDateTimeSchema,
    value: z.number().int().nonnegative(),
  })
  .strict();
export type AggregateCounter = z.infer<typeof aggregateCounterSchema>;

/**
 * A request for aggregate analytics. `documentTypeId` filters to one
 * Document Type; omitted, the result spans every Document Type in the
 * caller's authorized scope (administered Departments for a DepartmentAdmin,
 * the whole platform for a TechnicalAdmin) — Requirements 41.2, 42.2.
 */
export const analyticsQuerySchema = z
  .object({
    documentTypeId: idSchema.optional(),
  })
  .strict();
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/**
 * The result of an analytics query: all-users aggregate totals only, one
 * entry per metric/scope combination in the authorized/filtered set. There is
 * deliberately no field for a per-Student value, name, or identity anywhere
 * in this type (Requirements 40.6, 41.6, 42.5, 43.2) — see
 * `analyticsResultSchema`'s guard registration in `index.ts`.
 */
export const analyticsResultSchema = z
  .object({
    totals: z.array(aggregateCounterSchema),
  })
  .strict();
export type AnalyticsResult = z.infer<typeof analyticsResultSchema>;

/* -------------------------------------------------------------------------- */
/* ErrorCategory (Requirement 15 — REQ-TAXONOMY-01: configurable taxonomy,     */
/* never a hardcoded enum; Task 12.1)                                          */
/* -------------------------------------------------------------------------- */

/**
 * A single error-taxonomy category, scoped to one Document Type. Stored as
 * DATA (never an enum) so a DepartmentAdmin can add/remove/rename categories
 * per Document Type (REQ-TAXONOMY-01 / Requirement 15.1, 15.2). `id` is the
 * link Feedback Items classify against — renaming updates only `name`, so a
 * rename never breaks existing Feedback Item linkage (Requirement 15.3).
 *
 * `internalGuidance` is a detection aid for the Feedback Engine's prompt
 * assembly ONLY — it must never be surfaced to a Student (Requirement 15.4 /
 * REQ-CORE-NOGHOST-01), so it is deliberately absent from any Student-facing
 * projection of this type (callers must not spread this schema's output into a
 * Student-facing response).
 */
export const errorCategorySchema = z
  .object({
    id: idSchema,
    documentTypeId: idSchema,
    name: z.string().min(1),
    internalGuidance: z.string().nullable(),
  })
  .strict();
export type ErrorCategory = z.infer<typeof errorCategorySchema>;

/** Input to add a new error category to a Document Type's taxonomy. */
export const createErrorCategoryInputSchema = z
  .object({
    documentTypeId: idSchema,
    name: z.string().min(1),
    internalGuidance: z.string().nullable().optional(),
  })
  .strict();
export type CreateErrorCategoryInput = z.infer<typeof createErrorCategoryInputSchema>;

/**
 * Input to rename/update a category. `name` alone may change; `id` (and thus
 * Feedback Item linkage) is immutable (Requirement 15.3).
 */
export const updateErrorCategoryInputSchema = z
  .object({
    name: z.string().min(1).optional(),
    internalGuidance: z.string().nullable().optional(),
  })
  .strict();
export type UpdateErrorCategoryInput = z.infer<typeof updateErrorCategoryInputSchema>;

/* -------------------------------------------------------------------------- */
/* DocumentTypeConfig (Requirement 24, 25, 27 — tone/density/priority/prompt;  */
/* Task 12.1, 12.3)                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A Document Type's feedback-generation configuration: tone, density,
 * category priority order, and its own (Department-Admin-authored) prompt
 * instruction text (REQ-CONFIG-CONV-01 / Requirement 24, REQ-PROMPT-DOCTYPE-01
 * / Requirement 25). Distinct from the platform's Technical-Admin-owned system
 * scaffolding ({@link SystemScaffolding}), which always takes precedence and is
 * never editable here (design.md "Edit boundary").
 *
 * `updatedAt` drives the Feedback Engine's carry-forward cache invalidation —
 * any change to this record invalidates previously cached feedback for the
 * Document Type (Requirement 27.3 / REQ-NFR-COST-01).
 */
export const documentTypeConfigSchema = z
  .object({
    documentTypeId: idSchema,
    /** Free-form tone label (e.g. "formal", "encouraging"); not an enum. */
    tone: z.string().min(1).nullable(),
    /** Free-form density setting (e.g. "low" | "medium" | "high"); not an enum. */
    density: z.string().min(1).nullable(),
    /** Ordered `ErrorCategory` ids, most-prioritized first (Requirement 24.3). */
    categoryPriority: z.array(idSchema),
    /** Department-Admin-authored Document-Type prompt instruction text. */
    typePromptText: z.string().nullable(),
    /** Tone guidance for feedback generation (e.g., "Be supportive and encouraging"). */
    toneDescription: z.string().nullable().optional(),
    /** Density guidance for feedback generation (e.g., "Provide comprehensive feedback"). */
    densityDescription: z.string().nullable().optional(),
    /** Structure & organization guidance for the document type. */
    structureDescription: z.string().nullable().optional(),
    /** Restrictions and don'ts for the document type. */
    restrictionsDescription: z.string().nullable().optional(),
    /** Additional notes / miscellaneous guidance. */
    notesDescription: z.string().nullable().optional(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type DocumentTypeConfig = z.infer<typeof documentTypeConfigSchema>;

/** Partial update to a Document Type's tone/density/priority/prompt config. */
export const updateDocumentTypeConfigInputSchema = z
  .object({
    tone: z.string().min(1).nullable().optional(),
    density: z.string().min(1).nullable().optional(),
    categoryPriority: z.array(idSchema).optional(),
    typePromptText: z.string().nullable().optional(),
    toneDescription: z.string().nullable().optional(),
    densityDescription: z.string().nullable().optional(),
    structureDescription: z.string().nullable().optional(),
    restrictionsDescription: z.string().nullable().optional(),
    notesDescription: z.string().nullable().optional(),
  })
  .strict();
export type UpdateDocumentTypeConfigInput = z.infer<
  typeof updateDocumentTypeConfigInputSchema
>;

/**
 * Error returned when saved prompt content is rejected/transformed by the
 * save-time no-ghostwriting guardrail (REQ-PROMPT-EDIT-01 / Requirement 32.5).
 * `offendingText` is the specific substring identified as an instruction to
 * produce replacement prose, a rewrite, or a justification for a revision, so
 * the editor can highlight exactly what must be removed.
 */
export const promptGuardrailViolationSchema = z
  .object({
    offendingText: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict();
export type PromptGuardrailViolation = z.infer<typeof promptGuardrailViolationSchema>;

/* -------------------------------------------------------------------------- */
/* ReferenceMaterial (Requirement 20, 22, 26 — two-tier store; Task 12.5)      */
/* -------------------------------------------------------------------------- */

/** The scope tier of a Reference Material entry — mirrors `wren_engine.reference_store.ReferenceTier`. */
export const referenceMaterialTierSchema = z.enum(['department', 'type']);
export type ReferenceMaterialTier = z.infer<typeof referenceMaterialTierSchema>;

/** How a Reference Material's content was supplied. */
export const referenceMaterialContentKindSchema = z.enum(['file', 'text', 'html']);
export type ReferenceMaterialContentKind = z.infer<
  typeof referenceMaterialContentKindSchema
>;

/**
 * A Reference Material entry: Department-wide (tier 1) or Document-Type-scoped
 * (tier 2), managed by a DepartmentAdmin who administers the owning
 * Department (REQ-REFMAT-MGMT-01 / Requirement 26). `embeddingId` links to the
 * `wren_engine.reference_store` `embedding` table row(s) once indexed; it is
 * `null` until indexing completes.
 */
export const referenceMaterialSchema = z
  .object({
    id: idSchema,
    tier: referenceMaterialTierSchema,
    departmentId: idSchema,
    /** Required when `tier === 'type'`; absent for department-wide (tier 1). */
    documentTypeId: idSchema.nullable(),
    title: z.string().min(1),
    section: z.string().nullable(),
    contentKind: referenceMaterialContentKindSchema,
    /** Present when `contentKind === 'file'`. */
    s3Key: z.string().nullable(),
    /** Present when `contentKind` is `'text'` or `'html'`. */
    inlineContent: z.string().nullable(),
    embeddingId: idSchema.nullable(),
  })
  .strict()
  .refine(
    (value) => (value.tier === 'type' ? value.documentTypeId !== null : true),
    { message: 'documentTypeId is required when tier is "type"', path: ['documentTypeId'] },
  );
export type ReferenceMaterial = z.infer<typeof referenceMaterialSchema>;

/**
 * Input to create a Reference Material entry. Exactly one content source
 * (`s3Key` for `file`, `inlineContent` for `text`/`html`) is expected to
 * accompany the matching `contentKind`; the service layer validates that
 * pairing and performs no partial persistence on a mismatch (Requirement
 * 26.4, 26.5).
 */
export const createReferenceMaterialInputSchema = z
  .object({
    tier: referenceMaterialTierSchema,
    departmentId: idSchema,
    documentTypeId: idSchema.nullable().optional(),
    title: z.string().min(1),
    section: z.string().nullable().optional(),
    contentKind: referenceMaterialContentKindSchema,
    s3Key: z.string().nullable().optional(),
    inlineContent: z.string().nullable().optional(),
  })
  .strict();
export type CreateReferenceMaterialInput = z.infer<
  typeof createReferenceMaterialInputSchema
>;

/* -------------------------------------------------------------------------- */
/* UsageLimit / UsageCounter (Requirement 31, 54 — REQ-USAGE-LIMITS-01,        */
/* REQ-TOKEN-LIMIT-01; Task 13.1)                                             */
/* -------------------------------------------------------------------------- */

/**
 * The scope a usage limit or counter applies to. `platform` has no
 * associated Document Type; `documentType` always carries the specific
 * Document Type id it limits. There is deliberately NO `department` or
 * `organization` scope kind — usage is never attributed to a Student's
 * "home Department" (REQ-TOKEN-LIMIT-01 criterion 2).
 */
export const usageScopeSchema = z.union([
  z.object({ kind: z.literal('platform') }).strict(),
  z.object({ kind: z.literal('documentType'), documentTypeId: idSchema }).strict(),
]);
export type UsageScope = z.infer<typeof usageScopeSchema>;

/**
 * A usage-limit configuration record (Technical-Admin-owned;
 * REQ-USAGE-LIMITS-01 / Requirement 31.1, 31.3). `period` names the
 * recurring reset window (e.g. "monthly", "daily"); free-form, not an enum,
 * mirroring the platform's general "configurable, not hardcoded" convention.
 */
export const usageLimitSchema = z
  .object({
    id: idSchema,
    scope: usageScopeSchema,
    limitValue: z.number().int().nonnegative(),
    period: z.string().min(1),
  })
  .strict();
export type UsageLimit = z.infer<typeof usageLimitSchema>;

/** Input to create a usage limit at a given scope. */
export const createUsageLimitInputSchema = z
  .object({
    scope: usageScopeSchema,
    limitValue: z.number().int().nonnegative(),
    period: z.string().min(1),
  })
  .strict();
export type CreateUsageLimitInput = z.infer<typeof createUsageLimitInputSchema>;

/** Partial update to an existing usage limit's value and/or period. */
export const updateUsageLimitInputSchema = z
  .object({
    limitValue: z.number().int().nonnegative().optional(),
    period: z.string().min(1).optional(),
  })
  .strict();
export type UpdateUsageLimitInput = z.infer<typeof updateUsageLimitInputSchema>;

/**
 * Current usage relative to a configured limit, for one scope and usage
 * period (REQ-USAGE-LIMITS-01 / Requirement 31.2 — "display current usage
 * relative to the configured limit"). `remaining` is never negative (floors
 * at 0) even if `consumed` has exceeded `limitValue`.
 */
export const usageReportSchema = z
  .object({
    scope: usageScopeSchema,
    limitValue: z.number().int().nonnegative(),
    consumed: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    periodStart: isoDateTimeSchema,
  })
  .strict();
export type UsageReport = z.infer<typeof usageReportSchema>;

/**
 * System-wide lifetime usage policy (TechnicalAdmin-configurable).
 * Caps never reset by calendar period; each metric is counted against its
 * natural subject (document or user) for the lifetime of that subject.
 */
export const platformUsagePolicySchema = z
  .object({
    messageLimit: z.number().int().positive(),
    debriefGenerationLimit: z.number().int().positive(),
    documentUploadLimit: z.number().int().positive(),
    draftsPerDocumentLimit: z.number().int().positive(),
  })
  .strict();
export type PlatformUsagePolicy = z.infer<typeof platformUsagePolicySchema>;

/** Partial update to the platform lifetime usage policy. */
export const updatePlatformUsagePolicyInputSchema = platformUsagePolicySchema;
export type UpdatePlatformUsagePolicyInput = z.infer<
  typeof updatePlatformUsagePolicyInputSchema
>;
