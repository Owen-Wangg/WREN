/**
 * BlockMeasurer — measures rendered block element heights using the existing DOM.
 *
 * Iterates over top-level children of the editor content element, calls
 * getBoundingClientRect() on each, determines block type from DOM structure,
 * and maintains an internal cache for performance.
 *
 * @see Requirements 2.1, 2.4, 13.2
 */

import type { BlockMeasurement } from './types';

/**
 * Interface for the BlockMeasurer component.
 */
export interface IBlockMeasurer {
  measureAll(): BlockMeasurement[];
  measureRange(startIndex: number, endIndex: number): BlockMeasurement[];
  invalidateFrom(blockIndex: number): void;
}

/**
 * Detects the block type of an HTML element based on its tag name and attributes.
 */
function detectBlockType(
  node: HTMLElement,
): { blockType: BlockMeasurement['blockType']; headingLevel?: number; isPageBreak: boolean } {
  const tagName = node.tagName.toLowerCase();

  // Page break: <hr data-page-break>
  if (tagName === 'hr' && node.hasAttribute('data-page-break')) {
    return { blockType: 'pageBreak', isPageBreak: true };
  }

  // Heading: <h1>–<h6>
  const headingMatch = tagName.match(/^h([1-6])$/);
  if (headingMatch) {
    return {
      blockType: 'heading',
      headingLevel: parseInt(headingMatch[1], 10),
      isPageBreak: false,
    };
  }

  // Paragraph: <p>
  if (tagName === 'p') {
    return { blockType: 'paragraph', isPageBreak: false };
  }

  // List: <ul>, <ol>
  if (tagName === 'ul' || tagName === 'ol') {
    return { blockType: 'list', isPageBreak: false };
  }

  // Table: <table>
  if (tagName === 'table') {
    return { blockType: 'table', isPageBreak: false };
  }

  // Image: <img>, div[data-type="image"], or nodes with class containing 'image'
  if (
    tagName === 'img' ||
    node.getAttribute('data-type') === 'image' ||
    node.className.includes('image')
  ) {
    return { blockType: 'image', isPageBreak: false };
  }

  // Blockquote: <blockquote>
  if (tagName === 'blockquote') {
    return { blockType: 'blockquote', isPageBreak: false };
  }

  // Everything else
  return { blockType: 'other', isPageBreak: false };
}

/**
 * Measures a single block element and returns its BlockMeasurement.
 */
function measureBlock(node: HTMLElement, blockIndex: number): BlockMeasurement {
  const rect = node.getBoundingClientRect();
  const { blockType, headingLevel, isPageBreak } = detectBlockType(node);

  const measurement: BlockMeasurement = {
    blockIndex,
    node,
    height: rect.height,
    isPageBreak,
    blockType,
  };

  if (headingLevel !== undefined) {
    measurement.headingLevel = headingLevel;
  }

  return measurement;
}

/**
 * BlockMeasurer implementation that measures rendered block element heights
 * using getBoundingClientRect() on direct children of the content element.
 */
export class BlockMeasurer implements IBlockMeasurer {
  private readonly contentElement: HTMLElement;
  private cache: Map<number, BlockMeasurement> = new Map();

  /**
   * @param contentElement The editor's content element (e.g. the `.ProseMirror` div)
   *   containing top-level block elements as direct children.
   */
  constructor(contentElement: HTMLElement) {
    this.contentElement = contentElement;
  }

  /**
   * Measures all top-level block elements in the content container.
   * Results are cached for subsequent calls.
   */
  measureAll(): BlockMeasurement[] {
    const children = this.contentElement.children;
    const measurements: BlockMeasurement[] = [];

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      const measurement = measureBlock(child, i);
      this.cache.set(i, measurement);
      measurements.push(measurement);
    }

    return measurements;
  }

  /**
   * Measures only blocks in the given index range [startIndex, endIndex).
   * Useful for incremental measurement after edits.
   *
   * @param startIndex Inclusive start index
   * @param endIndex Exclusive end index
   */
  measureRange(startIndex: number, endIndex: number): BlockMeasurement[] {
    const children = this.contentElement.children;
    const measurements: BlockMeasurement[] = [];

    const clampedStart = Math.max(0, startIndex);
    const clampedEnd = Math.min(children.length, endIndex);

    for (let i = clampedStart; i < clampedEnd; i++) {
      const child = children[i] as HTMLElement;
      const measurement = measureBlock(child, i);
      this.cache.set(i, measurement);
      measurements.push(measurement);
    }

    return measurements;
  }

  /**
   * Clears cached measurements from blockIndex forward.
   * Used when content changes invalidate measurements from a given point.
   *
   * @param blockIndex The index from which to invalidate (inclusive)
   */
  invalidateFrom(blockIndex: number): void {
    const keysToDelete: number[] = [];
    for (const key of this.cache.keys()) {
      if (key >= blockIndex) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}
