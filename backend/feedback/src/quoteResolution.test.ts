/**
 * Unit and property tests for the typographic quote fold in the debrief API
 * quote rebuild (`resolveQuotedTextForItem`) and the Ask WREN quote expansion
 * (`expandQuotesAgainstDraft`).
 *
 * Spec: .kiro/specs/debrief-quote-typographic-matching-fix (Task 3.9).
 *
 * **Validates: Requirements 2.4, 2.5, 2.6, 3.9, 3.10**
 */
import fc from 'fast-check';

import { expandQuotesAgainstDraft } from './askWren.js';
import {
  foldTypographicQuotes,
  resolveExactQuoteInParagraph,
  resolveQuotedTextForItem,
} from './quoteResolution.js';

type Segment = { index?: number; text?: string };

const NUM_RUNS = 300;

// Same table as _TYPOGRAPHIC_QUOTE_FOLD in backend/engine/python/handler.py.
const FOLD_TABLE: ReadonlyArray<[string, string]> = [
  ['\u2018', "'"],
  ['\u2019', "'"],
  ['\u201A', "'"],
  ['\u201B', "'"],
  ['\u2032', "'"],
  ['\u201C', '"'],
  ['\u201D', '"'],
  ['\u201E', '"'],
  ['\u201F', '"'],
  ['\u2033', '"'],
];
const FOLD_MAP = new Map(FOLD_TABLE);

/** Test-local fold built from the table (independent of the subject). */
function foldLocal(s: string): string {
  return [...s].map((c) => FOLD_MAP.get(c) ?? c).join('');
}

/** Whitespace-collapsed, trimmed, lowercased form used for equivalence. */
function normLower(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True when `text` contains a span equivalent to `quote` after fold. */
function containsEquivalent(text: string, quote: string): boolean {
  return normLower(foldLocal(text)).includes(normLower(foldLocal(quote)));
}

/**
 * The resolver treats a short final word as possibly truncated and also
 * accepts the quote minus that word (then stem-expands). This is the
 * pre-existing heuristic, identical in both passes, so a correct result
 * contains a span equivalent to the full quote OR to that truncated
 * candidate. Mirrors the candidate rule in resolveExactQuoteInParagraph.
 */
function containsEquivalentCandidate(text: string, quote: string): boolean {
  if (containsEquivalent(text, quote)) return true;
  const words = foldLocal(quote).trim().replace(/\s+/g, ' ').split(' ');
  if (words.length <= 2) return false;
  const last = words[words.length - 1] ?? '';
  const looksTruncated = last.length > 0 && last.length < 6 && !/[.!?,"')\]]$/.test(last);
  return looksTruncated && containsEquivalent(text, words.slice(0, -1).join(' '));
}

// --------------------------------------------------------------------------- //
// Unit tests                                                                  //
// --------------------------------------------------------------------------- //

describe('foldTypographicQuotes', () => {
  it.each(FOLD_TABLE)('maps %j to %j', (from, to) => {
    expect(foldTypographicQuotes(from)).toBe(to);
    expect(foldTypographicQuotes(`a${from}b`)).toBe(`a${to}b`);
  });

  it('keeps length and leaves every other character unchanged', () => {
    const others = 'abc XYZ 123 .,;:!?()[] \' " ` \u00B4 \u00AB\u00BB \u2039\u203A \u2013\u2014 \u00E9 \u0130 \u00A0\t\n';
    expect(foldTypographicQuotes(others)).toBe(others);

    const mixed = 'Fiona\u2019s \u201Cproject\u201D \u201Ewort\u201F \u2018x\u201A \u201By\u2032 5\u2033';
    const folded = foldTypographicQuotes(mixed);
    expect(folded.length).toBe(mixed.length);
    expect(folded).toBe(foldLocal(mixed));
    expect(folded).toBe('Fiona\'s "project" "wort" \'x\' \'y\' 5"');
  });

  it('folds exactly the 10 table code points across the BMP quote/prime block', () => {
    for (let cp = 0x2010; cp <= 0x2040; cp += 1) {
      const ch = String.fromCharCode(cp);
      expect(foldTypographicQuotes(ch)).toBe(FOLD_MAP.get(ch) ?? ch);
    }
  });
});

describe('resolveExactQuoteInParagraph (typographic option)', () => {
  const PARA = 'The Board denied the College\u2019s request. It then adjourned the hearing.';

  it('expands a truncated last word after an apostrophe fold', () => {
    expect(resolveExactQuoteInParagraph(PARA, "the College's reque")).toBeNull();
    expect(resolveExactQuoteInParagraph(PARA, "the College's reque", { typographic: true })).toBe(
      'the College\u2019s request',
    );
  });

  it('resolveQuotedTextForItem returns the curly sentence for the truncated quote', () => {
    const segments: Segment[] = [{ index: 0, text: PARA }];
    const result = resolveQuotedTextForItem(
      { id: 'fb-1', quoted_text: "the College's reque" },
      new Map(),
      segments,
    );
    expect(result).toEqual({
      text: 'The Board denied the College\u2019s request.',
      paragraphIndex: 0,
      startOffset: 0,
      endOffset: 39,
    });
  });

  it('returns null in typographic mode when the fold changes neither string', () => {
    expect(resolveExactQuoteInParagraph('plain text here', 'plain text', { typographic: true })).toBeNull();
  });
});

describe('resolveQuotedTextForItem ordering', () => {
  it('prefers the anchored paragraph over the scan (typographic pass)', () => {
    const segments: Segment[] = [
      { index: 0, text: 'First, Fiona\u2019s conduct was reviewed.' },
      { index: 1, text: 'Later, Fiona\u2019s conduct was reviewed again.' },
    ];
    const row = { id: 'fb-1', quoted_text: "Fiona's conduct", current_anchor_id: 'an-1' };
    const anchors = new Map<string, any>([
      ['fb-1', { id: 'an-1', paragraph_index: 1, start_offset: 0, end_offset: 0 }],
    ]);

    const result = resolveQuotedTextForItem(row, anchors, segments);

    expect(result).toEqual({
      text: 'Later, Fiona\u2019s conduct was reviewed again.',
      paragraphIndex: 1,
      startOffset: 0,
      endOffset: 42,
    });
  });

  it('an exact match in a later paragraph wins over a typographic match in an earlier one', () => {
    const segments: Segment[] = [
      { index: 0, text: 'Fiona\u2019s conduct was noted.' },
      { index: 1, text: "Fiona's conduct was noted again." },
    ];
    const row = { id: 'fb-1', quoted_text: "Fiona's conduct", current_anchor_id: 'an-1' };
    // Anchor names the curly paragraph: the literal pass over ALL paragraphs
    // still runs before any typographic attempt.
    const anchors = new Map<string, any>([
      ['fb-1', { id: 'an-1', paragraph_index: 0, start_offset: 0, end_offset: 0 }],
    ]);

    const result = resolveQuotedTextForItem(row, anchors, segments);

    expect(result).toEqual({
      text: "Fiona's conduct was noted again.",
      paragraphIndex: 1,
      startOffset: 0,
      endOffset: 32,
    });
  });
});

describe('expandQuotesAgainstDraft ordering', () => {
  it('an exact match in a later paragraph wins over a typographic match in an earlier one', () => {
    const segments: Segment[] = [
      { index: 0, text: 'Fiona\u2019s conduct was noted.' },
      { index: 1, text: "Fiona's conduct was noted again." },
    ];
    // Band for "early" with 2 paragraphs is [0], so paragraph 0 is tried first;
    // the literal pass still reaches paragraph 1 before the typographic pass.
    const reply = 'You wrote "Fiona\'s conduct was" (early).';
    expect(expandQuotesAgainstDraft(reply, segments)).toBe(reply);
  });

  it('substitutes the curly original when only a typographic match exists', () => {
    const segments: Segment[] = [
      { index: 0, text: 'Background.' },
      { index: 1, text: 'Fiona\u2019s conduct was noted.' },
    ];
    const reply = 'You wrote "Fiona\'s conduct was" (early).';
    expect(expandQuotesAgainstDraft(reply, segments)).toBe(
      'You wrote "Fiona\u2019s conduct was" (early).',
    );
  });
});

// --------------------------------------------------------------------------- //
// Generators                                                                  //
// --------------------------------------------------------------------------- //

const SINGLE_CLASS = ['\u2018', '\u2019', '\u201A', '\u201B', '\u2032'];
const DOUBLE_CLASS = ['\u201C', '\u201D', '\u201E', '\u201F', '\u2033'];
const LETTERS = [...'abcdeXYZ'];
const OTHER = ['.', ',', '(', ')', "'", '"', '-'];
const TYPOGRAPHIC = new Set([...SINGLE_CLASS, ...DOUBLE_CLASS]);

const tokenArb = fc
  .array(
    fc.constantFrom(...LETTERS, ...LETTERS, ...LETTERS, ...SINGLE_CLASS, ...DOUBLE_CLASS, ...OTHER),
    { minLength: 1, maxLength: 8 },
  )
  .map((cs) => cs.join(''));

// Paragraph whitespace is single spaces: the TS resolver searches the paragraph
// literally (only the quote is whitespace-normalized), in both passes.
const paragraphArb = fc
  .array(tokenArb, { minLength: 1, maxLength: 12 })
  .map((ws) => ws.join(' '));

type Variant = 'keep' | 'lower' | 'upper' | 'ws' | 'pad' | 'truncate';
const variantArb = fc.constantFrom<Variant>('keep', 'lower', 'upper', 'ws', 'pad', 'truncate');

function applyVariant(quote: string, variant: Variant): string {
  switch (variant) {
    case 'lower':
      return quote.toLowerCase();
    case 'upper':
      return quote.toUpperCase();
    case 'ws':
      return quote.replace(/ /g, '  \n');
    case 'pad':
      return ` ${quote}\t`;
    case 'truncate': {
      const lastSpace = quote.trimEnd().lastIndexOf(' ');
      if (lastSpace < 0) return quote;
      const last = quote.slice(lastSpace + 1);
      return quote.slice(0, lastSpace + 1) + last.slice(0, Math.max(1, Math.floor(last.length / 2)));
    }
    default:
      return quote;
  }
}

function typographicPositions(p: string): number[] {
  const out: number[] = [];
  for (let k = 0; k < p.length; k += 1) if (TYPOGRAPHIC.has(p[k]!)) out.push(k);
  return out;
}

/**
 * isBugConditionTS(paragraphs, quote) from the design. The literal pass
 * (`typographic: false`) is the original matcher; its equivalence with the
 * frozen original is established in quoteResolution.preservation.test.ts.
 */
function isBugConditionTS(paragraphs: string[], quote: string): boolean {
  return (
    paragraphs.every((p) => resolveExactQuoteInParagraph(p, quote) === null) &&
    paragraphs.some((p) => resolveExactQuoteInParagraph(foldLocal(p), foldLocal(quote)) !== null)
  );
}

// --------------------------------------------------------------------------- //
// Property 3: fold round-trip                                                 //
// --------------------------------------------------------------------------- //

describe('Property 3: fold round-trip for resolveExactQuoteInParagraph', () => {
  /**
   * **Validates: Requirements 2.4, 2.5**
   *
   * For any paragraph p containing a typographic quote (the typographic pass
   * short-circuits by design when fold changes neither string) and any
   * non-blank substring p[i:j], q = fold(p[i:j]) (optionally re-cased or with
   * whitespace changed) resolves to a slice of p containing a span equivalent
   * to q.
   */
  it('a folded substring always maps back to an original span', () => {
    fc.assert(
      fc.property(
        paragraphArb,
        fc.nat(),
        fc.integer({ min: 1, max: 40 }),
        variantArb,
        (p, iRaw, len, variant) => {
          fc.pre(foldLocal(p) !== p);
          const i = iRaw % p.length;
          const j = Math.min(p.length, i + len);
          const sub = p.slice(i, j);
          fc.pre(sub.trim().length > 0);
          const q = applyVariant(foldLocal(sub), variant);

          const result = resolveExactQuoteInParagraph(p, q, { typographic: true });

          expect(result).not.toBeNull();
          expect(p.includes(result!)).toBe(true);
          expect(containsEquivalent(result!, q)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// --------------------------------------------------------------------------- //
// Property 4: bug condition fix (debrief rebuild + Ask WREN)                  //
// --------------------------------------------------------------------------- //

const bugCaseArb = fc.record({
  texts: fc.array(paragraphArb, { minLength: 1, maxLength: 4 }),
  pick: fc.nat(),
  curlyPick: fc.nat(),
  before: fc.integer({ min: 0, max: 20 }),
  after: fc.integer({ min: 0, max: 20 }),
  variant: variantArb,
  anchor: fc.option(
    fc.record({
      paragraph_index: fc.integer({ min: -1, max: 5 }),
      start_offset: fc.integer({ min: 0, max: 40 }),
      end_offset: fc.integer({ min: 0, max: 60 }),
    }),
    { nil: undefined },
  ),
  linkByCurrentId: fc.boolean(),
});

type BugRaw = typeof bugCaseArb extends fc.Arbitrary<infer T> ? T : never;

/** Build a straight-quote query around a typographic character of one paragraph. */
function buildQuote(c: BugRaw): string | null {
  const para = c.texts[c.pick % c.texts.length]!;
  const positions = typographicPositions(para);
  if (!positions.length) return null;
  const pos = positions[c.curlyPick % positions.length]!;
  const s = Math.max(0, pos - c.before);
  const e = Math.min(para.length, pos + 1 + c.after);
  return applyVariant(foldLocal(para.slice(s, e)), c.variant);
}

describe('Property 4: bug-condition inputs resolve to the original characters', () => {
  /**
   * **Validates: Requirements 2.4, 2.6**
   */
  it('resolveQuotedTextForItem returns a paragraph slice with matching offsets', () => {
    fc.assert(
      fc.property(bugCaseArb, (c) => {
        const q = buildQuote(c);
        fc.pre(q !== null);
        fc.pre(isBugConditionTS(c.texts, q!));

        const segments: Segment[] = c.texts.map((t, k) => ({ index: k, text: t }));
        const row: any = { id: 'fb-1', quoted_text: q };
        const anchors = new Map<string, any>();
        if (c.anchor) {
          anchors.set('fb-1', { id: 'an-1', ...c.anchor });
          if (c.linkByCurrentId) row.current_anchor_id = 'an-1';
        }

        const r = resolveQuotedTextForItem(row, anchors, segments);

        expect(r).toBeDefined();
        const seg = segments.find((s) => s.index === r!.paragraphIndex);
        expect(seg).toBeDefined();
        expect(r!.endOffset).toBeGreaterThan(r!.startOffset);
        expect(seg!.text!.slice(r!.startOffset, r!.endOffset)).toBe(r!.text);
        expect(containsEquivalentCandidate(r!.text, q!)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * **Validates: Requirements 2.5**
   */
  it('expandQuotesAgainstDraft substitutes the original paragraph characters', () => {
    fc.assert(
      fc.property(bugCaseArb, (c) => {
        const q = buildQuote(c);
        fc.pre(q !== null);
        // Reply pattern: 5–160 chars between quote marks, no '"' or '”' inside.
        fc.pre(q!.length >= 5 && q!.length <= 160 && !q!.includes('"'));
        fc.pre(isBugConditionTS(c.texts, q!));

        const segments: Segment[] = c.texts.map((t, k) => ({ index: k, text: t }));
        const prefix = 'You wrote "';
        const suffix = '" (early). Why?';

        const out = expandQuotesAgainstDraft(`${prefix}${q}${suffix}`, segments);

        expect(out.startsWith(prefix)).toBe(true);
        expect(out.endsWith(suffix)).toBe(true);
        const substituted = out.slice(prefix.length, out.length - suffix.length);
        expect(substituted).not.toBe(q);
        expect(c.texts.some((t) => t.includes(substituted))).toBe(true);
        expect(containsEquivalentCandidate(substituted, q!)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
