/**
 * Property-based test: prompt content guardrail rejects ghostwriting
 * instructions (Task 12.4).
 *
 * Feature: wren-writing-coach, Property 11: Prompt content guardrail rejects ghostwriting instructions
 *
 * Design Property 11: For any prompt text submitted for saving, the Config
 * Service rejects or transforms it iff it contains an instruction to
 * produce replacement prose, suggest a revised version, or justify an
 * improvement, and a rejection identifies the offending instruction.
 *
 * Validates: Requirements 11.6, 32.5
 */
import fc from 'fast-check';

import {
  PromptGuardrailError,
  assertGhostwritingFree,
  findGhostwritingInstruction,
  isGhostwritingFree,
} from './promptGuardrail';
import { wrenProperty } from '../../../testing/typescript/property';

/** Phrases that MUST be detected as ghostwriting instructions. */
const GHOSTWRITING_PHRASES = [
  'Please rewrite this sentence for the student.',
  'Provide a corrected version of the paragraph.',
  'Suggest a revision for any unclear passage.',
  'Suggest a replacement for weak topic sentences.',
  'Suggest a revised version of the passage.',
  'Generate a revised version of the flawed text.',
  'Explain the improvement you made to the sentence.',
  'Give the student the correct wording immediately.',
  'Replace their sentence with clearer wording.',
] as const;

/** Phrases that MUST pass — Socratic-only, no instruction to produce replacement text. */
const CLEAN_PHRASES = [
  'Ask the writer what evidence supports this claim.',
  'Flag any unsupported assertion as a Socratic question.',
  'Use a formal, encouraging tone throughout the feedback.',
  'Limit inline feedback items to five per five hundred words.',
  'Prioritize recurring patterns over one-off issues.',
  'Identify passages that fall into a configured error category.',
] as const;

/** Neutral filler text used to surround a phrase without altering its meaning. */
const fillerArb = fc.string({ minLength: 0, maxLength: 60 }).filter((s) => !/rewrite|revis|replace|correct|suggest|explain the/i.test(s));

describe('Property 11: prompt content guardrail rejects ghostwriting instructions', () => {
  it('every known ghostwriting phrase is rejected, embedded in arbitrary surrounding text', () => {
    const tag = wrenProperty(
      { number: 11, text: 'Prompt content guardrail rejects ghostwriting instructions' },
      fc.property(
        fc.constantFrom(...GHOSTWRITING_PHRASES),
        fillerArb,
        fillerArb,
        (phrase, prefix, suffix) => {
          const promptText = `${prefix} ${phrase} ${suffix}`;
          const violation = findGhostwritingInstruction(promptText);
          if (violation === null) return false;
          // The rejection must identify a NON-EMPTY offending substring
          // that is actually present in the submitted text.
          return violation.offendingText.length > 0 && promptText.includes(violation.offendingText);
        },
      ),
    );
    expect(tag).toContain('Property 11');
  });

  it('every known clean phrase passes, embedded in arbitrary surrounding text', () => {
    wrenProperty(
      { number: 11, text: 'Prompt content guardrail accepts Socratic-only prompt text' },
      fc.property(fc.constantFrom(...CLEAN_PHRASES), fillerArb, fillerArb, (phrase, prefix, suffix) => {
        const promptText = `${prefix} ${phrase} ${suffix}`;
        return isGhostwritingFree(promptText);
      }),
    );
  });

  it('assertGhostwritingFree is consistent with findGhostwritingInstruction for ANY text', () => {
    wrenProperty(
      { number: 11, text: 'Prompt content guardrail assertion is consistent with detection' },
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (text) => {
        const violation = findGhostwritingInstruction(text);
        if (violation === null) {
          // No violation detected -> assertGhostwritingFree must NOT throw,
          // and must return the text unchanged (never silently transform it
          // into something else without signaling).
          return assertGhostwritingFree(text) === text;
        }
        // A violation was detected -> assertGhostwritingFree MUST throw
        // PromptGuardrailError, and the thrown error's violation must be the
        // SAME violation object findGhostwritingInstruction reports back
        // for the identical input (a rejection identifies the offending
        // instruction, Requirement 32.5).
        try {
          assertGhostwritingFree(text);
          return false; // did not throw — property violated
        } catch (err) {
          return (
            err instanceof PromptGuardrailError &&
            err.violation.offendingText === violation.offendingText &&
            err.violation.reason === violation.reason
          );
        }
      }),
    );
  });

  it('detection is case-insensitive for every known ghostwriting phrase', () => {
    wrenProperty(
      { number: 11, text: 'Prompt content guardrail detection is case-insensitive' },
      fc.property(fc.constantFrom(...GHOSTWRITING_PHRASES), (phrase) => {
        const upper = phrase.toUpperCase();
        const lower = phrase.toLowerCase();
        return !isGhostwritingFree(upper) && !isGhostwritingFree(lower);
      }),
    );
  });
});
