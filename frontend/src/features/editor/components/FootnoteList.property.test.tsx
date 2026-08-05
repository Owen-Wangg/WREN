/**
 * Property-based test: footnote list is always rendered in ascending number
 * order (footnote-citation-support spec, Task 5.6).
 *
 * Feature: footnote-citation-support, Property 6: Footnote list is always rendered in ascending number order
 *
 * For any array of footnotes in any order, the rendered footnote list
 * orders them by ascending `footnoteNumber`, regardless of the input
 * array's order or the footnotes' document-order positions.
 *
 * Validates: Requirements 3.6
 */
import { render } from '@testing-library/react';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { FootnoteList } from './FootnoteList';
import type { FootnoteAttrs } from '../tiptapFootnote';

function makeFootnote(footnoteNumber: number): FootnoteAttrs {
  return {
    footnoteNumber,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Body ${footnoteNumber}` }] }] },
    author: '',
    title: '',
    source: '',
    pinpoint: '',
    year: '',
  };
}

/** Distinct positive integers, then shuffled arbitrarily via fc.shuffledSubarray. */
const distinctNumbersArb = fc
  .uniqueArray(fc.integer({ min: 1, max: 500 }), { minLength: 0, maxLength: 15 })
  .chain((numbers) => fc.shuffledSubarray(numbers, { minLength: numbers.length, maxLength: numbers.length }));

describe('Property 6: footnote list is always rendered in ascending number order', () => {
  it('renders footnotes sorted by footnoteNumber ascending regardless of input array order', () => {
    fc.assert(
      fc.property(distinctNumbersArb, (numbers) => {
        const footnotes = numbers.map(makeFootnote);
        const { container, unmount } = render(<FootnoteList footnotes={footnotes} />);

        const items = Array.from(container.querySelectorAll('[data-footnote-number]'));
        const renderedOrder = items.map((el) => Number(el.getAttribute('data-footnote-number')));
        const expectedOrder = [...numbers].sort((a, b) => a - b);

        unmount();
        expect(renderedOrder).toEqual(expectedOrder);
      }),
      { numRuns: 100 },
    );
  });

  it('renders nothing for an empty footnote list', () => {
    const { container, unmount } = render(<FootnoteList footnotes={[]} />);
    expect(container.querySelector('[data-footnote-list]')).toBeNull();
    unmount();
  });
});
