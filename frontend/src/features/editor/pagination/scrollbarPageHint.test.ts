import { describe, expect, it } from 'vitest';

import { PAGE_CONFIG } from './types';
import {
  formatPageHint,
  isOverVerticalScrollbar,
  pageFromDocumentY,
  SCROLLBAR_HIT_MIN_PX,
  visiblePageFromScroll,
} from './scrollbarPageHint';

const STRIDE = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;

describe('pageFromDocumentY', () => {
  it('maps the first page band to page 1', () => {
    expect(pageFromDocumentY(PAGE_CONFIG.PAGE_GAP_PX, 5)).toBe(1);
    expect(pageFromDocumentY(PAGE_CONFIG.PAGE_GAP_PX + PAGE_CONFIG.HEIGHT_PX - 1, 5)).toBe(1);
  });

  it('maps later bands to the matching 1-based page', () => {
    expect(pageFromDocumentY(PAGE_CONFIG.PAGE_GAP_PX + STRIDE, 5)).toBe(2);
    expect(pageFromDocumentY(PAGE_CONFIG.PAGE_GAP_PX + STRIDE * 4, 5)).toBe(5);
  });

  it('clamps to 1..pageCount', () => {
    expect(pageFromDocumentY(-100, 5)).toBe(1);
    expect(pageFromDocumentY(STRIDE * 20, 5)).toBe(5);
    expect(pageFromDocumentY(0, 1)).toBe(1);
  });
});

describe('visiblePageFromScroll', () => {
  it('reports page 1 at the top of a multi-page document', () => {
    const el = {
      scrollTop: 0,
      clientHeight: 800,
    } as HTMLElement;
    expect(visiblePageFromScroll(el, 5)).toBe(1);
  });

  it('advances when scrolled into a later page band', () => {
    const el = {
      scrollTop: STRIDE * 2,
      clientHeight: 800,
    } as HTMLElement;
    expect(visiblePageFromScroll(el, 5)).toBe(3);
  });
});

describe('formatPageHint', () => {
  it('formats the visible page against the total', () => {
    expect(formatPageHint(1, 5)).toBe('Page 1 of 5');
    expect(formatPageHint(3, 3)).toBe('Page 3 of 3');
  });
});

describe('isOverVerticalScrollbar', () => {
  function fakeScrollEl(overrides: Partial<HTMLElement> & { rect: DOMRect }): HTMLElement {
    const { rect, ...rest } = overrides;
    return {
      scrollHeight: 4000,
      clientHeight: 800,
      offsetWidth: 400,
      clientWidth: 400 - SCROLLBAR_HIT_MIN_PX,
      getBoundingClientRect: () => rect,
      ...rest,
    } as HTMLElement;
  }

  it('is true on the right gutter when content overflows', () => {
    const el = fakeScrollEl({
      rect: { top: 0, bottom: 800, left: 0, right: 400, width: 400, height: 800 } as DOMRect,
    });
    expect(isOverVerticalScrollbar(el, 395, 100)).toBe(true);
    expect(isOverVerticalScrollbar(el, 200, 100)).toBe(false);
  });

  it('is false when the document fits without scrolling', () => {
    const el = fakeScrollEl({
      scrollHeight: 800,
      clientHeight: 800,
      rect: { top: 0, bottom: 800, left: 0, right: 400, width: 400, height: 800 } as DOMRect,
    });
    expect(isOverVerticalScrollbar(el, 395, 100)).toBe(false);
  });
});
