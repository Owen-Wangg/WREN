/**
 * Unit tests for textractFormatting.ts — inline formatting inference.
 */
import type { Block } from '@aws-sdk/client-textract';

import { inferInlineFormatting, type PageMetrics } from './textractFormatting';

/** Helper: create a WORD block with geometry. */
function wordBlock(
  text: string,
  opts: { height?: number; width?: number; top?: number; id?: string } = {},
): Block {
  const { height = 0.02, width = 0.05, top = 0.1, id = `word-${Math.random().toString(36).slice(2)}` } = opts;
  return {
    BlockType: 'WORD',
    Id: id,
    Text: text,
    Geometry: {
      BoundingBox: { Height: height, Width: width, Top: top, Left: 0.1 },
      Polygon: [],
    },
  };
}

/** Helper: create a LINE block with geometry. */
function lineBlock(opts: { height?: number; top?: number } = {}): Block {
  const { height = 0.025, top = 0.1 } = opts;
  return {
    BlockType: 'LINE',
    Id: 'line-1',
    Text: 'placeholder',
    Geometry: {
      BoundingBox: { Height: height, Width: 0.8, Top: top, Left: 0.1 },
      Polygon: [],
    },
  };
}

/** Default page metrics for tests. */
const defaultMetrics: PageMetrics = {
  pageNumber: 1,
  medianLineHeight: 0.025,
  medianWordWidth: 0.05,
  medianWordHeight: 0.02,
  baselineLeft: 0.1,
  contentBounds: { left: 0.1, right: 0.9, width: 0.8 },
  indentStep: 0.04,
  lineCount: 20,
};

describe('inferInlineFormatting', () => {
  describe('guard clauses', () => {
    it('returns empty array for no word blocks', () => {
      const result = inferInlineFormatting(lineBlock(), [], defaultMetrics);
      expect(result).toEqual([]);
    });

    it('returns plain text when <50% of words have valid geometry (Req 1.6)', () => {
      const words = [
        wordBlock('hello', { height: 0.02, top: 0.1 }),
        wordBlock('world', { height: undefined as unknown as number, top: undefined as unknown as number }),
        wordBlock('foo', { height: undefined as unknown as number, top: undefined as unknown as number }),
        wordBlock('bar', { height: undefined as unknown as number, top: undefined as unknown as number }),
      ];
      // Only 1 out of 4 has valid geometry = 25% < 50%
      // Override blocks to have no geometry
      words[1].Geometry = undefined;
      words[2].Geometry = undefined;
      words[3].Geometry = undefined;

      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      expect(result.length).toBe(4);
      result.forEach((r) => expect(r.marks).toEqual([]));
    });

    it('skips bold heuristic for lines with <3 words (Req 1.7)', () => {
      // 2 words — one is significantly taller (would be bold with 3+ words)
      const words = [
        wordBlock('Title', { height: 0.03, width: 0.06, top: 0.1 }),
        wordBlock('Here', { height: 0.02, width: 0.05, top: 0.1 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      // No bold marks even though height difference is significant
      const boldMarks = result.flatMap((r) => r.marks.filter((m) => m.type === 'bold'));
      expect(boldMarks).toHaveLength(0);
    });
  });

  describe('bold heuristic', () => {
    it('marks runs as bold when avg height > 1.15× median word height (Req 1.1)', () => {
      // Median height will be 0.02 (three normal words)
      // Bold word has height 0.025 → 0.025 / 0.02 = 1.25 > 1.15
      const words = [
        wordBlock('Normal', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('text', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('here', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('BOLD', { height: 0.025, width: 0.05, top: 0.095 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      // The bold word should be in a separate run (different height) with a bold mark
      const boldRuns = result.filter((r) => r.marks.some((m) => m.type === 'bold'));
      expect(boldRuns.length).toBeGreaterThan(0);
      expect(boldRuns.some((r) => r.text.includes('BOLD'))).toBe(true);
    });

    it('does not mark as bold when height is at or below threshold', () => {
      // All words same height → none are bold
      const words = [
        wordBlock('One', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('Two', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('Three', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('Four', { height: 0.02, width: 0.04, top: 0.1 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      const boldRuns = result.filter((r) => r.marks.some((m) => m.type === 'bold'));
      expect(boldRuns).toHaveLength(0);
    });
  });

  describe('italic heuristic', () => {
    it('marks words with aspect ratio < 0.55× median as italic (Req 1.5)', () => {
      // Normal aspect ratio: 0.05/0.02 = 2.5
      // Italic word: width=0.02, height=0.02 → aspect ratio = 1.0
      // 1.0 < 0.55 × 2.5 = 1.375 → italic
      const words = [
        wordBlock('Normal', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('text', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('here', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('Emphasis', { height: 0.02, width: 0.02, top: 0.1 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      const italicRuns = result.filter((r) => r.marks.some((m) => m.type === 'italic'));
      expect(italicRuns.length).toBeGreaterThan(0);
      expect(italicRuns.some((r) => r.text.includes('Emphasis'))).toBe(true);
    });

    it('does not mark italic when aspect ratio is above threshold', () => {
      const words = [
        wordBlock('One', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('Two', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('Three', { height: 0.02, width: 0.05, top: 0.1 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      const italicRuns = result.filter((r) => r.marks.some((m) => m.type === 'italic'));
      expect(italicRuns).toHaveLength(0);
    });
  });

  describe('font size heuristic', () => {
    it('applies fontSize mark when line height > 1.3× median line height (Req 1.4)', () => {
      // Line height 0.04 > 1.3 × 0.025 = 0.0325
      // fontSize = (0.04 / 0.025) × 16 = 25.6
      const bigLine = lineBlock({ height: 0.04 });
      const words = [
        wordBlock('Big', { height: 0.035, width: 0.08, top: 0.1 }),
        wordBlock('Title', { height: 0.035, width: 0.06, top: 0.1 }),
        wordBlock('Here', { height: 0.035, width: 0.06, top: 0.1 }),
      ];
      const result = inferInlineFormatting(bigLine, words, defaultMetrics);
      const fontSizeRuns = result.filter((r) =>
        r.marks.some((m) => m.type === 'textStyle' && (m.attrs as Record<string, unknown>)?.fontSize),
      );
      expect(fontSizeRuns.length).toBeGreaterThan(0);
      const fontSizeAttr = fontSizeRuns[0].marks.find((m) => m.type === 'textStyle');
      expect((fontSizeAttr?.attrs as Record<string, unknown>)?.fontSize).toBe('25.6pt');
    });

    it('does not apply fontSize when line height is at or below threshold', () => {
      const normalLine = lineBlock({ height: 0.025 });
      const words = [
        wordBlock('Normal', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('text', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('here', { height: 0.02, width: 0.04, top: 0.1 }),
      ];
      const result = inferInlineFormatting(normalLine, words, defaultMetrics);
      const fontSizeRuns = result.filter((r) =>
        r.marks.some((m) => m.type === 'textStyle'),
      );
      expect(fontSizeRuns).toHaveLength(0);
    });
  });

  describe('run grouping', () => {
    it('groups adjacent words with similar height into runs (Req 1.2)', () => {
      // All words have similar height and top → single run
      const words = [
        wordBlock('These', { height: 0.020, width: 0.05, top: 0.100 }),
        wordBlock('words', { height: 0.021, width: 0.05, top: 0.100 }),
        wordBlock('are', { height: 0.020, width: 0.03, top: 0.100 }),
        wordBlock('grouped', { height: 0.020, width: 0.06, top: 0.100 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      // Should produce one run since all are similar
      expect(result.length).toBe(1);
      expect(result[0].text).toBe('These words are grouped');
    });

    it('separates words with significantly different heights into different runs', () => {
      // First three normal, last one much taller → separate run
      const words = [
        wordBlock('Normal', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('text', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('here', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('BIG', { height: 0.03, width: 0.06, top: 0.095 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      // Should have at least 2 runs
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('combined marks', () => {
    it('can apply both bold and fontSize to the same run', () => {
      // Big line + tall words → fontSize + bold
      const bigLine = lineBlock({ height: 0.04 });
      const words = [
        wordBlock('small', { height: 0.015, width: 0.04, top: 0.1 }),
        wordBlock('text', { height: 0.015, width: 0.04, top: 0.1 }),
        wordBlock('here', { height: 0.015, width: 0.04, top: 0.1 }),
        wordBlock('BOLD', { height: 0.025, width: 0.05, top: 0.095 }),
      ];
      const result = inferInlineFormatting(bigLine, words, defaultMetrics);
      // All runs should have textStyle (fontSize) since the line is big
      const allHaveFontSize = result.every((r) =>
        r.marks.some((m) => m.type === 'textStyle'),
      );
      expect(allHaveFontSize).toBe(true);
    });
  });
});
