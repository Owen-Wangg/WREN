/**
 * Unit tests for textractFormatting.ts — inline formatting inference.
 */
import type { Block } from '@aws-sdk/client-textract';

import { inferInlineFormatting, needsSpaceBetween, type PageMetrics } from './textractFormatting';

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
    it('does not mark body words bold from OCR word-box height', () => {
      const words = [
        wordBlock('Normal', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('text', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('here', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('BOLD', { height: 0.025, width: 0.05, top: 0.095 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      const boldRuns = result.filter((r) => r.marks.some((m) => m.type === 'bold'));
      expect(boldRuns).toHaveLength(0);
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

    it('does not italicize short words that only look narrow (of/be/it/the)', () => {
      const words = [
        wordBlock('court', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('will', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('of', { height: 0.02, width: 0.015, top: 0.1 }),
        wordBlock('the', { height: 0.02, width: 0.018, top: 0.1 }),
        wordBlock('Premises', { height: 0.02, width: 0.06, top: 0.1 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      const italicText = result
        .filter((r) => r.marks.some((m) => m.type === 'italic'))
        .map((r) => r.text)
        .join(' ');
      expect(italicText).not.toMatch(/\bof\b/);
      expect(italicText).not.toMatch(/\bthe\b/);
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

    it('caps letterhead-sized line boxes so they cannot blow up the page', () => {
      // Height 0.30 vs median 0.025 → raw (0.30/0.025)×16 = 192pt
      const hugeLine = lineBlock({ height: 0.30 });
      const words = [wordBlock('2024', { height: 0.28, width: 0.4, top: 0.4 })];
      const result = inferInlineFormatting(hugeLine, words, defaultMetrics);
      const fontSizeAttr = result[0]?.marks.find((m) => m.type === 'textStyle');
      expect((fontSizeAttr?.attrs as Record<string, unknown>)?.fontSize).toBe('36pt');
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

    it('keeps a space between runs that split on height (no glued words)', () => {
      const words = [
        wordBlock('The', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('Negligence', { height: 0.03, width: 0.08, top: 0.095 }),
        wordBlock('Act', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('speaks', { height: 0.02, width: 0.05, top: 0.1 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      const joined = result.map((r) => r.text).join('');
      expect(joined).toContain('The ');
      expect(joined).toContain('Negligence ');
      expect(joined.replace(/\s+/g, ' ').trim()).toBe('The Negligence Act speaks');
    });

    it('strips scattered per-word bold from OCR height jitter', () => {
      const words = [
        wordBlock('two', { height: 0.02, width: 0.04, top: 0.1 }),
        wordBlock('people', { height: 0.026, width: 0.05, top: 0.097 }),
        wordBlock('are', { height: 0.02, width: 0.03, top: 0.1 }),
        wordBlock('causing', { height: 0.026, width: 0.06, top: 0.097 }),
        wordBlock('the', { height: 0.02, width: 0.03, top: 0.1 }),
        wordBlock('damage', { height: 0.026, width: 0.05, top: 0.097 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      const boldRuns = result.filter((r) => r.marks.some((m) => m.type === 'bold'));
      expect(boldRuns).toHaveLength(0);
      expect(result.map((r) => r.text).join('').replace(/\s+/g, ' ').trim()).toBe(
        'two people are causing the damage',
      );
    });

    it('spaces quoted words instead of gluing of"occupier"under', () => {
      const words = [
        wordBlock('definition', { height: 0.02, width: 0.08, top: 0.1 }),
        wordBlock('of', { height: 0.02, width: 0.02, top: 0.1 }),
        wordBlock('"occupier"', { height: 0.02, width: 0.07, top: 0.1 }),
        wordBlock('under', { height: 0.02, width: 0.05, top: 0.1 }),
        wordBlock('the', { height: 0.02, width: 0.03, top: 0.1 }),
        wordBlock('OLA', { height: 0.02, width: 0.04, top: 0.1 }),
      ];
      const result = inferInlineFormatting(lineBlock(), words, defaultMetrics);
      const joined = result.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
      expect(joined).toBe('definition of "occupier" under the OLA');
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
    it('still applies fontSize on a large line without inferring bold from height', () => {
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

describe('needsSpaceBetween', () => {
  it('puts spaces outside a quoted word but not inside', () => {
    expect(needsSpaceBetween('of', '"occupier"')).toBe(true);
    expect(needsSpaceBetween('"occupier"', 'under')).toBe(true);
    expect(needsSpaceBetween('"', 'occupier')).toBe(false);
    expect(needsSpaceBetween('occupier', '"')).toBe(false);
  });

  it('keeps commas glued and contractions unspaced', () => {
    expect(needsSpaceBetween('liable', ',')).toBe(false);
    expect(needsSpaceBetween('Kato', "'s")).toBe(false);
  });
});
