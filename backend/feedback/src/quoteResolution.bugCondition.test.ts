/**
 * Bug condition exploration tests: typographic quote matching in the debrief
 * API quote rebuild and the Ask WREN quote expansion.
 *
 * Spec: .kiro/specs/debrief-quote-typographic-matching-fix (Task 1).
 *
 * Property 1 / Property 4: Bug Condition - a stored or model quote that differs
 * from a draft paragraph only in typographic quote characters (’ ‘ “ ” vs ' ")
 * must resolve to the paragraph's ORIGINAL characters, with offsets such that
 * `para.slice(startOffset, endOffset) === text`.
 *
 * These tests failed on the unfixed code (confirming the bug) and pass once
 * the fix is in place. Subjects: `resolveQuotedTextForItem` from
 * `./quoteResolution.js` and `expandQuotesAgainstDraft` from `./askWren.js`.
 *
 * **Validates: Requirements 1.4, 1.5, 1.6 (expected: 2.4, 2.5, 2.6)**
 */
import { expandQuotesAgainstDraft } from './askWren.js';
import { resolveQuotedTextForItem, type ResolvedQuote } from './quoteResolution.js';

type Segment = { index?: number; text?: string };

// --------------------------------------------------------------------------- //
// Cases from wren-dev "Anchor match FAILED" logs                              //
// --------------------------------------------------------------------------- //

const FIONA_PARA = 'The investigator found that Fiona\u2019s conduct was consistent with the policy.';

const LOG_CASES: Array<{ name: string; para: string; stored: string; expectedSpan: string }> = [
  { name: 'apostrophe', para: FIONA_PARA, stored: "Fiona's conduct", expectedSpan: 'Fiona\u2019s conduct' },
  {
    name: 'opening double quote',
    para: 'The complainant must prove \u201cthe prohibited conduct\u201d occurred on the balance of probabilities.',
    stored: 'prove "the prohibited conduct',
    expectedSpan: 'prove \u201cthe prohibited conduct',
  },
  {
    name: 'bracketed opening quote',
    para: 'The tribunal described the respondent \u201c[w]atching the complainant\u201d for weeks.',
    stored: '"[w]atching',
    expectedSpan: '\u201c[w]atching',
  },
  {
    name: 'paired quotes with numbered prefix',
    para: '5.The generated files \u201cproject_details\u201d and \u201csummary\u201d are stored in S3.',
    stored: 'The generated files "project_details"',
    expectedSpan: 'The generated files \u201cproject_details\u201d',
  },
];

function assertResolvedToOriginal(
  result: ResolvedQuote | undefined,
  segments: Segment[],
  expectedParagraphIndex: number,
  expectedSpan: string,
): void {
  expect(result).toBeDefined();
  const r = result!;
  expect(r.paragraphIndex).toBe(expectedParagraphIndex);
  const para = segments[expectedParagraphIndex]!.text!;
  expect(r.endOffset).toBeGreaterThan(r.startOffset);
  expect(para.slice(r.startOffset, r.endOffset)).toBe(r.text);
  expect(r.text).toContain(expectedSpan);
}

describe('Bug condition: debrief rebuild resolves typographic quote variants', () => {
  it('scan finds the curly paragraph when the anchor names the wrong paragraph', () => {
    const segments: Segment[] = [
      { index: 0, text: 'Acknowledgements' },
      { index: 1, text: FIONA_PARA },
    ];
    const row = { id: 'fb-1', quoted_text: "Fiona's conduct", current_anchor_id: 'an-1' };
    const anchors = new Map<string, any>([
      ['fb-1', { id: 'an-1', paragraph_index: 0, start_offset: 0, end_offset: 0 }],
    ]);

    const result = resolveQuotedTextForItem(row, anchors, segments);

    assertResolvedToOriginal(result, segments, 1, 'Fiona\u2019s conduct');
    expect(result!.text).not.toContain("Fiona's");
  });

  it.each(LOG_CASES)(
    'anchored paragraph resolves: $name',
    ({ para, stored, expectedSpan }) => {
      const segments: Segment[] = [
        { index: 0, text: 'Heading' },
        { index: 1, text: para },
      ];
      const row = { id: 'fb-1', quoted_text: stored, current_anchor_id: 'an-1' };
      const anchors = new Map<string, any>([
        ['fb-1', { id: 'an-1', paragraph_index: 1, start_offset: 0, end_offset: 0 }],
      ]);

      const result = resolveQuotedTextForItem(row, anchors, segments);

      assertResolvedToOriginal(result, segments, 1, expectedSpan);
    },
  );
});

describe('Bug condition: Ask WREN substitutes the draft\u2019s original characters', () => {
  it('rewrites "Fiona\'s conduct was" (early) to the curly original', () => {
    const segments: Segment[] = [{ index: 0, text: FIONA_PARA }];
    const reply = 'You wrote "Fiona\'s conduct was" (early). What standard applies here?';

    const out = expandQuotesAgainstDraft(reply, segments);

    expect(out).toBe('You wrote "Fiona\u2019s conduct was" (early). What standard applies here?');
  });
});
