/**
 * Writer progress-summary view-model shapes (task 18.4; Requirements 18.1,
 * 18.3, 18.4).
 *
 * This is the payload the writer-facing progress view *consumes* — it is not
 * where resolution/pattern logic is computed. The backend Progress_Tracker
 * (task 8.6) detects patterns across drafts (improving / persistent / emerging)
 * and serializes this qualitative view model; the frontend renders it verbatim
 * and never recomputes resolution logic.
 *
 * **No-numeric-scoring (hard compliance, Requirement 18.3 / Property 19):** this
 * schema deliberately carries NO score, grade, ranking, rating, or
 * User-to-User comparison field. Progress is expressed purely qualitatively via
 * the `tendency` enum and free-text `headline`/`description` strings. Because
 * the schema is `.strict()`, a payload that tried to smuggle in a numeric
 * `score`/`grade`/`rank` field would fail validation at the boundary
 * (frontend steering §7) rather than reach the writer's screen.
 *
 * `draftId` + `reflectsDraftVersion` are the draft-anchoring reference
 * (frontend steering §3): the summary is bound to the specific draft version it
 * was generated against and must not silently drift across draft versions.
 * `reflectsDraftVersion` is structural draft metadata used to gate rendering
 * (a summary is only shown once a prior draft exists) — it is not a score and is
 * never rendered as writer-facing body text.
 */
import { z } from 'zod';

import { idSchema } from '@wren/types';

/**
 * Qualitative pattern tendency across ≥2 drafts (design.md Progress_Tracker:
 * "improving / persistent / emerging"). No magnitude, no number — a tendency
 * only.
 */
export const progressTendencySchema = z.enum([
  'improving',
  'persistent',
  'emerging',
]);
export type ProgressTendency = z.infer<typeof progressTendencySchema>;

/**
 * A single recognized pattern. `description` is Socratic-consistent, qualitative
 * prose (Requirement 18.4) — never replacement prose, never a numeric rating.
 */
export const progressPatternSchema = z
  .object({
    id: idSchema,
    /** Links to the error category this pattern concerns (by id, per taxonomy). */
    errorCategoryId: idSchema,
    /** Human-readable category label to show the writer (qualitative). */
    categoryLabel: z.string().min(1),
    tendency: progressTendencySchema,
    /** Qualitative, Socratic-consistent description. No scores/grades/rankings. */
    description: z.string().min(1),
  })
  .strict();
export type ProgressPattern = z.infer<typeof progressPatternSchema>;

/**
 * The writer-facing progress summary for a document's current draft.
 *
 * Draft anchoring (steering §3): bound to `draftId` / `reflectsDraftVersion`.
 * Pattern-level claims are only meaningful once a prior draft exists
 * (Requirement 18.5); on the first draft the backend returns
 * `reflectsDraftVersion === 1` with no patterns and the view renders nothing.
 */
export const writerProgressSummarySchema = z
  .object({
    documentId: idSchema,
    /** Draft anchoring: the draft this summary reflects. */
    draftId: idSchema,
    /** The version number of the draft this summary reflects (≥ 1). */
    reflectsDraftVersion: z.number().int().positive(),
    /** Qualitative headline shown above the patterns. No numeric content. */
    headline: z.string().min(1),
    patterns: z.array(progressPatternSchema),
  })
  .strict();
export type WriterProgressSummary = z.infer<typeof writerProgressSummarySchema>;
