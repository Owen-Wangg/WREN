import type { TipTapNode } from '@wren/types';

import {
  isPageNumberParagraph,
  isWrapContinuation,
  stitchWrappedParagraphs,
  tipTapPlainText,
} from './stitchWrappedParagraphs';

function para(text: string, indent?: number): TipTapNode {
  return {
    type: 'paragraph',
    ...(indent ? { attrs: { indent } } : {}),
    content: text ? [{ type: 'text', text }] : undefined,
  };
}

describe('stitchWrappedParagraphs', () => {
  it('joins a mid-sentence leftover that starts with lowercase', () => {
    const nodes = [
      para('Vicarious liability will typically not extend to include the franchisee\'s'),
      para('wrongdoings.', 3),
    ];
    const result = stitchWrappedParagraphs(nodes);
    expect(result).toHaveLength(1);
    expect(tipTapPlainText(result[0]!)).toBe(
      'Vicarious liability will typically not extend to include the franchisee\'s wrongdoings.',
    );
  });

  it('joins a capitalized transition after a hanging word wrap', () => {
    const nodes = [
      para('activities conducted on those premises and the'),
      para('Furthermore, "premises" includes "land and structures'),
    ];
    const result = stitchWrappedParagraphs(nodes);
    expect(result).toHaveLength(1);
    expect(tipTapPlainText(result[0]!)).toContain('and the Furthermore');
  });

  it('does not glue a new issue label onto a mid-sentence line', () => {
    const nodes = [
      para('activities conducted on those premises and the'),
      para('Issue 1(b): Vicarious liability'),
    ];
    const result = stitchWrappedParagraphs(nodes);
    expect(result).toHaveLength(2);
  });

  it('joins a lowercase wrap after a capitalized leftover quote', () => {
    const nodes = [
      para('Furthermore, "premises" includes "land and structures'),
      para('persons allowed to enter those premises.', 2),
    ];
    const result = stitchWrappedParagraphs(nodes);
    expect(result).toHaveLength(1);
    expect(tipTapPlainText(result[0]!)).toContain('land and structures persons allowed');
  });

  it('drops a leaked page-number paragraph', () => {
    const nodes = [para('or either of them'), para('18'), para('wrongdoings.')];
    const result = stitchWrappedParagraphs(nodes);
    expect(result.some(isPageNumberParagraph)).toBe(false);
    expect(result).toHaveLength(1);
    expect(tipTapPlainText(result[0]!)).toBe('or either of them wrongdoings.');
  });

  it('stitches across an empty column-separator paragraph', () => {
    const nodes = [
      para('the franchisee\'s'),
      para(''),
      para('wrongdoings.'),
    ];
    const result = stitchWrappedParagraphs(nodes);
    expect(result).toHaveLength(1);
    expect(tipTapPlainText(result[0]!)).toBe("the franchisee's wrongdoings.");
  });

  it('dehyphenates across a wrap', () => {
    const nodes = [para('wrongdo-'), para('ings.')];
    const result = stitchWrappedParagraphs(nodes);
    expect(tipTapPlainText(result[0]!)).toBe('wrongdoings.');
  });

  it('keeps the first paragraph layout attrs when joining', () => {
    const result = stitchWrappedParagraphs([
      aligned('the franchisee is not liable for the', { indent: 2 }),
      para('wrongdoings.', 5),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.attrs).toEqual({ indent: 2 });
  });

  it('does not join centered title-page lines or lines under a different alignment', () => {
    const result = stitchWrappedParagraphs([
      aligned('Plaintiff', { textAlign: 'right' }),
      para('And'),
      aligned('James Douglas Pearman and Christine Sheila Kuramoto', { textAlign: 'center' }),
      aligned('Defendants', { textAlign: 'right' }),
      aligned('Before: The Honourable Justice K. Loo', { textAlign: 'center' }),
    ]);
    expect(result.map(tipTapPlainText)).toEqual([
      'Plaintiff',
      'And',
      'James Douglas Pearman and Christine Sheila Kuramoto',
      'Defendants',
      'Before: The Honourable Justice K. Loo',
    ]);
  });

  it('does not join a label line ending in ":" onto the next value', () => {
    const result = stitchWrappedParagraphs([
      para('Counsel for the Plaintiff:'),
      para('G.A. Phillips'),
    ]);
    expect(result).toHaveLength(2);
  });

  it('does not snowball once a joined paragraph passes the length rule', () => {
    const result = stitchWrappedParagraphs([
      para('The parties to this application both cited the decision in'),
      para('Bergen v. Bergen as the leading case'),
      para('Reasons'),
      para('Counsel for the Defendant'),
    ]);
    // Hanging "in" joins line 2; the short joined fragment must not drag in the rest.
    expect(result.map(tipTapPlainText)).toEqual([
      'The parties to this application both cited the decision in Bergen v. Bergen as the leading case',
      'Reasons',
      'Counsel for the Defendant',
    ]);
  });

  it('still joins long full-width OCR lines that share a layout', () => {
    const result = stitchWrappedParagraphs([
      para('Ms. Kuramoto contends that the Deceased made an irrevocable gift to her of'),
      para('Both a joint interest in the Property and the right of survivorship by way'),
      para('Of certain documents signed and delivered in 2008.'),
    ]);
    expect(result).toHaveLength(1);
  });

  it('does not stitch across a column separator when layouts differ', () => {
    const result = stitchWrappedParagraphs([
      para("the franchisee's"),
      para(''),
      para('wrongdoings.', 4),
    ]);
    expect(result).toHaveLength(3);
  });
});

function aligned(text: string, attrs: Record<string, unknown>): TipTapNode {
  return { type: 'paragraph', attrs, content: [{ type: 'text', text }] };
}

describe('isWrapContinuation', () => {
  it('requires a lowercase start or capital wrap signal', () => {
    expect(isWrapContinuation('the franchisee\'s', 'wrongdoings.')).toBe(true);
    expect(isWrapContinuation('End of thought.', 'wrongdoings.')).toBe(false);
    expect(isWrapContinuation('and the', 'Furthermore, premises')).toBe(true);
    expect(isWrapContinuation('and the', 'Issue 1(b): liability')).toBe(false);
  });
});
