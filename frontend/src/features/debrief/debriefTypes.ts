/**
 * AI Debrief response + helpfulness-rating shapes (task 18.3; Requirements
 * 11.2, 14.2, 16.1, 16.2, 16.5, 48.2).
 *
 * The debrief payload composes the shared `feedbackItemSchema` (`@wren/types`)
 * — it never redefines the feedback shape inline (frontend steering §7: shared
 * types are the single source of truth). Because `feedbackItemSchema` is
 * `.strict()`, a debrief response can never smuggle in a `replacementProse`
 * field; validating at this boundary (frontend steering §7 / design.md
 * "Frontend Error Posture") means malformed AI feedback fails safely instead of
 * rendering broken UI.
 *
 * `draftId` is the stable reference to the draft version the debrief was
 * generated against (frontend steering §3 "Draft anchoring" / §11 "Don't build
 * a single generic `<Modal>` usage for the AI Debrief without anchoring it to a
 * specific draft version reference").
 */
import { z } from 'zod';

import { feedbackItemSchema, idSchema, isoDateTimeSchema } from '@wren/types';

/** A single pattern-level progress acknowledgment (Requirement 18, REQ-PROGRESS-ACK-01). */
export const progressPatternSchema = z.object({
  category: z.string().min(1),
  tendency: z.enum(['improving', 'persistent', 'emerging']),
  description: z.string().min(1),
});
export type ProgressPattern = z.infer<typeof progressPatternSchema>;

export const debriefSchema = z
  .object({
    documentId: idSchema,
    /** The draft version this debrief was generated against (draft anchoring). */
    draftId: idSchema,
    generatedAt: isoDateTimeSchema,
    items: z.array(feedbackItemSchema),
    /** Pattern-level progress summary (REQ-PROGRESS-ACK-01); present only when >= 2 drafts exist. */
    progressSummary: z.array(progressPatternSchema).optional(),
  })
  .strict();
export type Debrief = z.infer<typeof debriefSchema>;

/**
 * Input for the helpfulness-rating audit-event call site
 * (`recordFeedbackHelpfulness` in `./debriefApi`). The real Audit_Service
 * (task 14) is not built yet; this shape is what will eventually be logged as
 * an Actor–Verb–Object activity event once it lands.
 */
export const feedbackHelpfulnessInputSchema = z
  .object({
    environmentId: idSchema,
    draftId: idSchema,
    helpful: z.boolean(),
    comment: z.string().min(1).optional(),
  })
  .strict();
export type FeedbackHelpfulnessInput = z.infer<
  typeof feedbackHelpfulnessInputSchema
>;

export const helpfulnessAckSchema = z.object({ recorded: z.boolean() }).strict();
export type HelpfulnessAck = z.infer<typeof helpfulnessAckSchema>;
