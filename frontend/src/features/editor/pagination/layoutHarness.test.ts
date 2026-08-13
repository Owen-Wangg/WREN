/**
 * Tier 3 tests for the Tier 3 harness — verifies the flow model responds to the
 * styles `PageRenderer` writes, so harness-based control-flow tests exercise the
 * branches they claim to. These assertions are about the harness, not about
 * browser geometry.
 *
 * @see layoutHarness.ts — tier discipline notes
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createLayoutHarness, HARNESS_LINE_HEIGHT_PX, type LayoutHarness } from './layoutHarness';

let harness: LayoutHarness | null = null;

afterEach(() => {
  harness?.destroy();
  harness = null;
});

describe('createLayoutHarness', () => {
  it('stacks blocks sequentially from startYPx and reports non-zero rects', () => {
    harness = createLayoutHarness({
      startYPx: 100,
      blocks: [
        { type: 'heading', lines: 1 },
        { type: 'paragraph', lines: 3 },
      ],
    });
    const [heading, paragraph] = harness.blocks;

    expect(harness.measuredTop(heading!)).toBe(100);
    expect(harness.measuredBottom(heading!)).toBe(100 + HARNESS_LINE_HEIGHT_PX);
    expect(harness.measuredTop(paragraph!)).toBe(100 + HARNESS_LINE_HEIGHT_PX);
    expect(paragraph!.getBoundingClientRect().height).toBe(3 * HARNESS_LINE_HEIGHT_PX);
  });

  it('displaces later blocks when an injected margin-top is written', () => {
    harness = createLayoutHarness({
      blocks: [{ type: 'paragraph', lines: 1 }, { type: 'paragraph', lines: 1 }],
    });
    const [first, second] = harness.blocks;

    second!.style.marginTop = '48px';

    expect(harness.measuredTop(first!)).toBe(0);
    expect(harness.measuredTop(second!)).toBe(HARNESS_LINE_HEIGHT_PX + 48);
  });

  it('honors a max-height clip while scrollHeight keeps the natural height', () => {
    harness = createLayoutHarness({ blocks: [{ type: 'paragraph', lines: 4 }] });
    const [paragraph] = harness.blocks;

    paragraph!.style.maxHeight = '20px';
    paragraph!.style.overflow = 'hidden';

    expect(paragraph!.getBoundingClientRect().height).toBe(20);
    expect(paragraph!.scrollHeight).toBe(4 * HARNESS_LINE_HEIGHT_PX);
  });

  it('stubs Range.getClientRects with one rect per modeled line', () => {
    harness = createLayoutHarness({ blocks: [{ type: 'paragraph', lines: 3 }] });
    const [paragraph] = harness.blocks;

    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    const rects = Array.from(range.getClientRects());

    expect(rects).toHaveLength(3);
    expect(rects[0]!.top).toBe(0);
    expect(rects[2]!.bottom).toBe(3 * HARNESS_LINE_HEIGHT_PX);
  });

  it('models list items and their inner paragraphs as separate boxes', () => {
    harness = createLayoutHarness({ blocks: [{ type: 'list', items: [1, 2] }] });
    const items = harness.listItems(0);

    expect(items).toHaveLength(2);
    expect(harness.measuredBottom(items[0]!)).toBe(HARNESS_LINE_HEIGHT_PX);
    expect(harness.measuredTop(items[1]!)).toBe(HARNESS_LINE_HEIGHT_PX);
    expect(harness.lineRectsFor(items[1]!)).toHaveLength(2);
  });

  it('restores document.createRange on destroy', () => {
    const native = document.createRange;
    harness = createLayoutHarness({ blocks: [{ type: 'paragraph', lines: 1 }] });
    expect(document.createRange).not.toBe(native);

    harness.destroy();
    harness = null;

    expect(document.createRange).toBe(native);
  });
});
