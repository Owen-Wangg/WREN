/**
 * Property-based tests for `extractFootnotes` completeness, malformed-node
 * skipping, and absent-data behavior (footnote-citation-support spec,
 * Tasks 7.4, 7.5, 7.6).
 */
import fc from 'fast-check';

import { extractFootnotes, tipTapContentToSegments, type TipTapNode } from './tiptapContent';
import { wrenProperty } from '../../testing/typescript/property';

function wellFormedFootnote(
  footnoteNumber: number,
  bodyText: string,
  citation: { author?: string; title?: string; source?: string; pinpoint?: string; year?: string } = {},
): TipTapNode {
  return {
    type: 'footnote',
    attrs: {
      footnoteNumber,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: bodyText }] }] },
      author: citation.author ?? '',
      title: citation.title ?? '',
      source: citation.source ?? '',
      pinpoint: citation.pinpoint ?? '',
      year: citation.year ?? '',
    },
  };
}

describe('Property 10: footnote extraction is complete and structurally correct', () => {
  it('returns exactly one entry per well-formed footnote node, matching footnoteNumber and content, sorted ascending', () => {
    const tag = wrenProperty(
      { number: 10, text: 'Footnote extraction is complete and structurally correct' },
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 200 }), { minLength: 0, maxLength: 15 }),
        (numbers) => {
          const doc: TipTapNode = {
            type: 'doc',
            content: numbers.map((n, i) => ({
              type: 'paragraph',
              content: [wellFormedFootnote(n, `Body text ${i}`)],
            })),
          };
          const extracted = extractFootnotes(doc);
          if (extracted.length !== numbers.length) return false;
          const expectedSorted = [...numbers].sort((a, b) => a - b);
          const extractedNumbers = extracted.map((e) => e.footnoteNumber);
          if (JSON.stringify(extractedNumbers) !== JSON.stringify(expectedSorted)) return false;
          return extracted.every((e) => {
            const sourceIndex = numbers.indexOf(e.footnoteNumber);
            return e.content === `Body text ${sourceIndex}`;
          });
        },
      ),
    );
    expect(tag).toContain('Property 10');
  });

  it('paragraphIndex matches the segment index tipTapContentToSegments would assign to the same paragraph', () => {
    wrenProperty(
      { number: 10, text: 'Footnote extraction paragraphIndex matches segment index' },
      fc.property(fc.integer({ min: 1, max: 200 }), (n) => {
        const doc: TipTapNode = {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'First.' }] },
            { type: 'paragraph', content: [wellFormedFootnote(n, 'Second body.')] },
          ],
        };
        const extracted = extractFootnotes(doc);
        const segments = tipTapContentToSegments(doc);
        return extracted[0]?.paragraphIndex === 1 && segments[1]?.text === `[${n}]`;
      }),
    );
  });
});

describe('Property 12: malformed footnotes are skipped, not fatal, during extraction', () => {
  const malformedFootnoteArb = fc.oneof(
    fc.constant({
      type: 'footnote',
      attrs: { content: { type: 'doc', content: [] }, author: '', title: '', source: '', pinpoint: '', year: '' },
    }),
    fc.constant({
      type: 'footnote',
      attrs: {
        footnoteNumber: 'not-a-number',
        content: { type: 'doc', content: [] },
        author: '',
        title: '',
        source: '',
        pinpoint: '',
        year: '',
      },
    }),
    fc.constant({
      type: 'footnote',
      attrs: { footnoteNumber: 1, author: '', title: '', source: '', pinpoint: '', year: '' },
    }),
    fc.constant({
      type: 'footnote',
      attrs: {
        footnoteNumber: 0,
        content: { type: 'doc', content: [] },
        author: '',
        title: '',
        source: '',
        pinpoint: '',
        year: '',
      },
    }),
  );

  it('returns an entry for every well-formed node and omits every malformed node, without throwing', () => {
    wrenProperty(
      { number: 12, text: 'Malformed footnotes are skipped, not fatal, during extraction' },
      fc.property(
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 0, maxLength: 8 }),
        fc.array(malformedFootnoteArb, { minLength: 0, maxLength: 8 }),
        (wellFormedNumbers, malformed) => {
          const wellFormedNodes = wellFormedNumbers.map((n) => wellFormedFootnote(n, 'ok'));
          const doc: TipTapNode = {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [...wellFormedNodes, ...(malformed as unknown as TipTapNode[])],
              },
            ],
          };
          let extracted: ReturnType<typeof extractFootnotes> | undefined;
          expect(() => {
            extracted = extractFootnotes(doc);
          }).not.toThrow();
          const extractedNumbers = (extracted ?? []).map((e) => e.footnoteNumber).sort((a, b) => a - b);
          const expectedNumbers = [...wellFormedNumbers].sort((a, b) => a - b);
          return JSON.stringify(extractedNumbers) === JSON.stringify(expectedNumbers);
        },
      ),
    );
  });
});

describe('Property 4: absent footnote data behaves as zero footnotes throughout the pipeline', () => {
  it('extractFootnotes returns [] for null/undefined content', () => {
    wrenProperty(
      { number: 4, text: 'Absent footnote data behaves as zero footnotes (null/undefined content)' },
      fc.property(fc.constantFrom(null, undefined), (content) => {
        return extractFootnotes(content).length === 0;
      }),
    );
  });

  it('extractFootnotes returns [] for any document with no footnote nodes, and segments contain no placeholders', () => {
    wrenProperty(
      { number: 4, text: 'Absent footnote data behaves as zero footnotes (no footnote nodes)' },
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 30 }), { minLength: 0, maxLength: 5 }),
        (paragraphTexts) => {
          const doc: TipTapNode = {
            type: 'doc',
            content: paragraphTexts.map((text) => ({
              type: 'paragraph',
              content: text ? [{ type: 'text', text }] : undefined,
            })),
          };
          const extracted = extractFootnotes(doc);
          const segments = tipTapContentToSegments(doc);
          const noPlaceholders = segments.every((s) => !/\[\d+\]|\[\?\]/.test(s.text));
          return extracted.length === 0 && noPlaceholders;
        },
      ),
    );
  });
});
