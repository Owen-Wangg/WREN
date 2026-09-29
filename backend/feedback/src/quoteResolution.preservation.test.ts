/**
 * Preservation property tests: typographic quote matching in the debrief API
 * quote rebuild and the Ask WREN quote expansion.
 *
 * Spec: .kiro/specs/debrief-quote-typographic-matching-fix (Task 2).
 *
 * Property 5 (design) / Property 2 (tasks): Preservation - for any input that is
 * NOT in the bug condition (isBugConditionTS is false), the subject returns
 * exactly what the frozen original returns:
 *   - `resolveQuotedTextForItem` deep-equals the frozen copy (anchored-paragraph
 *     match, scan match, truncated-word expansion, sentence expansion,
 *     anchor-offset fallback, unresolved fallback).
 *   - `expandQuotesAgainstDraft` returns the identical reply string.
 *
 * These tests are written BEFORE the fix and MUST PASS on the unfixed code.
 *
 * Oracles are frozen verbatim copies of the unfixed code from
 * `lambda-handler.ts` and `askWren.ts`. Subjects: `resolveQuotedTextForItem`
 * from `./quoteResolution.js` and `expandQuotesAgainstDraft` from
 * `./askWren.js`.
 *
 * **Validates: Requirements 3.9, 3.10, 3.11**
 */
import fc from 'fast-check';

import { expandQuotesAgainstDraft } from './askWren.js';
import { resolveQuotedTextForItem, type ResolvedQuote } from './quoteResolution.js';

type Segment = { index?: number; text?: string };

const NUM_RUNS = 300;

// --------------------------------------------------------------------------- //
// Frozen verbatim copy of the unfixed lambda-handler.ts resolver chain        //
// --------------------------------------------------------------------------- //

function frozenExpandToWordBoundaries(
  text: string,
  startOffset: number,
  endOffset: number,
): { start: number; end: number } {
  let start = Math.max(0, Math.min(startOffset, text.length));
  let end = Math.max(start, Math.min(endOffset, text.length));
  while (start > 0 && /\w/.test(text[start - 1] ?? '')) start -= 1;
  while (end < text.length && /\w/.test(text[end] ?? '')) end += 1;
  return { start, end };
}

function frozenIsSentenceEnd(text: string, pos: number): boolean {
  const ch = text[pos];
  if (!ch) return false;
  if (ch === '!' || ch === '?') return true;
  if (ch !== '.') return false;
  const after = text[pos + 1];
  if (after && /[A-Za-z]/.test(after)) return false;
  let ws = pos;
  while (ws > 0 && /[A-Za-z]/.test(text[ws - 1]!)) ws--;
  const wordBefore = text.slice(ws, pos);
  if (wordBefore.length === 1 && /[A-Z]/.test(wordBefore)) return false;
  if (
    wordBefore.length > 1 &&
    wordBefore.length <= 5 &&
    /[A-Z]/.test(wordBefore[0]!)
  ) {
    return false;
  }
  let j = pos + 1;
  while (j < text.length && /\s/.test(text[j]!)) j++;
  if (j >= text.length || /[A-Z”'([`”']/.test(text[j]!)) return true;
  if (/[0-9]/.test(text[j]!) && wordBefore.length > 5) return true;
  return false;
}

function frozenExpandToSentenceBoundaries(
  text: string,
  startOffset: number,
  endOffset: number,
): { start: number; end: number } {
  const MAX_LOOKBACK = 200;
  const MAX_LOOKAHEAD = 200;

  let start = Math.max(0, startOffset);
  let end = Math.min(text.length, endOffset);

  const lookbackFrom = Math.max(0, start - MAX_LOOKBACK);
  let s = start;
  while (s > lookbackFrom) {
    if (frozenIsSentenceEnd(text, s - 1)) break;
    s -= 1;
  }
  while (s < start && /\s/.test(text[s] ?? '')) s += 1;
  start = s;

  const lookaheadTo = Math.min(text.length, end + MAX_LOOKAHEAD);
  let e = end;
  while (e < lookaheadTo) {
    e += 1;
    if (frozenIsSentenceEnd(text, e - 1)) break;
  }
  end = e;

  return { start, end };
}

function frozenEscapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function frozenResolveExactQuoteInParagraph(
  paragraphText: string,
  quotedText: string,
): string | null {
  const fullNormalized = quotedText.trim().replace(/\s+/g, ' ');
  if (!fullNormalized || !paragraphText) return null;

  const candidates = [fullNormalized];
  const words = fullNormalized.split(' ');
  if (words.length > 2) {
    const last = words[words.length - 1] ?? '';
    const looksTruncated = last.length > 0 && last.length < 6 && !/[.!?,"')\]]$/.test(last);
    if (looksTruncated) {
      candidates.push(words.slice(0, -1).join(' '));
    }
  }

  for (const candidate of candidates) {
    let idx = paragraphText.indexOf(candidate);
    if (idx < 0) {
      idx = paragraphText.toLowerCase().indexOf(candidate.toLowerCase());
    }
    if (idx < 0) continue;

    let end = idx + candidate.length;
    if (candidate !== fullNormalized) {
      const stem = fullNormalized.split(' ').pop() ?? '';
      if (stem) {
        const rest = paragraphText.slice(end);
        const expansion = rest.match(new RegExp(`^${frozenEscapeRegExp(stem)}\\w*`, 'i'));
        if (expansion) end += expansion[0].length;
      }
    }

    const expanded = frozenExpandToWordBoundaries(paragraphText, idx, end);
    return paragraphText.slice(expanded.start, expanded.end);
  }
  return null;
}

function frozenSegmentTextAt(segments: Segment[], paragraphIndex: number): string {
  const byIndex = segments.find((s) => s.index === paragraphIndex);
  if (byIndex && typeof byIndex.text === 'string') return byIndex.text;
  const byPos = segments[paragraphIndex];
  return typeof byPos?.text === 'string' ? byPos.text : '';
}

function frozenResolveQuotedTextForItem(
  row: any,
  anchorByFeedbackId: Map<string, any>,
  segments: Segment[],
): ResolvedQuote | undefined {
  const stored = typeof row.quoted_text === 'string' ? row.quoted_text : undefined;
  const anchor =
    (row.current_anchor_id
      ? [...anchorByFeedbackId.values()].find((a) => a.id === row.current_anchor_id)
      : undefined) ?? anchorByFeedbackId.get(row.id);

  const expandQuote = (para: string, fromQuote: string, paraIndex: number): ResolvedQuote => {
    const idx = para.indexOf(fromQuote);
    if (idx >= 0) {
      const sentence = frozenExpandToSentenceBoundaries(para, idx, idx + fromQuote.length);
      const text = para.slice(sentence.start, sentence.end).trim() || fromQuote;
      const finalStart = para.indexOf(text, Math.max(0, sentence.start - 1));
      return {
        text,
        paragraphIndex: paraIndex,
        startOffset: finalStart >= 0 ? finalStart : sentence.start,
        endOffset: finalStart >= 0 ? finalStart + text.length : sentence.end,
      };
    }
    const fallbackIdx = para.indexOf(fromQuote);
    return {
      text: fromQuote,
      paragraphIndex: paraIndex,
      startOffset: fallbackIdx >= 0 ? fallbackIdx : 0,
      endOffset: fallbackIdx >= 0 ? fallbackIdx + fromQuote.length : fromQuote.length,
    };
  };

  if (stored) {
    if (anchor) {
      const paraIndex = Number(anchor.paragraph_index ?? 0);
      const para = frozenSegmentTextAt(segments, paraIndex);
      if (para) {
        const fromQuote = frozenResolveExactQuoteInParagraph(para, stored);
        if (fromQuote) return expandQuote(para, fromQuote, paraIndex);
      }
    }

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const paraIndex = segment.index ?? i;
      const para = typeof segment.text === 'string' ? segment.text : '';
      const fromQuote = frozenResolveExactQuoteInParagraph(para, stored);
      if (fromQuote) return expandQuote(para, fromQuote, paraIndex);
    }

    if (anchor) {
      const paraIndex = Number(anchor.paragraph_index ?? 0);
      const para = frozenSegmentTextAt(segments, paraIndex);
      if (para) {
        const start = Number(anchor.start_offset ?? 0);
        const end = Number(anchor.end_offset ?? 0);
        if (end > start && end <= para.length) {
          const sentence = frozenExpandToSentenceBoundaries(para, start, end);
          const slice = para.slice(sentence.start, sentence.end).trim();
          if (slice) {
            const sliceStart = para.indexOf(slice, Math.max(0, sentence.start - 1));
            return {
              text: slice,
              paragraphIndex: paraIndex,
              startOffset: sliceStart >= 0 ? sliceStart : sentence.start,
              endOffset: sliceStart >= 0 ? sliceStart + slice.length : sentence.end,
            };
          }
          const raw = para.slice(start, end).trim();
          if (raw) return { text: raw, paragraphIndex: paraIndex, startOffset: start, endOffset: end };
        }
      }
    }

    return { text: stored, paragraphIndex: Number(anchor?.paragraph_index ?? 0), startOffset: 0, endOffset: 0 };
  }

  if (anchor) {
    const paraIndex = Number(anchor.paragraph_index ?? 0);
    const para = frozenSegmentTextAt(segments, paraIndex);
    if (para) {
      const start = Number(anchor.start_offset ?? 0);
      const end = Number(anchor.end_offset ?? 0);
      if (end > start && end <= para.length) {
        const sentence = frozenExpandToSentenceBoundaries(para, start, end);
        const slice = para.slice(sentence.start, sentence.end).trim();
        if (slice) {
          const sliceStart = para.indexOf(slice, Math.max(0, sentence.start - 1));
          return {
            text: slice,
            paragraphIndex: paraIndex,
            startOffset: sliceStart >= 0 ? sliceStart : sentence.start,
            endOffset: sliceStart >= 0 ? sliceStart + slice.length : sentence.end,
          };
        }
        const raw = para.slice(start, end).trim();
        if (raw) return { text: raw, paragraphIndex: paraIndex, startOffset: start, endOffset: end };
      }
    }
  }

  return undefined;
}

// --------------------------------------------------------------------------- //
// Frozen verbatim copy of the unfixed askWren.ts quote expansion              //
// --------------------------------------------------------------------------- //

function frozenAskEscapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function frozenAskExpandToWordBoundaries(
  text: string,
  startOffset: number,
  endOffset: number,
): { start: number; end: number } {
  let start = Math.max(0, Math.min(startOffset, text.length));
  let end = Math.max(start, Math.min(endOffset, text.length));
  while (start > 0 && /\w/.test(text[start - 1] ?? '')) start -= 1;
  while (end < text.length && /\w/.test(text[end] ?? '')) end += 1;
  return { start, end };
}

function frozenAskResolveExactQuoteInParagraph(
  paragraphText: string,
  quotedText: string,
): string | null {
  const fullNormalized = quotedText.trim().replace(/\s+/g, ' ');
  if (!fullNormalized || !paragraphText) return null;

  const candidates = [fullNormalized];
  const words = fullNormalized.split(' ');
  if (words.length > 2) {
    const last = words[words.length - 1] ?? '';
    const looksTruncated =
      last.length > 0 && last.length < 6 && !/[.!?,"')\]]$/.test(last);
    if (looksTruncated) {
      candidates.push(words.slice(0, -1).join(' '));
    }
  }

  for (const candidate of candidates) {
    let idx = paragraphText.indexOf(candidate);
    if (idx < 0) {
      idx = paragraphText.toLowerCase().indexOf(candidate.toLowerCase());
    }
    if (idx < 0) continue;

    let end = idx + candidate.length;
    if (candidate !== fullNormalized) {
      const stem = fullNormalized.split(' ').pop() ?? '';
      if (stem) {
        const rest = paragraphText.slice(end);
        const expansion = rest.match(new RegExp(`^${frozenAskEscapeRegExp(stem)}\\w*`, 'i'));
        if (expansion) end += expansion[0].length;
      }
    }

    const expanded = frozenAskExpandToWordBoundaries(paragraphText, idx, end);
    return paragraphText.slice(expanded.start, expanded.end);
  }
  return null;
}

function frozenParagraphBandForLocationHint(
  hint: string,
  paragraphCount: number,
): { start: number; end: number } | null {
  if (paragraphCount <= 0) return null;
  const h = hint.toLowerCase();
  if (h.includes('early') || h.includes('beginning') || h.includes('start')) {
    return { start: 0, end: Math.max(1, Math.ceil(paragraphCount * 0.35)) };
  }
  if (h.includes('mid')) {
    const start = Math.floor(paragraphCount * 0.25);
    const end = Math.max(start + 1, Math.ceil(paragraphCount * 0.7));
    return { start, end };
  }
  if (h.includes('toward the end') || h.includes('near the end') || h.includes('later')) {
    return {
      start: Math.floor(paragraphCount * 0.55),
      end: paragraphCount,
    };
  }
  return null;
}

function frozenExpandQuotesAgainstDraft(
  replyText: string,
  segments: Array<{ index?: number; text?: string }>,
): string {
  const paragraphs = segments
    .map((s) => (typeof s.text === 'string' ? s.text : ''))
    .filter((t) => t.trim().length > 0);
  if (!paragraphs.length) return replyText;

  const pattern = /(["“])([^"”]{5,160})(["”])\s*\(([^)]{3,60})\)/g;
  return replyText.replace(pattern, (full, open, quote, close, location) => {
    const band = frozenParagraphBandForLocationHint(String(location), paragraphs.length);
    const order: number[] = [];
    if (band) {
      for (let i = band.start; i < band.end; i += 1) order.push(i);
    }
    for (let i = 0; i < paragraphs.length; i += 1) {
      if (!order.includes(i)) order.push(i);
    }

    for (const idx of order) {
      const resolved = frozenAskResolveExactQuoteInParagraph(paragraphs[idx] ?? '', String(quote));
      if (resolved && resolved !== quote) {
        return `${open}${resolved}${close} (${location})`;
      }
      if (resolved) {
        return full;
      }
    }
    return full;
  });
}

// --------------------------------------------------------------------------- //
// Bug condition (from design)                                                 //
// --------------------------------------------------------------------------- //

/** Test-local 1:1 typographic quote fold (same table as the design). */
function fold(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"');
}

/** isBugConditionTS(paragraphs, quote) from the design. */
function isBugConditionTS(paragraphs: string[], quote: string): boolean {
  return (
    paragraphs.every((p) => frozenResolveExactQuoteInParagraph(p, quote) === null) &&
    paragraphs.some((p) => frozenResolveExactQuoteInParagraph(fold(p), fold(quote)) !== null)
  );
}

// --------------------------------------------------------------------------- //
// Generators                                                                  //
// --------------------------------------------------------------------------- //

const WORD_CHARS = [...'abcdeXYZ'];
const PUNCT = ['.', ',', '!', '?', ';', '(', ')', "'", '"', '\u2019', '\u2018', '\u201C', '\u201D', '\u2032'];

const wordArb = fc
  .array(fc.constantFrom(...WORD_CHARS, ...WORD_CHARS, ...PUNCT), { minLength: 1, maxLength: 8 })
  .map((cs) => cs.join(''));

const paragraphArb = fc
  .tuple(
    fc.array(wordArb, { minLength: 0, maxLength: 14 }),
    fc.constantFrom(' ', ' ', '  ', '\n'),
  )
  .map(([ws, sep]) => ws.join(sep));

type QuoteVariant = 'keep' | 'lower' | 'upper' | 'ws' | 'truncate';

function applyVariant(quote: string, variant: QuoteVariant): string {
  switch (variant) {
    case 'lower':
      return quote.toLowerCase();
    case 'upper':
      return quote.toUpperCase();
    case 'ws':
      return quote.replace(/ /g, '  ');
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

/** Substring of some paragraph (with a variant), or unrelated text. */
function deriveQuote(
  texts: string[],
  pick: number,
  start: number,
  len: number,
  variant: QuoteVariant,
  random: string,
  useRandom: boolean,
): string {
  const nonEmpty = texts.filter((t) => t.length > 0);
  if (useRandom || nonEmpty.length === 0) return random;
  const para = nonEmpty[pick % nonEmpty.length]!;
  const s = start % para.length;
  return applyVariant(para.slice(s, Math.min(para.length, s + len)), variant);
}

const variantArb = fc.constantFrom<QuoteVariant>('keep', 'lower', 'upper', 'ws', 'truncate');

const itemCaseArb = fc.record({
  texts: fc.array(paragraphArb, { minLength: 0, maxLength: 4 }),
  useIndexField: fc.boolean(),
  indexShift: fc.integer({ min: 0, max: 2 }),
  storedKind: fc.constantFrom('derived', 'derived', 'derived', 'random', 'none', 'empty'),
  pick: fc.nat(),
  start: fc.nat(),
  len: fc.integer({ min: 1, max: 60 }),
  variant: variantArb,
  random: fc.array(wordArb, { minLength: 1, maxLength: 4 }).map((ws) => ws.join(' ')),
  anchor: fc.option(
    fc.record({
      paragraph_index: fc.integer({ min: -1, max: 6 }),
      start_offset: fc.integer({ min: -2, max: 80 }),
      end_offset: fc.integer({ min: -2, max: 120 }),
    }),
    { nil: undefined },
  ),
  linkByCurrentId: fc.boolean(),
});

type ItemCase = {
  row: any;
  anchors: Map<string, any>;
  segments: Segment[];
};

type ItemRaw = typeof itemCaseArb extends fc.Arbitrary<infer T> ? T : never;

function buildItemCase(c: ItemRaw): ItemCase {
  const texts: string[] = c.texts;
  const segments: Segment[] = texts.map((t, k) =>
    c.useIndexField ? { index: k + c.indexShift, text: t } : { text: t },
  );
  let quoted_text: string | undefined;
  if (c.storedKind === 'derived') {
    quoted_text = deriveQuote(texts, c.pick, c.start, c.len, c.variant, c.random, false);
  } else if (c.storedKind === 'random') {
    quoted_text = c.random;
  } else if (c.storedKind === 'empty') {
    quoted_text = '';
  }
  const row: any = { id: 'fb-1', quoted_text };
  const anchors = new Map<string, any>();
  if (c.anchor) {
    anchors.set('fb-1', { id: 'an-1', ...c.anchor });
    if (c.linkByCurrentId) row.current_anchor_id = 'an-1';
  }
  return { row, anchors, segments };
}

function itemInBugCondition({ row, segments }: ItemCase): boolean {
  const stored = typeof row.quoted_text === 'string' ? row.quoted_text : undefined;
  if (!stored) return false;
  const paragraphs = segments.map((s) => (typeof s.text === 'string' ? s.text : ''));
  return isBugConditionTS(paragraphs, stored);
}

// --------------------------------------------------------------------------- //
// Property: debrief rebuild preservation (3.9)                                //
// --------------------------------------------------------------------------- //

describe('Preservation: resolveQuotedTextForItem matches the frozen original', () => {
  it('property: deep-equal to frozen for inputs outside the bug condition', () => {
    fc.assert(
      fc.property(itemCaseArb, (raw) => {
        const c = buildItemCase(raw);
        fc.pre(!itemInBugCondition(c));
        const expected = frozenResolveQuotedTextForItem(c.row, c.anchors, c.segments);
        const actual = resolveQuotedTextForItem(c.row, c.anchors, c.segments);
        expect(actual).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Observed on unfixed code; each example is outside the bug condition.
  const para0 = 'Heading';
  const para1 = 'The Board denied the College\u2019s request. It then adjourned the hearing.';
  const examples: Array<{ name: string; c: ItemCase; expected: ResolvedQuote | undefined }> = [
    {
      name: 'anchored paragraph exact match expands to the sentence',
      c: {
        row: { id: 'fb-1', quoted_text: 'then adjourned', current_anchor_id: 'an-1' },
        anchors: new Map([['fb-1', { id: 'an-1', paragraph_index: 1, start_offset: 0, end_offset: 0 }]]),
        segments: [{ index: 0, text: para0 }, { index: 1, text: para1 }],
      },
      expected: { text: 'It then adjourned the hearing.', paragraphIndex: 1, startOffset: 40, endOffset: 70 },
    },
    {
      name: 'scan finds a case-insensitive match when the anchor names the wrong paragraph',
      c: {
        row: { id: 'fb-1', quoted_text: 'THE BOARD DENIED', current_anchor_id: 'an-1' },
        anchors: new Map([['fb-1', { id: 'an-1', paragraph_index: 0, start_offset: 0, end_offset: 0 }]]),
        segments: [{ index: 0, text: para0 }, { index: 1, text: para1 }],
      },
      expected: { text: 'The Board denied the College\u2019s request.', paragraphIndex: 1, startOffset: 0, endOffset: 39 },
    },
    {
      name: 'truncated last word snaps to the whole word (no anchor)',
      c: {
        row: { id: 'fb-1', quoted_text: 'then adjourned the hea' },
        anchors: new Map(),
        segments: [{ index: 0, text: para0 }, { index: 1, text: para1 }],
      },
      expected: { text: 'It then adjourned the hearing.', paragraphIndex: 1, startOffset: 40, endOffset: 70 },
    },
    {
      name: 'anchor-offset fallback when the stored quote is absent after fold',
      c: {
        row: { id: 'fb-1', quoted_text: 'a paraphrase that is not in the draft', current_anchor_id: 'an-1' },
        anchors: new Map([['fb-1', { id: 'an-1', paragraph_index: 1, start_offset: 44, end_offset: 50 }]]),
        segments: [{ index: 0, text: para0 }, { index: 1, text: para1 }],
      },
      expected: { text: 'It then adjourned the hearing.', paragraphIndex: 1, startOffset: 40, endOffset: 70 },
    },
    {
      name: 'unresolved fallback returns the stored text',
      c: {
        row: { id: 'fb-1', quoted_text: "Fiona's conduct", current_anchor_id: 'an-1' },
        anchors: new Map([['fb-1', { id: 'an-1', paragraph_index: 7, start_offset: 0, end_offset: 5 }]]),
        segments: [{ index: 0, text: 'The investigator found that Fionas conduct was fine.' }],
      },
      expected: { text: "Fiona's conduct", paragraphIndex: 7, startOffset: 0, endOffset: 0 },
    },
  ];

  it.each(examples)('$name', ({ c, expected }) => {
    expect(itemInBugCondition(c)).toBe(false);
    const frozen = frozenResolveQuotedTextForItem(c.row, c.anchors, c.segments);
    expect(frozen).toEqual(expected);
    expect(resolveQuotedTextForItem(c.row, c.anchors, c.segments)).toEqual(frozen);
  });
});

// --------------------------------------------------------------------------- //
// Property: Ask WREN preservation (3.10)                                      //
// --------------------------------------------------------------------------- //

const LOCATIONS = ['early in the draft', 'mid-draft', 'toward the end', 'near the end', 'page 2', 'later on'];

const spanArb = fc.record({
  pick: fc.nat(),
  start: fc.nat(),
  len: fc.integer({ min: 5, max: 80 }),
  variant: variantArb,
  random: fc.array(wordArb, { minLength: 2, maxLength: 5 }).map((ws) => ws.join(' ')),
  useRandom: fc.boolean(),
  open: fc.constantFrom('"', '\u201C'),
  close: fc.constantFrom('"', '\u201D'),
  location: fc.constantFrom(...LOCATIONS),
  lead: fc.constantFrom('You wrote ', 'Consider ', 'Here: ', ''),
});

const askCaseArb = fc.record({
  texts: fc.array(paragraphArb, { minLength: 0, maxLength: 5 }),
  spans: fc.array(spanArb, { minLength: 0, maxLength: 3 }),
  tail: fc.constantFrom(' What standard applies?', '', ' Why?'),
});

const REPLY_PATTERN = /(["“])([^"”]{5,160})(["”])\s*\(([^)]{3,60})\)/g;

function askInBugCondition(reply: string, segments: Segment[]): boolean {
  const paragraphs = segments
    .map((s) => (typeof s.text === 'string' ? s.text : ''))
    .filter((t) => t.trim().length > 0);
  if (!paragraphs.length) return false;
  for (const m of reply.matchAll(REPLY_PATTERN)) {
    if (isBugConditionTS(paragraphs, String(m[2]))) return true;
  }
  return false;
}

describe('Preservation: expandQuotesAgainstDraft matches the frozen original', () => {
  it('property: identical reply text for quotes outside the bug condition', () => {
    fc.assert(
      fc.property(askCaseArb, ({ texts, spans, tail }) => {
        const segments: Segment[] = texts.map((t, k) => ({ index: k, text: t }));
        const reply =
          spans
            .map((s) => {
              const q = deriveQuote(texts, s.pick, s.start, s.len, s.variant, s.random, s.useRandom);
              return `${s.lead}${s.open}${q}${s.close} (${s.location}).`;
            })
            .join(' ') + tail;
        fc.pre(!askInBugCondition(reply, segments));
        expect(expandQuotesAgainstDraft(reply, segments)).toBe(
          frozenExpandQuotesAgainstDraft(reply, segments),
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('location band ordering picks the band paragraph first (observed)', () => {
    const segments: Segment[] = [
      { index: 0, text: 'The court held the duty was owed.' },
      { index: 1, text: 'Middle text.' },
      { index: 2, text: 'Finally the court held the duty was breached.' },
    ];
    const reply = 'You wrote "the court held the duty was" (near the end).';
    const expected = 'You wrote "the court held the duty was" (near the end).';
    expect(frozenExpandQuotesAgainstDraft(reply, segments)).toBe(expected);
    expect(expandQuotesAgainstDraft(reply, segments)).toBe(expected);

    const truncated = 'You wrote "the court held the duty was brea" (near the end).';
    const expectedTrunc = 'You wrote "the court held the duty was breached" (near the end).';
    expect(frozenExpandQuotesAgainstDraft(truncated, segments)).toBe(expectedTrunc);
    expect(expandQuotesAgainstDraft(truncated, segments)).toBe(expectedTrunc);
  });

  it('non-matching and case-insensitive quotes are unchanged (observed)', () => {
    const segments: Segment[] = [{ index: 0, text: 'The Board denied the request.' }];
    const miss = 'You wrote "an unrelated paraphrase" (early).';
    expect(expandQuotesAgainstDraft(miss, segments)).toBe(miss);
    const cased = 'You wrote "the board denied" (early).';
    expect(expandQuotesAgainstDraft(cased, segments)).toBe('You wrote "The Board denied" (early).');
    expect(frozenExpandQuotesAgainstDraft(cased, segments)).toBe('You wrote "The Board denied" (early).');
  });
});
