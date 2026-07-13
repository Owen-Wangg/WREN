/**
 * Property-based test for effective size-limit resolution and enforcement
 * (REQ-DOC-SIZE-01 / Requirements 7.2, 7.3, 7.4; design Property 4 targets this
 * module).
 *
 * Tag: Feature: wren-writing-coach, Property 4: Size-limit enforcement using the effective limit
 *
 * **Validates: Requirements 7.2, 7.3, 7.4**
 *
 * Complements the example-based `sizeLimit.test.ts` by exercising the pure
 * size-limit core across generated override configurations, measured word
 * counts, and paragraph documents. It encodes the design's Property 4 as four
 * generative invariants:
 *
 *   1. Effective-limit precedence (Req 7.4): `resolveEffectiveSizeLimitWords`
 *      equals the Document Type override when set, else the platform default —
 *      re-derived independently from the implementation expression.
 *   2. Enforcement decision (Req 7.2 / 7.3): a count strictly exceeding the
 *      effective limit is `over-limit` carrying both numbers (and a message
 *      naming both); a count at or under the limit is `within-limit`. The pure
 *      decision creates no Draft and invokes no engine (Req 7.3) — this module
 *      only returns the decision.
 *   3. Strict-exceeds boundary (Req 7.2): for any effective limit `L`, exactly
 *      `L` is accepted and `L + 1` is rejected.
 *   4. Segment/count consistency: `enforceSizeLimit(segments, ...)` agrees with
 *      `enforceSizeLimitForWordCount(countWords(segments), ...)`, and
 *      `countWords` equals the independently re-derived sum of whitespace-
 *      delimited word counts across segments.
 *
 * fast-check docs: https://fast-check.dev/
 */
import fc from 'fast-check';

import type { Segment } from '@wren/types';

import {
  DEFAULT_SIZE_LIMIT_WORDS,
  countWords,
  enforceSizeLimit,
  enforceSizeLimitForWordCount,
  resolveEffectiveSizeLimitWords,
  type SizeLimitOverrides,
} from './sizeLimit';

import { wrenProperty } from '../../../testing/typescript/property';

/** A configured override: a positive int, or `null` to use platform default. */
const overrideArb = fc.option(fc.integer({ min: 1, max: 20_000 }), { nil: null });

/** Arbitrary Document Type override (may be `null`). */
const overridesArb: fc.Arbitrary<SizeLimitOverrides> = fc.record({
  documentTypeSizeLimitWords: overrideArb,
});

/** An arbitrary already-measured word count, including 0. */
const measuredWordsArb = fc.nat({ max: 25_000 });

/** A single non-whitespace word token (guaranteed to contain no whitespace). */
const tokenArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(''));

/** Whitespace separators of varied kinds, to exercise run-collapsing. */
const whitespaceArb = fc.constantFrom(' ', '\t', '\n', '\n\n', '   ', ' \t ');

/**
 * A paragraph carrying its independently-known word count: `words` non-blank
 * tokens joined by whitespace, optionally padded with leading/trailing
 * whitespace. The word count is exactly `tokens.length` by construction.
 */
const paragraphArb = fc
  .tuple(
    fc.array(tokenArb, { maxLength: 6 }),
    whitespaceArb,
    fc.boolean(),
    fc.boolean(),
  )
  .map(([tokens, separator, padLeft, padRight]) => {
    let text = tokens.join(separator);
    if (padLeft) text = `  ${text}`;
    if (padRight) text = `${text} \t`;
    return { text, words: tokens.length };
  });

/** An arbitrary document (ordered segments) with its known total word count. */
const documentArb = fc.array(paragraphArb, { maxLength: 6 }).map((paragraphs) => {
  const segments: Segment[] = paragraphs.map((paragraph, index) => ({
    index,
    text: paragraph.text,
  }));
  const totalWords = paragraphs.reduce((sum, paragraph) => sum + paragraph.words, 0);
  return { segments, totalWords };
});

/**
 * Independent re-derivation of the effective limit (Req 7.4 precedence): the
 * Document Type override when set, else the platform default. Uses a different
 * expression than the implementation and a literal default so it does not merely
 * echo `resolveEffectiveSizeLimitWords`.
 */
function expectedEffectiveLimit(overrides: SizeLimitOverrides): number {
  return overrides.documentTypeSizeLimitWords ?? 10_000;
}

/**
 * Independent re-derivation of a single text's word count: the number of
 * non-empty whitespace-delimited tokens. Different expression than the
 * implementation's `trim().split(...).length`.
 */
function independentWordCount(text: string): number {
  return text.split(/\s+/).filter((token) => token.length > 0).length;
}

describe('Property 4: Size-limit enforcement using the effective limit', () => {
  it('resolves the effective limit and enforces the strict-exceeds boundary consistently', () => {
    // Guards the literal used in the independent re-derivation above.
    expect(DEFAULT_SIZE_LIMIT_WORDS).toBe(10_000);

    const tag = wrenProperty(
      { number: 4, text: 'Size-limit enforcement using the effective limit' },
      fc.property(
        overridesArb,
        measuredWordsArb,
        documentArb,
        (overrides, measuredWords, document) => {
          // --- Sub-property 1: effective-limit precedence (Req 7.4) ---
          const effectiveLimit = resolveEffectiveSizeLimitWords(overrides);
          expect(effectiveLimit).toBe(expectedEffectiveLimit(overrides));

          // --- Sub-property 2: enforcement decision (Req 7.2 / 7.3) ---
          const result = enforceSizeLimitForWordCount(measuredWords, overrides);
          // Both numbers are always carried through (Req 7.2 returns both).
          expect(result.effectiveLimitWords).toBe(effectiveLimit);
          expect(result.measuredWords).toBe(measuredWords);

          if (measuredWords > effectiveLimit) {
            expect(result.status).toBe('over-limit');
            if (result.status === 'over-limit') {
              // Message states the limit and the measured size (Req 7.2).
              expect(result.message).toContain(String(measuredWords));
              expect(result.message).toContain(String(effectiveLimit));
            }
          } else {
            expect(result.status).toBe('within-limit');
          }

          // --- Sub-property 3: strict-exceeds boundary (Req 7.2) ---
          // Exactly at the limit is accepted; one over is rejected.
          expect(enforceSizeLimitForWordCount(effectiveLimit, overrides).status).toBe(
            'within-limit',
          );
          expect(enforceSizeLimitForWordCount(effectiveLimit + 1, overrides).status).toBe(
            'over-limit',
          );

          // --- Sub-property 4: segment/count consistency ---
          const independentTotal = document.segments.reduce(
            (sum, segment) => sum + independentWordCount(segment.text),
            0,
          );
          expect(independentTotal).toBe(document.totalWords);
          expect(countWords(document.segments)).toBe(document.totalWords);

          const viaSegments = enforceSizeLimit(document.segments, overrides);
          const viaCount = enforceSizeLimitForWordCount(
            countWords(document.segments),
            overrides,
          );
          expect(viaSegments).toEqual(viaCount);
        },
      ),
    );

    expect(tag).toBe(
      'Feature: wren-writing-coach, Property 4: Size-limit enforcement using the effective limit',
    );
  });
});
