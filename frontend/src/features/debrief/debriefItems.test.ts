import { describe, expect, it } from 'vitest';

import { isStrengthItem, strengthDisplayText } from './debriefItems';

describe('isStrengthItem', () => {
  it('treats kind=strength as done well', () => {
    expect(isStrengthItem({ kind: 'strength' })).toBe(true);
  });

  it('treats a positive note on another kind as done well', () => {
    expect(isStrengthItem({ kind: 'structural', positiveNote: 'Clear headings.' })).toBe(true);
  });

  it('does not treat critique items as done well', () => {
    expect(isStrengthItem({ kind: 'inline' })).toBe(false);
    expect(isStrengthItem({ kind: 'structural', positiveNote: '   ' })).toBe(false);
  });
});

describe('strengthDisplayText', () => {
  it('prefers the positive note', () => {
    expect(
      strengthDisplayText({
        positiveNote: 'Strong issue statement.',
        questionText: 'How else could you use this?',
      }),
    ).toBe('Strong issue statement.');
  });

  it('falls back to the question when the note is missing', () => {
    expect(
      strengthDisplayText({
        questionText: 'How else could you use this?',
      }),
    ).toBe('How else could you use this?');
  });
});
