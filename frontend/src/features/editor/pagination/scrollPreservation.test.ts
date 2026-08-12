/**
 * Regression tests for scroll conservation across pagination relayout.
 *
 * Pagination relayout tears down injected gaps, clips, phantom margins and
 * continuation clones before rebuilding them, so document height collapses and
 * re-expands inside a single frame. While collapsed, the browser clamps
 * `scrollTop` to the smaller maximum and does not restore it when height comes
 * back — the viewport lands at the bottom of the collapsed document.
 *
 * `PageRenderer.withScrollPreserved()` holds the position across that window.
 * These tests pin that contract.
 *
 * jsdom performs no layout, so `scrollTop` / `scrollHeight` / `clientHeight`
 * are backed by explicit properties here. That keeps the tests about the
 * preservation logic rather than about jsdom's layout fidelity.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { PageRenderer } from './PageRenderer';

interface ScrollStub {
  el: HTMLElement;
  setMetrics: (metrics: { scrollHeight?: number; clientHeight?: number }) => void;
}

/** A scroll container with controllable scroll metrics. */
function createScrollContainer(initial: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): ScrollStub {
  const el = document.createElement('div');
  el.className = 'document-editor-scroll';

  let scrollTop = initial.scrollTop;
  let scrollHeight = initial.scrollHeight;
  let clientHeight = initial.clientHeight;

  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  });

  document.body.appendChild(el);

  return {
    el,
    setMetrics: (metrics) => {
      if (metrics.scrollHeight !== undefined) scrollHeight = metrics.scrollHeight;
      if (metrics.clientHeight !== undefined) clientHeight = metrics.clientHeight;
    },
  };
}

describe('PageRenderer.withScrollPreserved', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('restores scrollTop when a relayout moves it', () => {
    const stub = createScrollContainer({
      scrollTop: 4000,
      scrollHeight: 10_000,
      clientHeight: 800,
    });
    const renderer = new PageRenderer(stub.el);

    renderer.withScrollPreserved('test', () => {
      // Simulate the browser clamping during the collapsed window, then the
      // document re-expanding to its full height afterwards.
      stub.setMetrics({ scrollHeight: 2000 });
      stub.el.scrollTop = 1200;
      stub.setMetrics({ scrollHeight: 10_000 });
    });

    expect(stub.el.scrollTop).toBe(4000);
  });

  it('reproduces the jump-to-bottom without preservation', () => {
    // Guards the premise: an unwrapped relayout leaves the clamped position.
    const stub = createScrollContainer({
      scrollTop: 4000,
      scrollHeight: 10_000,
      clientHeight: 800,
    });

    stub.setMetrics({ scrollHeight: 2000 });
    stub.el.scrollTop = 1200;
    stub.setMetrics({ scrollHeight: 10_000 });

    expect(stub.el.scrollTop).toBe(1200);
  });

  it('leaves scrollTop alone when the relayout did not move it', () => {
    const stub = createScrollContainer({
      scrollTop: 2500,
      scrollHeight: 10_000,
      clientHeight: 800,
    });
    const renderer = new PageRenderer(stub.el);

    renderer.withScrollPreserved('test', () => {
      // A relayout that happens not to disturb scroll position.
    });

    expect(stub.el.scrollTop).toBe(2500);
  });

  it('clamps the restore when the document is legitimately shorter', () => {
    const stub = createScrollContainer({
      scrollTop: 9000,
      scrollHeight: 10_000,
      clientHeight: 800,
    });
    const renderer = new PageRenderer(stub.el);

    renderer.withScrollPreserved('test', () => {
      // Content was deleted: the document really is shorter now.
      stub.setMetrics({ scrollHeight: 3000 });
      stub.el.scrollTop = 0;
    });

    // 3000 - 800 = 2200 is the new maximum; restoring 9000 would be invalid.
    expect(stub.el.scrollTop).toBe(2200);
  });

  it('does not fight the user when they are pinned to the bottom', () => {
    const stub = createScrollContainer({
      scrollTop: 9200, // 10_000 - 800 = at the very bottom
      scrollHeight: 10_000,
      clientHeight: 800,
    });
    const renderer = new PageRenderer(stub.el);

    renderer.withScrollPreserved('test', () => {
      // Document grew; a bottom-pinned reader should not be yanked back.
      stub.setMetrics({ scrollHeight: 12_000 });
      stub.el.scrollTop = 11_200;
    });

    expect(stub.el.scrollTop).toBe(11_200);
  });

  it('restores scroll even when the relayout throws', () => {
    const stub = createScrollContainer({
      scrollTop: 3000,
      scrollHeight: 10_000,
      clientHeight: 800,
    });
    const renderer = new PageRenderer(stub.el);

    expect(() =>
      renderer.withScrollPreserved('test', () => {
        stub.el.scrollTop = 0;
        throw new Error('relayout failed mid-pass');
      }),
    ).toThrow('relayout failed mid-pass');

    expect(stub.el.scrollTop).toBe(3000);
  });

  it('returns the callback result', () => {
    const stub = createScrollContainer({
      scrollTop: 0,
      scrollHeight: 1000,
      clientHeight: 800,
    });
    const renderer = new PageRenderer(stub.el);

    expect(renderer.withScrollPreserved('test', () => 'page-count-7')).toBe(
      'page-count-7',
    );
  });
});
