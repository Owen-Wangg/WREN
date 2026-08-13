/**
 * Tier 2 smoke check — confirms the browser-mode project really measures layout.
 *
 * Every geometry claim in the pagination-content-occlusion spec rests on this
 * tier being real. jsdom returns zero rects and empty `Range.getClientRects()`,
 * so before any invariant is asserted against Tier 2, this file proves the
 * environment reports non-zero measured geometry, real line boxes, and resolved
 * computed styles. If this file fails, no Tier 2 result downstream means
 * anything.
 *
 * Runs in the `browser` Vitest project only (`*.browser.test.ts`).
 *
 * @see .kiro/specs/pagination-content-occlusion/design.md — "Tier 2 — Layout-Dependent
 *      Invariants In A Real Browser Engine"
 * Validates: Requirements 2.10
 */
import { afterEach, describe, expect, it } from 'vitest';

import { PAGE_CONFIG } from './types';

let mounted: HTMLElement | null = null;

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.style.width = `${PAGE_CONFIG.USABLE_WIDTH_PX}px`;
  host.style.font = '16px/20px serif';
  host.innerHTML = html;
  document.body.appendChild(host);
  mounted = host;
  return host;
}

afterEach(() => {
  mounted?.remove();
  mounted = null;
});

describe('Tier 2 environment (browser mode)', () => {
  it('measures a non-zero getBoundingClientRect', () => {
    const host = mount('<p>Measured geometry is available in this tier.</p>');
    const paragraph = host.querySelector('p');
    expect(paragraph).not.toBeNull();

    const rect = paragraph!.getBoundingClientRect();
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.bottom).toBeGreaterThan(rect.top);
  });

  it('breaks text into more than one measured line box', () => {
    // Narrow the box so the browser must wrap — jsdom cannot do this at all.
    const host = mount(
      `<p style="width: 120px">${'wrapping legal prose '.repeat(20)}</p>`,
    );
    const paragraph = host.querySelector('p')!;

    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const lineRects = Array.from(range.getClientRects()).filter((rect) => rect.height > 0);

    expect(lineRects.length).toBeGreaterThan(1);
    expect(lineRects[0]!.bottom).toBeLessThanOrEqual(lineRects[lineRects.length - 1]!.top + 1);
  });

  it('applies max-height + overflow: hidden as a real clip', () => {
    const host = mount(
      `<p style="max-height: 20px; overflow: hidden">${'clipped '.repeat(60)}</p>`,
    );
    const paragraph = host.querySelector('p')!;

    expect(paragraph.getBoundingClientRect().height).toBeLessThanOrEqual(20);
    expect(paragraph.scrollHeight).toBeGreaterThan(20);
  });

  it('resolves computed styles, so stacking order is observable', () => {
    const host = mount('<div style="z-index: 2; position: relative"></div>');
    const layer = host.querySelector('div')!;

    expect(getComputedStyle(layer).zIndex).toBe('2');
  });
});
