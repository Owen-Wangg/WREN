/**
 * A lightweight, NON-authoritative client-side hint that surfaces likely
 * ghostwriting instructions in Writing-Type prompt text before a Field Expert
 * saves (task 19.2; Requirement 32.5).
 *
 * IMPORTANT — this is a helpful nudge, not the guardrail. The authoritative
 * no-ghostwriting enforcement runs on save in the backend Config Service
 * (task 12.3 / Property 11) which rejects or transforms any instruction that
 * would make the model produce replacement prose or justify a revision. This
 * helper never encourages ghostwriting and never offers a "generate a rewrite"
 * affordance; it only warns the author that a phrase looks non-compliant so
 * they can fix it before the backend rejects the save.
 */

/** Phrases that suggest the prompt is asking the model to ghostwrite. */
const GHOSTWRITING_PATTERNS: readonly RegExp[] = [
  /\brewrite\b/i,
  /\brewrites?\b/i,
  /\bre-?write\b/i,
  /\breplacement prose\b/i,
  /\bcorrected version\b/i,
  /\bcorrect version\b/i,
  /\bfix(?:es|ed)? (?:it|the sentence|the text) for (?:them|the (?:user|writer|student))\b/i,
  /\bwrite (?:it|the sentence|the paragraph) for (?:them|the (?:user|writer|student))\b/i,
  /\bprovide (?:a|the) revision\b/i,
  /\bsuggest (?:a|the) revision\b/i,
  /\bjustify (?:the|your) (?:revision|improvement|correction)\b/i,
  /\bexplain the improvement\b/i,
];

/**
 * Returns `true` when `text` contains a phrase that looks like a ghostwriting
 * instruction. Pure and side-effect free so it is trivially unit-testable.
 */
export function containsGhostwritingHint(text: string): boolean {
  return GHOSTWRITING_PATTERNS.some((pattern) => pattern.test(text));
}

export const GHOSTWRITING_HINT_MESSAGE =
  'This looks like it asks the model to rewrite or replace the writer’s text. ' +
  'WREN feedback is Socratic-only — the no-ghostwriting guardrail will reject ' +
  'instructions that produce replacement prose when you save.';
