import { fixGluedWordsInText } from './ocrTextCleanup';
import { shouldStitchParagraphs, wrapContinuationSignal } from './wrapContinuation';

describe('fixGluedWordsInText', () => {
  it('splits glued OCR words', () => {
    expect(fixGluedWordsInText('TheNegligence Act')).toBe('The Negligence Act');
    expect(fixGluedWordsInText('liabilityExtends')).toBe('liability Extends');
  });

  it('leaves surname prefixes intact', () => {
    for (const name of ['MacEwan', 'McDonald', 'MacLeod', 'VanDyke', 'DeLuca', 'LeBlanc', "O'Neil"]) {
      expect(fixGluedWordsInText(`Counsel K. ${name} appeared`)).toBe(`Counsel K. ${name} appeared`);
    }
  });
});

describe('wrapContinuationSignal', () => {
  it('measures the length rule against the last original line', () => {
    const accumulated = 'The parties both cited the decision in Bergen v. Bergen as the leading case';
    expect(wrapContinuationSignal(accumulated, 'Reasons')).toBe('weak');
    expect(wrapContinuationSignal(accumulated, 'Reasons', 'Bergen v. Bergen as the leading case')).toBeNull();
  });
});

describe('shouldStitchParagraphs', () => {
  it('joins strong wraps across a bogus OCR indent but not capitalized lines under a new alignment', () => {
    expect(
      shouldStitchParagraphs({ prevText: "the franchisee's", nextText: 'wrongdoings.', nextAttrs: { indent: 3, textAlign: 'center' } }),
    ).toBe(true);
    expect(
      shouldStitchParagraphs({ prevText: 'And', nextText: 'James Douglas Pearman', nextAttrs: { textAlign: 'center' } }),
    ).toBe(false);
  });

  it('keeps stacked centered lines apart unless the wrap is unambiguous', () => {
    const center = { textAlign: 'center' };
    const longLine = 'James Douglas Pearman and Christine Sheila Kuramoto Smith';
    expect(shouldStitchParagraphs({ prevText: longLine, prevAttrs: center, nextText: 'Defendants', nextAttrs: center })).toBe(false);
    expect(shouldStitchParagraphs({ prevText: 'Justice of the', prevAttrs: center, nextText: 'Supreme Court', nextAttrs: center })).toBe(true);
  });
});
