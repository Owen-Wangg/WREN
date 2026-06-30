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
