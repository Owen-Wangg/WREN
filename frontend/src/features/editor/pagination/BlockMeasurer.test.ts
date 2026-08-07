/**
 * Unit tests for BlockMeasurer.
 *
 * Tests measurement of various block types, cache invalidation,
 * heading level detection, page break detection, and zero-height elements.
 *
 * @see Requirements 2.1, 2.4, 13.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BlockMeasurer } from './BlockMeasurer';

/**
 * Helper: creates a DOM element with a mocked getBoundingClientRect.
 */
function createMockElement(
  tag: string,
  height: number,
  attrs: Record<string, string> = {},
  className = '',
): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  el.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 624,
    height,
    top: 0,
    right: 624,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  });
  return el;
}

describe('BlockMeasurer', () => {
  let contentElement: HTMLElement;

  beforeEach(() => {
    contentElement = document.createElement('div');
    document.body.appendChild(contentElement);
  });

  describe('measureAll()', () => {
    it('returns correct block type for paragraph elements', () => {
      contentElement.appendChild(createMockElement('p', 24));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(1);
      expect(results[0].blockType).toBe('paragraph');
      expect(results[0].blockIndex).toBe(0);
    });

    it('returns correct block type for heading elements (h1-h6)', () => {
      contentElement.appendChild(createMockElement('h1', 48));
      contentElement.appendChild(createMockElement('h2', 40));
      contentElement.appendChild(createMockElement('h3', 36));
      contentElement.appendChild(createMockElement('h4', 32));
      contentElement.appendChild(createMockElement('h5', 28));
      contentElement.appendChild(createMockElement('h6', 24));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(6);
      for (const result of results) {
        expect(result.blockType).toBe('heading');
      }
    });

    it('returns correct block type for list elements (ul, ol)', () => {
      contentElement.appendChild(createMockElement('ul', 100));
      contentElement.appendChild(createMockElement('ol', 120));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(2);
      expect(results[0].blockType).toBe('list');
      expect(results[1].blockType).toBe('list');
    });

    it('returns correct block type for table elements', () => {
      contentElement.appendChild(createMockElement('table', 200));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(1);
      expect(results[0].blockType).toBe('table');
    });

    it('returns correct block type for image elements', () => {
      contentElement.appendChild(createMockElement('img', 300));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(1);
      expect(results[0].blockType).toBe('image');
    });

    it('returns correct block type for div with data-type="image"', () => {
      contentElement.appendChild(
        createMockElement('div', 250, { 'data-type': 'image' }),
      );

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(1);
      expect(results[0].blockType).toBe('image');
    });

    it('returns correct block type for blockquote elements', () => {
      contentElement.appendChild(createMockElement('blockquote', 80));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(1);
      expect(results[0].blockType).toBe('blockquote');
    });

    it('returns correct block type for page break (hr with data-page-break)', () => {
      contentElement.appendChild(
        createMockElement('hr', 2, { 'data-page-break': 'true' }),
      );

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(1);
      expect(results[0].blockType).toBe('pageBreak');
      expect(results[0].isPageBreak).toBe(true);
    });

    it('returns "other" block type for unrecognized elements (div without special attrs)', () => {
      contentElement.appendChild(createMockElement('div', 50));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(1);
      expect(results[0].blockType).toBe('other');
    });

    it('returns height from getBoundingClientRect()', () => {
      contentElement.appendChild(createMockElement('p', 42));
      contentElement.appendChild(createMockElement('h1', 56));
      contentElement.appendChild(createMockElement('ul', 130));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].height).toBe(42);
      expect(results[1].height).toBe(56);
      expect(results[2].height).toBe(130);
    });

    it('includes zero-height elements with height 0', () => {
      contentElement.appendChild(createMockElement('p', 0));
      contentElement.appendChild(createMockElement('p', 24));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results).toHaveLength(2);
      expect(results[0].height).toBe(0);
      expect(results[1].height).toBe(24);
    });
  });

  describe('heading level detection', () => {
    it('detects h1 as headingLevel 1', () => {
      contentElement.appendChild(createMockElement('h1', 48));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].headingLevel).toBe(1);
    });

    it('detects h2 as headingLevel 2', () => {
      contentElement.appendChild(createMockElement('h2', 40));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].headingLevel).toBe(2);
    });

    it('detects h3 as headingLevel 3', () => {
      contentElement.appendChild(createMockElement('h3', 36));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].headingLevel).toBe(3);
    });

    it('detects h4 as headingLevel 4', () => {
      contentElement.appendChild(createMockElement('h4', 32));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].headingLevel).toBe(4);
    });

    it('detects h5 as headingLevel 5', () => {
      contentElement.appendChild(createMockElement('h5', 28));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].headingLevel).toBe(5);
    });

    it('detects h6 as headingLevel 6', () => {
      contentElement.appendChild(createMockElement('h6', 24));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].headingLevel).toBe(6);
    });

    it('does not set headingLevel for non-heading elements', () => {
      contentElement.appendChild(createMockElement('p', 24));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].headingLevel).toBeUndefined();
    });
  });

  describe('page break detection', () => {
    it('detects hr with data-page-break as page break', () => {
      contentElement.appendChild(
        createMockElement('hr', 2, { 'data-page-break': 'true' }),
      );

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].isPageBreak).toBe(true);
      expect(results[0].blockType).toBe('pageBreak');
    });

    it('does not detect hr without data-page-break as page break', () => {
      contentElement.appendChild(createMockElement('hr', 2));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].isPageBreak).toBe(false);
      expect(results[0].blockType).toBe('other');
    });

    it('does not detect non-hr elements with data-page-break as page break', () => {
      contentElement.appendChild(
        createMockElement('div', 50, { 'data-page-break': 'true' }),
      );

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureAll();

      expect(results[0].isPageBreak).toBe(false);
    });
  });

  describe('measureRange(start, end)', () => {
    it('measures only the specified range', () => {
      contentElement.appendChild(createMockElement('p', 20));
      contentElement.appendChild(createMockElement('p', 30));
      contentElement.appendChild(createMockElement('p', 40));
      contentElement.appendChild(createMockElement('p', 50));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureRange(1, 3);

      expect(results).toHaveLength(2);
      expect(results[0].blockIndex).toBe(1);
      expect(results[0].height).toBe(30);
      expect(results[1].blockIndex).toBe(2);
      expect(results[1].height).toBe(40);
    });

    it('clamps start to 0 if negative', () => {
      contentElement.appendChild(createMockElement('p', 20));
      contentElement.appendChild(createMockElement('p', 30));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureRange(-1, 2);

      expect(results).toHaveLength(2);
      expect(results[0].blockIndex).toBe(0);
    });

    it('clamps end to children length', () => {
      contentElement.appendChild(createMockElement('p', 20));
      contentElement.appendChild(createMockElement('p', 30));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureRange(0, 10);

      expect(results).toHaveLength(2);
    });

    it('returns empty array when range is empty', () => {
      contentElement.appendChild(createMockElement('p', 20));

      const measurer = new BlockMeasurer(contentElement);
      const results = measurer.measureRange(1, 1);

      expect(results).toHaveLength(0);
    });
  });

  describe('invalidateFrom(index)', () => {
    it('clears cache entries at and after the given index', () => {
      contentElement.appendChild(createMockElement('p', 20));
      contentElement.appendChild(createMockElement('p', 30));
      contentElement.appendChild(createMockElement('p', 40));

      const measurer = new BlockMeasurer(contentElement);

      // First measurement populates cache
      measurer.measureAll();

      // Now change the height of element at index 1
      const updatedEl = createMockElement('p', 99);
      contentElement.replaceChild(updatedEl, contentElement.children[1]);

      // Invalidate from index 1
      measurer.invalidateFrom(1);

      // Re-measure all — should pick up the new height at index 1
      const results = measurer.measureAll();
      expect(results[0].height).toBe(20); // unchanged
      expect(results[1].height).toBe(99); // updated
      expect(results[2].height).toBe(40); // re-measured
    });

    it('does not clear cache entries before the given index', () => {
      contentElement.appendChild(createMockElement('p', 20));
      contentElement.appendChild(createMockElement('p', 30));
      contentElement.appendChild(createMockElement('p', 40));

      const measurer = new BlockMeasurer(contentElement);
      measurer.measureAll();

      // Invalidate from index 2 (last element only)
      measurer.invalidateFrom(2);

      // The cache for indices 0 and 1 should still exist
      // Re-measuring all should re-measure index 2 from DOM
      const results = measurer.measureAll();
      expect(results).toHaveLength(3);
      expect(results[0].height).toBe(20);
      expect(results[1].height).toBe(30);
      expect(results[2].height).toBe(40);
    });

    it('handles invalidation at index 0 (all entries cleared)', () => {
      contentElement.appendChild(createMockElement('p', 20));
      contentElement.appendChild(createMockElement('p', 30));

      const measurer = new BlockMeasurer(contentElement);
      measurer.measureAll();

      measurer.invalidateFrom(0);

      // All entries should have been cleared; re-measure picks up from DOM
      const results = measurer.measureAll();
      expect(results).toHaveLength(2);
    });

    it('handles invalidation at index beyond cache size', () => {
      contentElement.appendChild(createMockElement('p', 20));

      const measurer = new BlockMeasurer(contentElement);
      measurer.measureAll();

      // No error when invalidating beyond bounds
      measurer.invalidateFrom(100);

      const results = measurer.measureAll();
      expect(results).toHaveLength(1);
      expect(results[0].height).toBe(20);
    });
  });
});
