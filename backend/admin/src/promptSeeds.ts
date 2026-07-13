/**
 * No-ghostwriting-compliant default prompt seeds (Task 12.6; REQ-CORE-NOGHOST-01
 * / Requirement 11.7, REQ-TAXONOMY-01 / Requirement 15.5).
 *
 * **CONFLICT-1 (resolved):** the Figma "Prompt Configurations - Instructor"
 * frame (96:645, node 99:651) — the design source this platform otherwise
 * follows — displays a SAMPLE prompt that instructs the model to "Suggest a
 * revised version of the passage" and explain "why the revision is an
 * improvement." That sample violates REQ-CORE-NOGHOST-01 criteria 1, 3, and
 * 6 outright. Requirement 11.7 is explicit: "THE platform SHALL NOT ship any
 * seeded, default, or sample prompt that instructs the model to produce
 * replacement prose, suggest a revised version, or justify an improvement."
 * {@link LEGAL_MEMO_TYPE_PROMPT_TEXT} below is the rewritten, Socratic-only
 * replacement — it never asks the model to produce a revision or justify one,
 * only to surface questions and flags anchored to the writer's own text.
 *
 * **Requirement 15.5**: the `sample-taxonomy.md` legal-writing categories are
 * ONE example configuration for ONE Document Type (a demo "Legal Memo").
 * {@link seedLegalMemoDefaults} seeds them ONLY for that single Document
 * Type; nothing in this module seeds ANY category for any other Document
 * Type. New Document Types therefore start with an empty taxonomy by
 * construction — there is no "seed everything" entry point and no shared
 * default-category list a caller could accidentally apply platform-wide.
 *
 * `internalGuidance` values here mirror the "What's wrong" diagnostic notes
 * in `sample-taxonomy.md` — they are Feedback-Engine detection aids ONLY
 * (`wren_engine.prompt_assembly` inner layer) and must never be surfaced to a
 * Student (Requirement 15.4). This module never seeds a `correctVersion` /
 * `replacementProse` field — no such field exists on {@link ErrorCategory}
 * for exactly this reason (REQ-CORE-NOGHOST-01, `@wren/types` `.strict()`
 * schemas).
 *
 * Every seeded prompt is asserted ghostwriting-free by {@link assertGhostwritingFree}
 * at seed time (belt-and-suspenders with the save-time guardrail in
 * `documentTypeConfigService.ts`, Task 12.3) AND by a unit test
 * (`promptSeeds.test.ts`) so a future edit to these constants that
 * reintroduces a ghostwriting instruction fails CI rather than shipping.
 */
import type { CreateErrorCategoryInput } from '@wren/types';

import { assertGhostwritingFree } from './promptGuardrail';

/**
 * The rewritten, Socratic-only Document-Type prompt for the demo "Legal
 * Memo" Document Type, replacing the Figma mockup's ghostwriting-violating
 * sample (CONFLICT-1). Asks the model to surface questions and flags only —
 * never a revision, never a justification for a revision.
 */
export const LEGAL_MEMO_TYPE_PROMPT_TEXT: string = [
  'When reviewing a legal memo, identify passages that fall into one of the',
  "configured error categories below. For each one, ask the writer a Socratic",
  'question that helps them notice and diagnose the issue themselves, or',
  'flag the category without commentary — do not state what the corrected',
  'text should say. Prioritize recurring patterns across the categories',
  'over one-off issues when the feedback density limit is reached.',
].join(' ');

/**
 * Error-category seed data for the demo "Legal Memo" Document Type, derived
 * from `sample-taxonomy.md`'s twelve reference-implementation categories.
 * `internalGuidance` mirrors each entry's "What's wrong" diagnostic note —
 * detection aid only, never Student-facing. `name` values are the taxonomy
 * labels a Department Admin would see and could rename (Requirement 15.2) —
 * renaming any of these in the running system preserves Feedback Item
 * linkage by `id` (Requirement 15.3) exactly as for any other category.
 *
 * Callers of {@link seedLegalMemoDefaults} still supply the Document Type id
 * (this module holds no opinion on IDs) — these are plain
 * `CreateErrorCategoryInput`-shaped records missing only `documentTypeId`.
 */
export const LEGAL_MEMO_CATEGORY_SEEDS: ReadonlyArray<Omit<CreateErrorCategoryInput, 'documentTypeId'>> =
  [
    {
      name: 'Unclear Writing',
      internalGuidance:
        'The sentence conflates multiple legal concepts and buries the holding; the causal chain is ambiguous.',
    },
    {
      name: 'Inaccurate Summary',
      internalGuidance:
        'The writer attributes a legal standard to the wrong question, or misrepresents the court/party role in a quoted passage.',
    },
    {
      name: 'Grammar Error / Missing Quotation',
      internalGuidance:
        'Sentence fragments, missing quotation marks around quoted case language, or missing pinpoint citations.',
    },
    {
      name: 'Incorrect Legal Terminology',
      internalGuidance:
        'Non-standard or incorrect legal terms are used where a precise term of art exists (e.g. wrong verb for a court\'s action).',
    },
    {
      name: 'Incorrect Style / Imprecise Language',
      internalGuidance:
        'Imprecise word choice (e.g. "future" vs "subsequent" cases) or awkward/ambiguous phrasing that obscures the intended meaning.',
    },
    {
      name: 'Misattributed or Unfenced Quotation',
      internalGuidance:
        'A quotation is attributed to the wrong party (e.g. dissent vs majority), reversing who actually said it.',
    },
    {
      name: 'Tense and Structural Errors',
      internalGuidance:
        'Verb tense is inconsistent with the surrounding narrative of a completed judicial analysis.',
    },
    {
      name: 'Imprecise Case Reference / Passive Attribution',
      internalGuidance:
        'A case name is used as if it were the deciding court, or passive constructions obscure who found what.',
    },
    {
      name: 'Syntactic Ambiguity',
      internalGuidance:
        'A parallel clause structure (e.g. a "whether... or..." construction) is broken, creating ambiguity.',
    },
    {
      name: 'Structural / Sentence-Level Clarity',
      internalGuidance:
        'A connector word (e.g. "where") is used incorrectly for the relationship being described between two sequential events.',
    },
    {
      name: 'Errors in Logic / Factual Accuracy in Writing',
      internalGuidance:
        'Arithmetic or statistical claims do not check out, or a logical leap is unsupported by the stated premises.',
    },
    {
      name: 'Currency / Statutory Accuracy',
      internalGuidance:
        'A statutory or legislative description is imprecise about scope (e.g. what a Code definition actually covers) or omits material detail (e.g. a bill\'s full title/sponsor).',
    },
  ];

/**
 * Assert that every seed prompt this module ships is ghostwriting-free.
 * Called at seed time (belt-and-suspenders with the interactive save-time
 * guardrail) and exercised directly by `promptSeeds.test.ts` so CI fails
 * immediately if a future edit reintroduces a ghostwriting instruction
 * (Requirement 11.7).
 */
export function assertSeedPromptsAreGhostwritingFree(): void {
  assertGhostwritingFree(LEGAL_MEMO_TYPE_PROMPT_TEXT);
}

/**
 * Build the create-input records to seed the demo "Legal Memo" Document
 * Type's taxonomy, given its id. Does not itself touch the database — the
 * caller (a one-time admin seed script, or a test) passes each returned
 * input to {@link createErrorCategory} (`errorCategoryService.ts`) using an
 * actor authorized for that Document Type's Department.
 *
 * Deliberately the ONLY function in this module that produces category seed
 * data, and it is scoped to exactly one Document Type id — there is no
 * "seed all Document Types" entry point, so every OTHER Document Type
 * necessarily starts with an empty taxonomy (Requirement 15.5).
 */
export function buildLegalMemoCategorySeeds(
  documentTypeId: string,
): CreateErrorCategoryInput[] {
  return LEGAL_MEMO_CATEGORY_SEEDS.map((seed) => ({
    ...seed,
    documentTypeId,
  }));
}
