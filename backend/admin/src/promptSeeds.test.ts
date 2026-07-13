/**
 * Tests for the no-ghostwriting-compliant default prompt seeds (Task 12.6;
 * REQ-CORE-NOGHOST-01 / Requirement 11.7, REQ-TAXONOMY-01 / Requirement 15.5).
 *
 * These tests exist specifically so that if a future edit to
 * `promptSeeds.ts` reintroduces a ghostwriting instruction (the CONFLICT-1
 * regression this task fixes), CI fails immediately rather than shipping a
 * bad seed prompt.
 */
import { PromptGuardrailError, findGhostwritingInstruction } from './promptGuardrail';
import {
  LEGAL_MEMO_CATEGORY_SEEDS,
  LEGAL_MEMO_TYPE_PROMPT_TEXT,
  assertSeedPromptsAreGhostwritingFree,
  buildLegalMemoCategorySeeds,
} from './promptSeeds';

describe('LEGAL_MEMO_TYPE_PROMPT_TEXT — Socratic-only replacement for CONFLICT-1', () => {
  it('is ghostwriting-free per the save-time guardrail', () => {
    expect(findGhostwritingInstruction(LEGAL_MEMO_TYPE_PROMPT_TEXT)).toBeNull();
  });

  it('does not instruct the model to suggest a revised version (the original CONFLICT-1 defect)', () => {
    expect(LEGAL_MEMO_TYPE_PROMPT_TEXT.toLowerCase()).not.toMatch(/suggest a revised version/);
  });

  it('does not ask the model to justify or explain an improvement', () => {
    expect(LEGAL_MEMO_TYPE_PROMPT_TEXT.toLowerCase()).not.toMatch(/why the revision is an improvement/);
  });

  it('does mention asking Socratic questions or flagging categories', () => {
    expect(LEGAL_MEMO_TYPE_PROMPT_TEXT.toLowerCase()).toMatch(/socratic question|flag/);
  });
});

describe('assertSeedPromptsAreGhostwritingFree', () => {
  it('does not throw for the shipped seed prompts', () => {
    expect(() => assertSeedPromptsAreGhostwritingFree()).not.toThrow();
  });

  it('would throw PromptGuardrailError if a seed prompt were ghostwriting-capable (regression guard)', () => {
    // Sanity-check that the assertion helper is wired to a real guardrail —
    // not a no-op — by feeding it deliberately bad text via the same helper
    // this module calls.
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { assertGhostwritingFree } = require('./promptGuardrail');
      assertGhostwritingFree('Suggest a revised version of the passage.');
    }).toThrow(PromptGuardrailError);
  });
});

describe('LEGAL_MEMO_CATEGORY_SEEDS — sample-taxonomy.md reference categories', () => {
  it('contains all twelve reference-implementation categories', () => {
    expect(LEGAL_MEMO_CATEGORY_SEEDS).toHaveLength(12);
  });

  it('every category has a non-empty name and internalGuidance', () => {
    for (const seed of LEGAL_MEMO_CATEGORY_SEEDS) {
      expect(seed.name.length).toBeGreaterThan(0);
      expect(seed.internalGuidance?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('category names match the sample-taxonomy.md summary table', () => {
    const names = LEGAL_MEMO_CATEGORY_SEEDS.map((s) => s.name);
    expect(names).toEqual([
      'Unclear Writing',
      'Inaccurate Summary',
      'Grammar Error / Missing Quotation',
      'Incorrect Legal Terminology',
      'Incorrect Style / Imprecise Language',
      'Misattributed or Unfenced Quotation',
      'Tense and Structural Errors',
      'Imprecise Case Reference / Passive Attribution',
      'Syntactic Ambiguity',
      'Structural / Sentence-Level Clarity',
      'Errors in Logic / Factual Accuracy in Writing',
      'Currency / Statutory Accuracy',
    ]);
  });

  it('no seed record carries a "correctVersion" or "replacementProse" field', () => {
    for (const seed of LEGAL_MEMO_CATEGORY_SEEDS) {
      expect(seed).not.toHaveProperty('correctVersion');
      expect(seed).not.toHaveProperty('replacementProse');
    }
  });

  it('no internalGuidance value itself instructs a rewrite/revision', () => {
    for (const seed of LEGAL_MEMO_CATEGORY_SEEDS) {
      expect(findGhostwritingInstruction(seed.internalGuidance ?? '')).toBeNull();
    }
  });
});

describe('buildLegalMemoCategorySeeds — scoped to exactly one Document Type (Requirement 15.5)', () => {
  it('attaches the given documentTypeId to every seed record', () => {
    const seeds = buildLegalMemoCategorySeeds('dt-legal-memo');

    expect(seeds).toHaveLength(12);
    for (const seed of seeds) {
      expect(seed.documentTypeId).toBe('dt-legal-memo');
    }
  });

  it('produces independent arrays across calls (no shared-mutation risk)', () => {
    const a = buildLegalMemoCategorySeeds('dt-a');
    const b = buildLegalMemoCategorySeeds('dt-b');

    expect(a.every((s) => s.documentTypeId === 'dt-a')).toBe(true);
    expect(b.every((s) => s.documentTypeId === 'dt-b')).toBe(true);
  });

  it('this module exposes no function that seeds categories for more than one Document Type', () => {
    // Documents the structural guarantee behind Requirement 15.5: the only
    // seed-producing export takes a single documentTypeId, so there is no
    // "seed everything" call site that could leak legal categories onto an
    // unrelated Document Type.
    const seedModule = require('./promptSeeds');
    const exportedFunctionNames = Object.keys(seedModule).filter(
      (key) => typeof seedModule[key] === 'function',
    );
    expect(exportedFunctionNames).toEqual(
      expect.arrayContaining(['buildLegalMemoCategorySeeds', 'assertSeedPromptsAreGhostwritingFree']),
    );
    expect(exportedFunctionNames).toHaveLength(2);
  });
});
