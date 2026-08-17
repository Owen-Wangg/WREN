import { describe, expect, it } from 'vitest';

import { capInlineFontSize } from './tiptapFontSize';

describe('capInlineFontSize', () => {
  it('leaves ordinary sizes unchanged', () => {
    expect(capInlineFontSize('12pt')).toBe('12pt');
    expect(capInlineFontSize('36pt')).toBe('36pt');
  });

  it('clamps letterhead sizes to the toolbar max', () => {
    expect(capInlineFontSize('192pt')).toBe('36pt');
    expect(capInlineFontSize('96pt')).toBe('36pt');
  });
});
