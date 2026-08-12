/**
 * BlockMeasurer — measures rendered block element heights using the existing DOM.
 *
 * Iterates over top-level children of the editor content element, calls
 * getBoundingClientRect() on each, determines block type from DOM structure,
 * and maintains an internal cache for performance.
 *
 * @see Requirements 2.1, 2.4, 13.2
 */

import type { BlockMeasurement, ItemMeasurement } from './types';
import { ParagraphSplitter } from './ParagraphSplitter';

const paragraphSplitter = new ParagraphSplitter();

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

function readMargin(el: HTMLElement, side: 'top' | 'bottom'): number {
  const value = parseFloat(getComputedStyle(el).getPropertyValue(`margin-${side}`));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Temporarily drop pagination clip/gap styles so measurement sees the
 * natural document flow instead of last frame's injected margins.
 */
function suspendPaginationStyles(node: HTMLElement): () => void {
  const saved: Array<{
    el: HTMLElement;
    maxHeight: string;
    overflow: string;
    marginTop: string;
    marginTopPriority: string;
    marginBottom: string;
    marginBottomPriority: string;
    paddingTop: string;
    paddingTopPriority: string;
  }> = [];

  const track = (el: HTMLElement): void => {
    saved.push({
      el,
      maxHeight: el.style.maxHeight,
      overflow: el.style.overflow,
      marginTop: el.style.getPropertyValue('margin-top'),
      marginTopPriority: el.style.getPropertyPriority('margin-top'),
      marginBottom: el.style.getPropertyValue('margin-bottom'),
      marginBottomPriority: el.style.getPropertyPriority('margin-bottom'),
      paddingTop: el.style.getPropertyValue('padding-top'),
      paddingTopPriority: el.style.getPropertyPriority('padding-top'),
    });
    if (el.style.maxHeight) el.style.maxHeight = '';
    if (el.getAttribute('data-split-clipped')) el.style.overflow = '';
    if (el.hasAttribute('data-pagination-break')) {
      el.style.removeProperty('margin-top');
      el.style.removeProperty('padding-top');
    }
    if (el.getAttribute('data-split-clipped') === 'current') {
      el.style.removeProperty('margin-bottom');
    }
  };

  track(node);
  for (const item of node.querySelectorAll<HTMLElement>(':scope > li')) {
    track(item);
    for (const child of item.querySelectorAll<HTMLElement>(':scope > p')) {
      track(child);
    }
  }

  return () => {
    for (const entry of saved) {
      entry.el.style.maxHeight = entry.maxHeight;
      entry.el.style.overflow = entry.overflow;
      entry.el.style.setProperty('margin-top', entry.marginTop, entry.marginTopPriority);
      entry.el.style.setProperty('margin-bottom', entry.marginBottom, entry.marginBottomPriority);
      entry.el.style.setProperty('padding-top', entry.paddingTop, entry.paddingTopPriority);
    }
  };
}

/**
 * Occupied vertical stride of a block, including collapsed margins to the
 * next sibling. Page-break margins on the next sibling are ignored.
 */
function occupyHeight(node: HTMLElement): number {
  const rect = node.getBoundingClientRect();
  const next = node.nextElementSibling as HTMLElement | null;
  if (next) {
    const saved = next.style.getPropertyValue('margin-top');
    const priority = next.style.getPropertyPriority('margin-top');
    const hadBreak = next.hasAttribute('data-pagination-break');
    if (hadBreak) next.style.removeProperty('margin-top');
    const stride = next.getBoundingClientRect().top - rect.top;
    if (hadBreak) next.style.setProperty('margin-top', saved, priority);
    if (stride > 0) return Math.ceil(stride);
  }
  return Math.ceil(rect.height + readMargin(node, 'bottom'));
}

/**
 * Measures a single block element and returns its BlockMeasurement.
 */
function measureBlock(node: HTMLElement, blockIndex: number): BlockMeasurement {
  const restore = suspendPaginationStyles(node);
  try {
    const { blockType, headingLevel, isPageBreak } = detectBlockType(node);

    const measurement: BlockMeasurement = {
      blockIndex,
      node,
      height: occupyHeight(node),
      isPageBreak,
      blockType,
    };

    if (headingLevel !== undefined) {
      measurement.headingLevel = headingLevel;
    }

    if (blockType === 'list') {
      measurement.items = measureListItems(node);
    }

    if (blockType === 'paragraph') {
      measurement.lines = paragraphSplitter.measureLines(node);
    }

    return measurement;
  } finally {
    restore();
  }
}

function measureListItems(list: HTMLElement): ItemMeasurement[] {
  const listTop = list.getBoundingClientRect().top;
  const items = Array.from(list.querySelectorAll<HTMLElement>(':scope > li'));
  return items.map((item, itemIndex) => {
    const rect = item.getBoundingClientRect();
    const top = rect.top - listTop;
    const next = items[itemIndex + 1];
    const bottom = next
      ? next.getBoundingClientRect().top - listTop
      : top + rect.height + readMargin(item, 'bottom');
    return {
      itemIndex,
      top,
      height: Math.max(0, Math.ceil(bottom - top)),
      bottom: Math.ceil(bottom),
    };
  });
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
