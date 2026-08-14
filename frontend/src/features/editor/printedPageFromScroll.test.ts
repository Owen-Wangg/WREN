import { describe, expect, it } from 'vitest';

import {
  formatPrintedPageHint,
  isPointInScrollbarGutter,
  printedPageFromScroll,
  scrollThumbCenterY,
} from './printedPageFromScroll';

describe('printedPageFromScroll', () => {
  it('returns page 1 when there is no overflow or only one page', () => {
    expect(printedPageFromScroll(0, 400, 400, 17)).toBe(1);
    expect(printedPageFromScroll(80, 1000, 200, 1)).toBe(1);
  });

  it('maps the top of the viewport onto equal printed-page slices', () => {
    expect(printedPageFromScroll(0, 1000, 200, 5)).toBe(1);
    expect(printedPageFromScroll(199, 1000, 200, 5)).toBe(1);
    expect(printedPageFromScroll(200, 1000, 200, 5)).toBe(2);
    expect(printedPageFromScroll(400, 1000, 200, 5)).toBe(3);
  });

  it('returns the last page at the bottom of the scroll range', () => {
    expect(printedPageFromScroll(800, 1000, 200, 5)).toBe(5);
    expect(printedPageFromScroll(798, 1000, 200, 5)).toBe(4);
  });

  it('clamps invalid page counts to 1', () => {
    expect(printedPageFromScroll(100, 1000, 200, 0)).toBe(1);
    expect(printedPageFromScroll(100, 1000, 200, Number.NaN)).toBe(1);
  });
});

describe('formatPrintedPageHint', () => {
  it('formats current of total', () => {
    expect(formatPrintedPageHint(2, 17)).toBe('Page 2 of 17');
    expect(formatPrintedPageHint(1, 1)).toBe('Page 1 of 1');
  });

  it('clamps the current page into range', () => {
    expect(formatPrintedPageHint(0, 17)).toBe('Page 1 of 17');
    expect(formatPrintedPageHint(99, 17)).toBe('Page 17 of 17');
  });
});

describe('scrollThumbCenterY', () => {
  it('sits at the top when not scrolled', () => {
    expect(scrollThumbCenterY(0, 1000, 200)).toBeGreaterThan(0);
    expect(scrollThumbCenterY(0, 1000, 200)).toBeLessThan(200);
  });

  it('moves down as scrollTop increases', () => {
    const top = scrollThumbCenterY(0, 1000, 200);
    const mid = scrollThumbCenterY(400, 1000, 200);
    const bottom = scrollThumbCenterY(800, 1000, 200);
    expect(mid).toBeGreaterThan(top);
    expect(bottom).toBeGreaterThan(mid);
  });
});

describe('isPointInScrollbarGutter', () => {
  const rect = { top: 100, right: 500, bottom: 400 };

  it('hits the right edge of the scrollport', () => {
    expect(isPointInScrollbarGutter(490, 200, rect, 18)).toBe(true);
    expect(isPointInScrollbarGutter(500, 200, rect, 18)).toBe(true);
  });

  it('ignores points in the document body or outside the port', () => {
    expect(isPointInScrollbarGutter(400, 200, rect, 18)).toBe(false);
    expect(isPointInScrollbarGutter(490, 50, rect, 18)).toBe(false);
    expect(isPointInScrollbarGutter(510, 200, rect, 18)).toBe(false);
  });
});
