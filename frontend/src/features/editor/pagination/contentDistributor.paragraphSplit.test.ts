/**
 * Unit tests for ContentDistributor paragraph splitting integration.
 *
 * Tests that when enableParagraphSplitting is true and a paragraph block
 * has pre-measured line data, the distributor splits the paragraph at line
 * boundaries respecting orphan/widow constraints.
 *
 * @see Requirements 3.1, 3.6
 */

import { describe, it, expect } from 'vitest';
import { ContentDistributor } from './ContentDistributor';
import type { BlockMeasurement, DistributionOptions, LineMeasurement } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLines(lineHeights: number[]): LineMeasurement[] {
  let top = 0;
  return lineHeights.map((h, i) => {
    const line: LineMeasurement = {
      lineIndex: i,
      top,
      height: h,
      bottom: top + h,
    };
    top += h;
    return line;
  });
}

function makeParagraphBlock(
  blockIndex: number,
  lines: LineMeasurement[],
): BlockMeasurement {
  const height = lines.length > 0 ? lines[lines.length - 1].bottom : 0;
  return {
    blockIndex,
    node: document.createElement('p'),
    height,
    isPageBreak: false,
    blockType: 'paragraph',
    lines,
  };
}

function makeSimpleBlock(blockIndex: number, height: number): BlockMeasurement {
  return {
    blockIndex,
    node: document.createElement('div'),
    height,
    isPageBreak: false,
    blockType: 'other',
  };
}

const baseOptions: DistributionOptions = {
  usablePageHeight: 864,
  headerHeight: 0,
  footerHeight: 0,
  orphanLines: 2,
  widowLines: 2,
  enableParagraphSplitting: true,
  enableKeepWithNext: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentDistributor — Paragraph Splitting Integration', () => {
  const distributor = new ContentDistributor();

  describe('enableParagraphSplitting option', () => {
    it('splits a paragraph that overflows the current page at a valid line boundary', () => {
      // Page height is 200. First block takes 100. Paragraph has 6 lines of 30px each (180 total).
      // Remaining = 100. Lines that fit: 3 (bottom = 90 ≤ 100). Orphan=2, widow=2.
      // 3 lines on current page (orphan satisfied), 3 lines on next page (widow satisfied).
      const options: DistributionOptions = { ...baseOptions, usablePageHeight: 200 };
      const lines = makeLines([30, 30, 30, 30, 30, 30]);
      const measurements: BlockMeasurement[] = [
        makeSimpleBlock(0, 100),
        makeParagraphBlock(1, lines),
      ];

      const pages = distributor.distribute(measurements, options);

      // First page should have block 0 and the first portion of block 1
      expect(pages.length).toBe(2);
      expect(pages[0].blocks.length).toBe(2);
      expect(pages[0].blocks[0].blockIndex).toBe(0);
      expect(pages[0].blocks[1].blockIndex).toBe(1);
      expect(pages[0].blocks[1].split).toBeDefined();
      expect(pages[0].blocks[1].split!.type).toBe('paragraph');
      expect(pages[0].blocks[1].split!.splitAtLine).toBe(2); // lines 0,1,2 on current page
      expect(pages[0].blocks[1].split!.continuationPageIndex).toBe(1);
      expect(pages[0].blocks[1].split!.clipHeightPx).toBe(90);
      expect(pages[0].blocks[1].split!.blockIndex).toBe(1);

      // Second page has continuation
      expect(pages[1].blocks.length).toBe(1);
      expect(pages[1].blocks[0].blockIndex).toBe(1);
    });

    it('moves the entire paragraph to the next page when fallback is move-whole', () => {
      // Page height 100. First block 80. Paragraph has 3 lines of 20px each (60 total).
      // Remaining = 20. Fitting lines = 1 (bottom=20 ≤ 20). Orphan=2 not met.
      // 3 lines total ≤ 3 and orphan can't be satisfied → move-whole.
      const options: DistributionOptions = { ...baseOptions, usablePageHeight: 100 };
      const lines = makeLines([20, 20, 20]);
      const measurements: BlockMeasurement[] = [
        makeSimpleBlock(0, 80),
        makeParagraphBlock(1, lines),
      ];

      const pages = distributor.distribute(measurements, options);

      expect(pages.length).toBe(2);
      expect(pages[0].blocks.length).toBe(1);
      expect(pages[0].blocks[0].blockIndex).toBe(0);
      expect(pages[1].blocks.length).toBe(1);
      expect(pages[1].blocks[0].blockIndex).toBe(1);
      expect(pages[1].blocks[0].split).toBeUndefined();
    });

    it('handles multi-page paragraphs spanning 3+ pages via recursive splitting', () => {
      // Page height = 100. Paragraph has 15 lines of 30px each (450 total).
      // Page 1: lines that fit = 3 (bottom 90 ≤ 100), orphan=2 ok, widow check (15-3=12 ≥ 2) ok → split at line 2.
      // Page 2: remaining 12 lines rebased. 12*30=360. Lines fitting: 3 (bottom 90 ≤ 100). → split at line 2.
      // Page 3: remaining 9 lines. Lines fitting: 3 → split at line 2.
      // Page 4: remaining 6 lines. Lines fitting: 3 → split at line 2.
      // Page 5: remaining 3 lines. 3*30=90 ≤ 100. Fits on one page.
      const options: DistributionOptions = { ...baseOptions, usablePageHeight: 100 };
      const lines = makeLines(Array(15).fill(30));
      const measurements: BlockMeasurement[] = [makeParagraphBlock(0, lines)];

      const pages = distributor.distribute(measurements, options);

      expect(pages.length).toBe(5);

      // Each page except the last should have a split
      for (let i = 0; i < 4; i++) {
        expect(pages[i].blocks[0].blockIndex).toBe(0);
        expect(pages[i].blocks[0].split).toBeDefined();
        expect(pages[i].blocks[0].split!.type).toBe('paragraph');
      }

      // Last page has no split (continuation ends there)
      expect(pages[4].blocks[0].blockIndex).toBe(0);
      // The last page doesn't need split info since all remaining lines fit
      expect(pages[4].blocks[0].split).toBeUndefined();
    });

    it('does not split paragraphs when enableParagraphSplitting is false', () => {
      const options: DistributionOptions = {
        ...baseOptions,
        enableParagraphSplitting: false,
        usablePageHeight: 200,
      };
      const lines = makeLines([30, 30, 30, 30, 30, 30]);
      const measurements: BlockMeasurement[] = [
        makeSimpleBlock(0, 100),
        makeParagraphBlock(1, lines),
      ];

      const pages = distributor.distribute(measurements, options);

      // Paragraph should be moved whole to the next page
      expect(pages.length).toBe(2);
      expect(pages[0].blocks.length).toBe(1);
      expect(pages[0].blocks[0].blockIndex).toBe(0);
      expect(pages[1].blocks.length).toBe(1);
      expect(pages[1].blocks[0].blockIndex).toBe(1);
      expect(pages[1].blocks[0].split).toBeUndefined();
    });

    it('does not split paragraphs without line data even when enableParagraphSplitting is true', () => {
      const options: DistributionOptions = { ...baseOptions, usablePageHeight: 200 };
      const measurements: BlockMeasurement[] = [
        makeSimpleBlock(0, 100),
        {
          blockIndex: 1,
          node: document.createElement('p'),
          height: 180,
          isPageBreak: false,
          blockType: 'paragraph',
          // No lines field
        },
      ];

      const pages = distributor.distribute(measurements, options);

      // Without line data, paragraph moves whole to next page
      expect(pages.length).toBe(2);
      expect(pages[1].blocks[0].blockIndex).toBe(1);
      expect(pages[1].blocks[0].split).toBeUndefined();
    });

    it('records SplitInfo with correct type and splitAtLine', () => {
      // 10 lines of 20px = 200px total. Page height 120, no prior content.
      // Fitting lines: 6 (bottom 120 ≤ 120). Orphan=2 ok. Remaining=4 ≥ widow=2.
      const options: DistributionOptions = { ...baseOptions, usablePageHeight: 120 };
      const lines = makeLines(Array(10).fill(20));
      const measurements: BlockMeasurement[] = [makeParagraphBlock(0, lines)];

      const pages = distributor.distribute(measurements, options);

      expect(pages.length).toBe(2);
      const split = pages[0].blocks[0].split;
      expect(split).toBeDefined();
      expect(split!.type).toBe('paragraph');
      expect(split!.splitAtLine).toBe(5); // 6 lines fit (indices 0-5)
      expect(split!.continuationPageIndex).toBe(1);
    });

    it('handles oversized paragraph with waive-orphan fallback', () => {
      // Page height = 60. Paragraph has 10 lines of 20px each (200 total).
      // It's oversized (200 > 60). No prior content. Remaining = 60.
      // Fitting lines: 3 (bottom 60 ≤ 60). Orphan=2 ok. Remaining=7≥2 ok.
      // Actually, this case fits normal split at line 2.
      // For waive-orphan to trigger, we need fitting < orphanMin on a full page.
      // With page height 30 and 10 lines of 20: fitting=1. Orphan=2 not met.
      // totalLines=10 > 3 and isOversized → waive-orphan.
      // splitAfterLine = 10 - 2 - 1 = 7. Lines 0-7 on current page.
      const options: DistributionOptions = { ...baseOptions, usablePageHeight: 30 };
      const lines = makeLines(Array(10).fill(20));
      const measurements: BlockMeasurement[] = [makeParagraphBlock(0, lines)];

      const pages = distributor.distribute(measurements, options);

      // The paragraph should be split (waive-orphan)
      expect(pages.length).toBeGreaterThanOrEqual(2);
      // First page should have a split
      expect(pages[0].blocks[0].split).toBeDefined();
      expect(pages[0].blocks[0].split!.type).toBe('paragraph');
    });
  });
});
