/**
 * Unit tests for the save-time no-ghostwriting prompt-content guardrail
 * (REQ-PROMPT-EDIT-01 / Requirement 32.5; Task 12.3, Property 11).
 */
import {
  assertGhostwritingFree,
  findGhostwritingInstruction,
  isGhostwritingFree,
  PromptGuardrailError,
} from './promptGuardrail';

describe('findGhostwritingInstruction', () => {
  it('detects "rewrite this" instructions', () => {
    const violation = findGhostwritingInstruction(
      'When you spot an error, rewrite this sentence for the student.',
    );
    expect(violation).not.toBeNull();
    expect(violation?.offendingText.toLowerCase()).toContain('rewrite this');
  });

  it('detects "provide a corrected version" instructions', () => {
    const violation = findGhostwritingInstruction('Always provide a corrected version of the paragraph.');
    expect(violation).not.toBeNull();
  });

  it('detects "suggest a replacement" instructions', () => {
    const violation = findGhostwritingInstruction('Suggest a replacement for any weak topic sentence.');
    expect(violation).not.toBeNull();
  });

  it('detects instructions to generate a "corrected version"', () => {
    const violation = findGhostwritingInstruction('Generate the corrected version and present it.');
    expect(violation).not.toBeNull();
  });

  it('detects instructions to explain a correction "you made"', () => {
    const violation = findGhostwritingInstruction('Explain the correction you made in plain language.');
    expect(violation).not.toBeNull();
  });

  it('detects instructions to hand the writer the correct wording', () => {
    const violation = findGhostwritingInstruction('Give the student the correct wording once identified.');
    expect(violation).not.toBeNull();
  });

  it('detects instructions to replace text with substitute wording', () => {
    const violation = findGhostwritingInstruction('Replace their sentence with a clearer alternative.');
    expect(violation).not.toBeNull();
  });

  it('is case-insensitive', () => {
    const violation = findGhostwritingInstruction('REWRITE THIS paragraph immediately.');
    expect(violation).not.toBeNull();
  });

  it('returns null for Socratic-only prompt text', () => {
    const violation = findGhostwritingInstruction(
      'Ask the writer what evidence supports this claim. Flag any unsupported assertions as a Socratic question.',
    );
    expect(violation).toBeNull();
  });

  it('returns null for prompt text discussing tone/density only', () => {
    const violation = findGhostwritingInstruction(
      'Use a formal, encouraging tone. Limit inline feedback to 5 items per 500 words.',
    );
    expect(violation).toBeNull();
  });

  it('returns null for empty prompt text', () => {
    expect(findGhostwritingInstruction('')).toBeNull();
  });

  it('includes a human-readable reason on every violation', () => {
    const violation = findGhostwritingInstruction('Please rewrite this claim.');
    expect(violation?.reason).toBeTruthy();
    expect(typeof violation?.reason).toBe('string');
  });
});

describe('isGhostwritingFree', () => {
  it('returns true for clean prompt text', () => {
    expect(isGhostwritingFree('Ask about the strength of the thesis statement.')).toBe(true);
  });

  it('returns false when an instruction is present', () => {
    expect(isGhostwritingFree('Rewrite this sentence for clarity.')).toBe(false);
  });
});

describe('assertGhostwritingFree', () => {
  it('returns the text unchanged when it passes', () => {
    const text = 'Ask a Socratic question about the argument structure.';
    expect(assertGhostwritingFree(text)).toBe(text);
  });

  it('throws PromptGuardrailError when a violation is detected', () => {
    expect(() => assertGhostwritingFree('Provide a corrected version now.')).toThrow(
      PromptGuardrailError,
    );
  });

  it('the thrown error carries the violation with offending text and reason', () => {
    try {
      assertGhostwritingFree('Suggest a replacement for the weak sentence.');
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PromptGuardrailError);
      const violation = (err as PromptGuardrailError).violation;
      expect(violation.offendingText).toBeTruthy();
      expect(violation.reason).toBeTruthy();
    }
  });
});
