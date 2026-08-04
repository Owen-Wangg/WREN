/**
 * Property-based test: segment placeholders correctly represent footnote
 * markers (footnote-citation-support spec, Task 7.2).
 *
 * Feature: footnote-citation-support, Property 13: Segment placeholders correctly represent footnote markers
 *
 * For any paragraph containing a `footnote` node, `tipTapContentToSegments`
 * includes `[N]` (its `footnoteNumber`) in that paragraph's segment text
 * when `footnoteNumber` is a positive integer, or `[?]` when it is missing
 * or non-numeric — and never includes any text from the footnote's
 * `content`.
 *
 * Validates: Requirements 5.4, 7.1, 7.5
 */
import fc from 'fast-check';

import { tipTapContentToSegments, type TipTapNode } from './tiptapContent';
import { wrenProperty } from '../../testing/typescript/property';

const PROPERTY = {
  number: 13,
  text: 'Segment placeholders correctly represent footnote markers',
};

/** Arbitrary well-formed positive-integer footnoteNumber, or a malformed value. */
const malformedFootnoteNumberArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant('not-a-number'),
  fc.integer({ min: -100, max: 0 }),
  fc.double({ min: 0.1, max: 99.9, noNaN: true }).filter((n) => !Number.isInteger(n)),
);

function footnoteNode(footnoteNumber: unknown, bodyText: string): TipTapNode {
  return {
    type: 'footnote',
    attrs: {
      footnoteNumber,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: bodyText }] }] },
    },
  };
}

describe('Property 13: segment placeholders correctly represent footnote markers', () => {
  it('emits [N] for a positive-integer footnoteNumber, embedding the number correctly', () => {
    const tag = wrenProperty(
      PROPERTY,
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.string({ minLength: 0, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 30 }),
        (n, prefix, bodyText) => {
          const doc: TipTapNode = {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: prefix },
                  footnoteNode(n, bodyText),
                ],
              },
            ],
          };
          const segments = tipTapContentToSegments(doc);
          const expectedText = `${prefix}[${n}]`.replace(/\s+/g, ' ').trim();
          return segments[0]?.text === expectedText;
        },
      ),
    );
    expect(tag).toContain('Property 13');
  });

  it('emits [?] for a missing or non-numeric footnoteNumber', () => {
    wrenProperty(
      PROPERTY,
      fc.property(malformedFootnoteNumberArb, fc.string({ minLength: 0, maxLength: 30 }), (badNumber, bodyText) => {
        const doc: TipTapNode = {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [footnoteNode(badNumber, bodyText)],
            },
          ],
        };
        const segments = tipTapContentToSegments(doc);
        return segments[0]?.text === '[?]';
      }),
    );
  });

  it('never includes any text from the footnote content body', () => {
    wrenProperty(
      PROPERTY,
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        (n, bodyText) => {
          const doc: TipTapNode = {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [footnoteNode(n, bodyText)],
              },
            ],
          };
          const segments = tipTapContentToSegments(doc);
          const text = segments[0]?.text ?? '';
          // The ONLY content the segment may contain for this paragraph is
          // the placeholder itself — assert the segment equals exactly
          // `[N]`, so no body text (whether or not it happens to overlap
          // with the placeholder's own digits/brackets) can have leaked in.
          return text === `[${n}]`;
        },
      ),
    );
  });

  it('multiple footnotes in one paragraph each contribute their own placeholder in order', () => {
    wrenProperty(
      PROPERTY,
      fc.property(
        fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 2, maxLength: 5 }),
        (numbers) => {
          const doc: TipTapNode = {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: numbers.map((n) => footnoteNode(n, 'body')),
              },
            ],
          };
          const segments = tipTapContentToSegments(doc);
          const expected = numbers.map((n) => `[${n}]`).join('');
          return segments[0]?.text === expected;
        },
      ),
    );
  });
});
