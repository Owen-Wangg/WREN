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
});

describe('isWrapContinuation', () => {
  it('requires a lowercase start or capital wrap signal', () => {
    expect(isWrapContinuation('the franchisee\'s', 'wrongdoings.')).toBe(true);
    expect(isWrapContinuation('End of thought.', 'wrongdoings.')).toBe(false);
    expect(isWrapContinuation('and the', 'Furthermore, premises')).toBe(true);
    expect(isWrapContinuation('and the', 'Issue 1(b): liability')).toBe(false);
  });
});
