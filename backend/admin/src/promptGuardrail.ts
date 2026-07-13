/**
 * Save-time no-ghostwriting prompt-content guardrail (Task 12.3;
 * REQ-PROMPT-EDIT-01 / Requirement 32.5, REQ-CORE-NOGHOST-01 / Requirement
 * 11.6).
 *
 * When a Department Admin saves Document-Type prompt instruction text
 * ({@link DocumentTypeConfig.typePromptText}), this guardrail scans the text
 * for instructions that would cause the Feedback Engine to produce
 * replacement prose, a rewrite, or a justification for a revision — the
 * exact behaviors the no-ghostwriting invariant forbids downstream
 * (`wren_engine.output_guardrail`, Task 9.4). Rejecting bad instructions at
 * SAVE time (rather than relying solely on the Python engine's *output*
 * guardrail) gives the Department Admin immediate, actionable feedback
 * identifying the offending text (Requirement 32.5's "a rejection identifies
 * the offending instruction").
 *
 * This is deliberately a much narrower pattern set than the engine's output
 * guardrail: it looks for INSTRUCTIONS to the model ("rewrite this",
 * "provide a corrected version", "suggest a replacement"), not model
 * OUTPUT shape violations (which the engine's `output_guardrail.py` already
 * covers at generation time). Both layers are defense-in-depth for the same
 * invariant, per design.md's "two-stage pipeline" note.
 *
 * Design references:
 *   - design.md "Save-time no-ghostwriting validation: rejects/transforms
 *     any prompt content instructing the model to produce replacement prose
 *     or justify revisions, with a clear validation error identifying the
 *     offending instruction."
 *   - requirements.md Requirement 32 (REQ-PROMPT-EDIT-01) criteria 32.5,
 *     32.8; Requirement 11 (REQ-CORE-NOGHOST-01) criterion 6.
 */
import { promptGuardrailViolationSchema, type PromptGuardrailViolation } from '@wren/types';

/**
 * Case-insensitive phrase patterns that identify an instruction to produce
 * replacement prose, a corrected/rewritten version, or a justification for a
 * revision. Each pattern is matched against the saved prompt text; the first
 * match's surrounding text becomes the violation's `offendingText`.
 *
 * Deliberately conservative (favors flagging over silence): the cost of a
 * false positive is a Department Admin rephrasing one sentence; the cost of
 * a false negative is a ghostwriting-capable prompt reaching the engine.
 */
const GHOSTWRITING_INSTRUCTION_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  reason: string;
}> = [
  {
    pattern: /\b(rewrite|re-write)\s+(this|the|it|their|the student'?s?)\b/i,
    reason: 'Instructs the model to rewrite the writer\'s text (REQ-CORE-NOGHOST-01).',
  },
  {
    pattern: /\bprovide\s+a\s+(corrected|revised|improved)\s+version\b/i,
    reason: 'Instructs the model to produce a corrected/revised version of the text.',
  },
  {
    pattern: /\bsuggest\s+a\s+(replacement|revision|rewrite|revised\s+version|corrected\s+version)\b/i,
    reason: 'Instructs the model to suggest replacement prose, a revision, or a revised version.',
  },
  {
    pattern: /\b(write|generate|produce|draft)\s+(the|a|an)\s+(correct|corrected|revised|improved|better)\s+(version|sentence|paragraph|text)\b/i,
    reason: 'Instructs the model to generate replacement prose.',
  },
  {
    pattern: /\bexplain\s+(the\s+)?(improvement|correction|fix)\s+(you\s+made|made)\b/i,
    reason: 'Instructs the model to justify a revision it made, implying it made one.',
  },
  {
    pattern: /\bgive\s+(them|the student|the writer)\s+the\s+(correct|right|proper)\s+(answer|wording|phrasing)\b/i,
    reason: 'Instructs the model to hand the writer the correct wording directly.',
  },
  {
    pattern: /\breplace\s+(their|the|it)\s+(text|sentence|paragraph|wording)\s+with\b/i,
    reason: 'Instructs the model to replace the writer\'s text with substitute wording.',
  },
];

/**
 * Scan `promptText` for a ghostwriting instruction. Returns the first
 * {@link PromptGuardrailViolation} found (with the specific offending
 * substring and a human-readable reason), or `null` when the text passes.
 *
 * Pure function — no I/O, fully unit/property testable independent of the
 * Config Service's persistence layer.
 */
export function findGhostwritingInstruction(
  promptText: string,
): PromptGuardrailViolation | null {
  for (const { pattern, reason } of GHOSTWRITING_INSTRUCTION_PATTERNS) {
    const match = promptText.match(pattern);
    if (match && match[0]) {
      return promptGuardrailViolationSchema.parse({
        offendingText: match[0],
        reason,
      });
    }
  }
  return null;
}

/** `true` iff `promptText` contains no detected ghostwriting instruction. */
export function isGhostwritingFree(promptText: string): boolean {
  return findGhostwritingInstruction(promptText) === null;
}

/**
 * Thrown by the Config Service when a save attempt's prompt text fails the
 * guardrail. Carries the {@link PromptGuardrailViolation} so the API layer
 * can surface the offending instruction verbatim to the editor (Requirement
 * 32.5).
 */
export class PromptGuardrailError extends Error {
  public readonly violation: PromptGuardrailViolation;

  public constructor(violation: PromptGuardrailViolation) {
    super(`Prompt content rejected: ${violation.reason} (offending text: "${violation.offendingText}")`);
    this.name = 'PromptGuardrailError';
    this.violation = violation;
  }
}

/**
 * Validate `promptText` before it is persisted. Returns the text unchanged
 * when it passes; throws {@link PromptGuardrailError} when a ghostwriting
 * instruction is detected, so the Config Service performs NO partial save
 * on a violation (mirrors the "deny with no mutation" pattern used by
 * capability checks elsewhere in the Admin_Service).
 */
export function assertGhostwritingFree(promptText: string): string {
  const violation = findGhostwritingInstruction(promptText);
  if (violation) {
    throw new PromptGuardrailError(violation);
  }
  return promptText;
}
