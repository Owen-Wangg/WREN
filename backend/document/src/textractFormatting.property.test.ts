// Feature: scanned-pdf-reconstruction, Property 1: Bold formatting inference
/**
 * Property-based test for bold formatting inference.
 *
 * **Validates: Requirements 1.1, 1.2**
 *
 * Word-box height is not font-weight. Mixed OCR box heights SHALL NOT
 * receive bold marks. Isolated italic on short tokens is also suppressed.
 */
import fc from 'fast-check';
import type { Block } from '@aws-sdk/client-textract';
import { inferInlineFormatting, type PageMetrics } from './textractFormatting';

const MIN_RUNS = 100;

/** Default page metrics — uses values that won't trigger fontSize marks. */
function defaultPageMetrics(): PageMetrics {
  return {
    pageNumber: 1,
    medianLineHeight: 0.025,
    medianWordWidth: 0.05,
    medianWordHeight: 0.02,
    baselineLeft: 0.1,
    contentBounds: { left: 0.1, right: 0.9, width: 0.8 },
    indentStep: 0.04,
    lineCount: 20,
  };
}

/** Default LINE block that won't trigger fontSize (height at or below 1.3× medianLineHeight). */
function defaultLineBlock(): Block {
  return {
    BlockType: 'LINE',
    Id: 'line-prop',
    Geometry: {
      BoundingBox: { Height: 0.025, Width: 0.8, Top: 0.1, Left: 0.1 },
      Polygon: [],
    },
  };
}

/** Create a WORD block with specific geometry. */
function makeWordBlock(text: string, height: number, top: number, width = 0.05): Block {
  return {
    BlockType: 'WORD',
    Id: `word-${text}-${Math.random().toString(36).slice(2, 8)}`,
    Text: text,
    Geometry: {
      BoundingBox: { Height: height, Width: width, Top: top, Left: 0.1 },
      Polygon: [],
    },
  };
}

/** Create a WORD block with no valid geometry (no BoundingBox). */
function makeInvalidWordBlock(text: string): Block {
  return {
    BlockType: 'WORD',
    Id: `word-invalid-${Math.random().toString(36).slice(2, 8)}`,
    Text: text,
  };
}

/** Compute median of a numeric array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Arbitrary: generates an array of 3+ WORD blocks with valid geometry.
 * All words share the same Top and have a "base" height (the median),
 * with a subset of words intentionally made taller (potential bold) or kept at base height.
 */
/**
 * Arbitrary: 3+ WORD blocks with a *contiguous* tall span (not scattered
 * per-word flags — scatter is treated as OCR noise and stripped).
 */
const validWordBlocksArb: fc.Arbitrary<Block[]> = fc
  .tuple(
    fc.integer({ min: 3, max: 12 }), // total word count (≥3 for bold heuristic)
    fc.double({ min: 0.015, max: 0.04, noNaN: true }), // base height
    fc.double({ min: 0.05, max: 0.3, noNaN: true }), // top position
    fc.integer({ min: 0, max: 4 }), // contiguous tall run length
    fc.double({ min: 1.20, max: 1.8, noNaN: true }), // tall multiplier
  )
  .map(([count, baseHeight, top, tallLenRaw, tallMultiplier]) => {
    const tallLen = Math.min(tallLenRaw, count);
    const tallStart = tallLen === 0 ? 0 : Math.min(count - tallLen, Math.floor(count / 3));
    const words: Block[] = [];
    for (let i = 0; i < count; i++) {
      const isTall = i >= tallStart && i < tallStart + tallLen;
      const height = isTall ? baseHeight * tallMultiplier : baseHeight;
      words.push(makeWordBlock(`w${i}`, height, top));
    }
    return words;
  });

/**
 * Arbitrary: generates words where ALL have the same height (no bold expected).
 */
const uniformHeightWordsArb: fc.Arbitrary<Block[]> = fc
  .tuple(
    fc.integer({ min: 3, max: 10 }),
    fc.double({ min: 0.015, max: 0.04, noNaN: true }), // uniform height
    fc.double({ min: 0.05, max: 0.3, noNaN: true }), // top
  )
  .map(([count, height, top]) => {
    const words: Block[] = [];
    for (let i = 0; i < count; i++) {
      words.push(makeWordBlock(`u${i}`, height, top));
    }
    return words;
  });

/**
 * Arbitrary: generates words with fewer than 3 items (bold should be skipped).
 */
const fewWordsArb: fc.Arbitrary<Block[]> = fc
  .tuple(
    fc.integer({ min: 1, max: 2 }),
    fc.double({ min: 0.015, max: 0.04, noNaN: true }),
    fc.double({ min: 0.05, max: 0.3, noNaN: true }),
    fc.double({ min: 1.2, max: 2.0, noNaN: true }),
  )
  .map(([count, baseHeight, top, tallMultiplier]) => {
    const words: Block[] = [];
    for (let i = 0; i < count; i++) {
      // Make first word tall to test that bold is NOT applied despite height
      const height = i === 0 ? baseHeight * tallMultiplier : baseHeight;
      words.push(makeWordBlock(`few${i}`, height, top));
    }
    return words;
  });

describe('Property 1: Bold is not inferred from OCR word height', () => {
  it('mixed word-box heights do not produce bold marks', () => {
    fc.assert(
      fc.property(validWordBlocksArb, (wordBlocks) => {
        const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());
        const boldRuns = result.filter((r) => r.marks.some((m) => m.type === 'bold'));
        expect(boldRuns).toHaveLength(0);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('no bold marks when all words have uniform height (Req 1.1)', () => {
    fc.assert(
      fc.property(uniformHeightWordsArb, (wordBlocks) => {
        const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());

        // When all words have the same height, the median equals that height,
        // and no run can exceed 1.15× median → no bold marks
        const boldRuns = result.filter((r) => r.marks.some((m) => m.type === 'bold'));
        expect(boldRuns).toHaveLength(0);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('no bold marks when line has fewer than 3 words regardless of height differences (Req 1.7)', () => {
    fc.assert(
      fc.property(fewWordsArb, (wordBlocks) => {
        const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());

        // With <3 words, bold heuristic is skipped entirely
        const boldRuns = result.filter((r) => r.marks.some((m) => m.type === 'bold'));
        expect(boldRuns).toHaveLength(0);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('no marks at all when <50% of words have valid geometry (Req 1.6)', () => {
    // Generate 3+ words where majority lack geometry
    const invalidMajorityArb = fc
      .tuple(
        fc.integer({ min: 3, max: 8 }),
        fc.double({ min: 0.015, max: 0.04, noNaN: true }),
        fc.double({ min: 0.05, max: 0.3, noNaN: true }),
      )
      .map(([count, height, top]) => {
        const words: Block[] = [];
        // Only first word has valid geometry — rest don't (< 50%)
        words.push(makeWordBlock('valid', height * 1.5, top));
        for (let i = 1; i < count; i++) {
          words.push(makeInvalidWordBlock(`inv${i}`));
        }
        return words;
      });

    fc.assert(
      fc.property(invalidMajorityArb, (wordBlocks) => {
        const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());

        // All runs should have empty marks (plain text)
        for (const run of result) {
          expect(run.marks).toEqual([]);
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('words grouped into runs by vertical proximity: same-top same-height words form a single run (Req 1.2)', () => {
    // Generate words that should all be in one run (same top, same height)
    const sameRunWordsArb = fc
      .tuple(
        fc.integer({ min: 3, max: 8 }),
        fc.double({ min: 0.015, max: 0.04, noNaN: true }),
        fc.double({ min: 0.05, max: 0.3, noNaN: true }),
      )
      .map(([count, height, top]) => {
        const words: Block[] = [];
        for (let i = 0; i < count; i++) {
          words.push(makeWordBlock(`grp${i}`, height, top));
        }
        return words;
      });

    fc.assert(
      fc.property(sameRunWordsArb, (wordBlocks) => {
        const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());

        // All words have same height and top → they should form a single run
        // The result should contain only one entry with all word texts joined
        const allText = wordBlocks.map((b) => b.Text!).join(' ');
        expect(result.length).toBe(1);
        expect(result[0].text).toBe(allText);
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('taller OCR word boxes still do not receive bold marks', () => {
    const splitRunArb = fc
      .tuple(
        fc.integer({ min: 3, max: 6 }),
        fc.double({ min: 0.015, max: 0.03, noNaN: true }),
        fc.double({ min: 0.05, max: 0.3, noNaN: true }),
        fc.double({ min: 1.25, max: 2.0, noNaN: true }),
      )
      .map(([normalCount, baseHeight, top, tallMultiplier]) => {
        const words: Block[] = [];
        for (let i = 0; i < normalCount; i++) {
          words.push(makeWordBlock(`n${i}`, baseHeight, top));
        }
        words.push(makeWordBlock('BOLD', baseHeight * tallMultiplier, top));
        return words;
      });

    fc.assert(
      fc.property(splitRunArb, (words) => {
        const result = inferInlineFormatting(defaultLineBlock(), words, defaultPageMetrics());
        expect(result.filter((r) => r.marks.some((m) => m.type === 'bold'))).toHaveLength(0);
      }),
      { numRuns: MIN_RUNS },
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Feature: scanned-pdf-reconstruction, Property 3: Font size mark application
//
// **Validates: Requirements 1.4**
//
// For any set of LINE blocks within a layout element, lines whose bounding box
// height exceeds 1.3× the median line height of that element SHALL have a
// fontSize textStyle mark with value equal to (lineHeight / medianHeight) × 16,
// and lines at or below 1.3× SHALL have no fontSize mark.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 3: Font size mark application', () => {
  const FONT_SIZE_LINE_HEIGHT_RATIO = 1.3;
  const BASE_FONT_SIZE = 16;

  /** Create a LINE block with specific height. */
  function makeLineBlock(lineHeight: number): Block {
    return {
      BlockType: 'LINE',
      Id: `line-fs-${Math.random().toString(36).slice(2, 8)}`,
      Geometry: {
        BoundingBox: { Height: lineHeight, Width: 0.8, Top: 0.1, Left: 0.1 },
        Polygon: [],
      },
    };
  }

  /**
   * Arbitrary: a scenario with a medianLineHeight and a line height factor.
   * Words are uniform height/top to avoid bold/italic interference and stay in one run.
   */
  const fontSizeScenarioArb = fc
    .record({
      medianLineHeight: fc.double({ min: 0.01, max: 0.08, noNaN: true }),
      /** Factor relative to median: determines whether font size mark applies. */
      heightFactor: fc.double({ min: 0.5, max: 3.0, noNaN: true }),
      wordCount: fc.integer({ min: 3, max: 8 }),
      wordHeight: fc.double({ min: 0.008, max: 0.03, noNaN: true }),
    })
    .filter(
      (s) =>
        s.medianLineHeight > 0 &&
        s.heightFactor > 0 &&
        s.wordHeight > 0 &&
        s.medianLineHeight * s.heightFactor > 0,
    );

  it('lines with height > 1.3× median get fontSize mark; lines at or below do NOT (Req 1.4)', () => {
    fc.assert(
      fc.property(fontSizeScenarioArb, (scenario) => {
        const { medianLineHeight, heightFactor, wordCount, wordHeight } = scenario;
        const lineHeight = medianLineHeight * heightFactor;

        // Build a LINE block with the computed height
        const lineBlock = makeLineBlock(lineHeight);

        // Build WORD blocks with uniform height and wide width (avoid italic)
        const wordBlocks = Array.from({ length: wordCount }, (_, i) =>
          makeWordBlock(`fs${i}`, wordHeight, 0.1, 0.06),
        );

        // Page metrics with the specified median line height
        const metrics: PageMetrics = {
          pageNumber: 1,
          medianLineHeight,
          medianWordWidth: 0.06,
          medianWordHeight: wordHeight,
          baselineLeft: 0.1,
          contentBounds: { left: 0.1, right: 0.9, width: 0.8 },
          indentStep: 0.04,
          lineCount: 20,
        };

        const result = inferInlineFormatting(lineBlock, wordBlocks, metrics);

        const exceedsThreshold = lineHeight > FONT_SIZE_LINE_HEIGHT_RATIO * medianLineHeight;

        if (exceedsThreshold) {
          // All runs MUST have a textStyle mark with fontSize
          const expectedFontSize = Math.min(
            (lineHeight / medianLineHeight) * BASE_FONT_SIZE,
            36,
          );

          for (const run of result) {
            const textStyleMark = run.marks.find((m) => m.type === 'textStyle');
            expect(textStyleMark).toBeDefined();
            expect(textStyleMark!.attrs).toBeDefined();
            expect(typeof textStyleMark!.attrs!.fontSize).toBe('string');
            expect(String(textStyleMark!.attrs!.fontSize)).toMatch(/pt$/);
            expect(
              Math.abs(parseFloat(String(textStyleMark!.attrs!.fontSize)) - expectedFontSize),
            ).toBeLessThan(0.05);
          }
        } else {
          // No run should have a textStyle mark with fontSize
          for (const run of result) {
            const textStyleMark = run.marks.find((m) => m.type === 'textStyle');
            if (textStyleMark) {
              expect(textStyleMark.attrs).toBeUndefined();
            }
          }
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('lines at exactly 1.3× median height do NOT receive fontSize mark (threshold is strict >)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.08, noNaN: true }),
        fc.integer({ min: 3, max: 6 }),
        (medianLineHeight, wordCount) => {
          // Line height exactly at the threshold: 1.3 × median
          const lineHeight = FONT_SIZE_LINE_HEIGHT_RATIO * medianLineHeight;

          const lineBlock = makeLineBlock(lineHeight);
          const wordBlocks = Array.from({ length: wordCount }, (_, i) =>
            makeWordBlock(`ex${i}`, 0.015, 0.1, 0.06),
          );

          const metrics: PageMetrics = {
            pageNumber: 1,
            medianLineHeight,
            medianWordWidth: 0.06,
            medianWordHeight: 0.015,
            baselineLeft: 0.1,
            contentBounds: { left: 0.1, right: 0.9, width: 0.8 },
            indentStep: 0.04,
            lineCount: 20,
          };

          const result = inferInlineFormatting(lineBlock, wordBlocks, metrics);

          // At exactly 1.3×, "exceeds" is strict > — no fontSize mark
          for (const run of result) {
            const textStyleMark = run.marks.find((m) => m.type === 'textStyle');
            if (textStyleMark) {
              expect(textStyleMark.attrs).toBeUndefined();
            }
          }
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('fontSize value is exactly (lineHeight / medianLineHeight) × 16 (Req 1.4)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.08, noNaN: true }),
        // Factor guaranteed above threshold
        fc.double({ min: 1.31, max: 3.0, noNaN: true }),
        fc.integer({ min: 3, max: 6 }),
        (medianLineHeight, heightFactor, wordCount) => {
          const lineHeight = medianLineHeight * heightFactor;

          const lineBlock = makeLineBlock(lineHeight);
          const wordBlocks = Array.from({ length: wordCount }, (_, i) =>
            makeWordBlock(`val${i}`, 0.015, 0.1, 0.06),
          );

          const metrics: PageMetrics = {
            pageNumber: 1,
            medianLineHeight,
            medianWordWidth: 0.06,
            medianWordHeight: 0.015,
            baselineLeft: 0.1,
            contentBounds: { left: 0.1, right: 0.9, width: 0.8 },
            indentStep: 0.04,
            lineCount: 20,
          };

          const result = inferInlineFormatting(lineBlock, wordBlocks, metrics);
          const expectedFontSize = Math.min(
            (lineHeight / medianLineHeight) * BASE_FONT_SIZE,
            36,
          );

          // Since heightFactor > 1.3, all runs must have fontSize
          for (const run of result) {
            const textStyleMark = run.marks.find((m) => m.type === 'textStyle');
            expect(textStyleMark).toBeDefined();
            expect(textStyleMark!.attrs).toBeDefined();
            const actualFontSize = parseFloat(String(textStyleMark!.attrs!.fontSize));
            expect(String(textStyleMark!.attrs!.fontSize)).toMatch(/pt$/);
            expect(Math.abs(actualFontSize - expectedFontSize)).toBeLessThan(0.05);
          }
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('no fontSize mark when medianLineHeight is zero (cannot compute ratio)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 0.1, noNaN: true }),
        fc.integer({ min: 3, max: 6 }),
        (lineHeight, wordCount) => {
          const lineBlock = makeLineBlock(lineHeight);
          const wordBlocks = Array.from({ length: wordCount }, (_, i) =>
            makeWordBlock(`z${i}`, 0.015, 0.1, 0.06),
          );

          // medianLineHeight = 0 means ratio cannot be computed → no fontSize mark
          const metrics: PageMetrics = {
            pageNumber: 1,
            medianLineHeight: 0,
            medianWordWidth: 0.06,
            medianWordHeight: 0.015,
            baselineLeft: 0.1,
            contentBounds: { left: 0.1, right: 0.9, width: 0.8 },
            indentStep: 0.04,
            lineCount: 20,
          };

          const result = inferInlineFormatting(lineBlock, wordBlocks, metrics);

          // No fontSize marks should be applied
          for (const run of result) {
            const textStyleMark = run.marks.find((m) => m.type === 'textStyle');
            if (textStyleMark) {
              expect(textStyleMark.attrs).toBeUndefined();
            }
          }
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Feature: scanned-pdf-reconstruction, Property 4: Italic formatting inference
//
// **Validates: Requirements 1.5**
//
// For any LINE block with 3+ WORD blocks with valid geometry, words whose
// width-to-height aspect ratio is below 0.55× the median aspect ratio of
// sibling words on the same LINE SHALL receive italic marks, and words at or
// above the threshold SHALL not receive italic marks.
// ─────────────────────────────────────────────────────────────────────────────

describe('Property 4: Italic formatting inference', () => {
  const ITALIC_ASPECT_RATIO = 0.55;

  /**
   * Arbitrary: generates a LINE with 3+ words at the same height/top
   * (so they form a single run and avoid bold interference).
   * Each word is either "narrow" (italic candidate) or "normal" based on aspect ratio.
   *
   * Strategy:
   * - Fix a constant height for all words so aspect ratio = width / height.
   * - Normal words get widths yielding AR around a reference value.
   * - Narrow words get widths yielding AR well below 0.55× the reference.
   * - Because the majority of words are "normal", the median AR sits at normalAR,
   *   and narrow words reliably fall below 0.55× median.
   */
  const italicLineArb = fc
    .record({
      baseHeight: fc.double({ min: 0.012, max: 0.03, noNaN: true }),
      normalAR: fc.double({ min: 1.5, max: 3.5, noNaN: true }),
      wordCount: fc.integer({ min: 3, max: 10 }),
    })
    .chain(({ baseHeight, normalAR, wordCount }) => {
      // Ensure a majority of normal words so the median AR clusters around normalAR
      const minNormal = Math.max(Math.ceil(wordCount / 2) + 1, 2);
      return fc
        .tuple(
          // Number of normal words (majority)
          fc.integer({ min: minNormal, max: wordCount }),
          // Narrow factor: word AR = narrowFactor × normalAR; well below 0.55 threshold
          fc.double({ min: 0.10, max: 0.45, noNaN: true }),
        )
        .map(([normalCount, narrowFactor]) => {
          const narrowCount = wordCount - normalCount;
          const words: Array<{
            text: string;
            width: number;
            height: number;
            top: number;
            isNarrow: boolean;
          }> = [];

          // Normal words
          for (let i = 0; i < normalCount; i++) {
            const width = normalAR * baseHeight;
            words.push({
              text: `norm${i}`,
              width,
              height: baseHeight,
              top: 0.1,
              isNarrow: false,
            });
          }

          // Narrow words (italic candidates)
          for (let i = 0; i < narrowCount; i++) {
            const width = normalAR * narrowFactor * baseHeight;
            words.push({
              text: `narr${i}`,
              width,
              height: baseHeight,
              top: 0.1,
              isNarrow: true,
            });
          }

          return { baseHeight, normalAR, narrowFactor, words };
        });
    });

  it('words with AR < 0.55× median get italic; words at or above do NOT (Req 1.5)', () => {
    fc.assert(
      fc.property(italicLineArb, ({ words }) => {
        const wordBlocks = words.map((w) =>
          makeWordBlock(w.text, w.height, w.top, w.width),
        );
        const lineBlock = defaultLineBlock();
        const metrics = defaultPageMetrics();

        const result = inferInlineFormatting(lineBlock, wordBlocks, metrics);

        // Compute expected median aspect ratio (same logic as implementation)
        const aspectRatios = words
          .filter((w) => w.height > 0 && w.width > 0)
          .map((w) => w.width / w.height);

        if (aspectRatios.length === 0) return;
        const medianAR = median(aspectRatios);
        if (medianAR <= 0) return;

        const threshold = ITALIC_ASPECT_RATIO * medianAR;

        // Flatten result runs to per-word italic status
        const perWord: Array<{ text: string; hasItalic: boolean }> = [];
        for (const run of result) {
          const hasItalic = run.marks.some((m) => m.type === 'italic');
          for (const w of run.text.split(/\s+/).filter(Boolean)) {
            perWord.push({ text: w, hasItalic });
          }
        }

        // Verify each word's italic status matches expectation
        for (const spec of words) {
          const ar = spec.width / spec.height;
          const expectedItalic = ar < threshold;

          const entry = perWord.find((p) => p.text === spec.text);
          if (!entry) continue;

          expect(entry.hasItalic).toBe(expectedItalic);
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });

  it('no italic marks when all words have zero width (median AR is zero)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        fc.double({ min: 0.012, max: 0.03, noNaN: true }),
        (wordCount, baseHeight) => {
          // All words have width = 0 → aspect ratio = 0 → median AR = 0 → no italic
          const wordBlocks = Array.from({ length: wordCount }, (_, i) =>
            makeWordBlock(`zw${i}`, baseHeight, 0.1, 0),
          );
          const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());

          // No run should have italic marks
          for (const run of result) {
            expect(run.marks.some((m) => m.type === 'italic')).toBe(false);
          }
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('words with AR above 0.55× median do NOT receive italic marks (Req 1.5)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.012, max: 0.03, noNaN: true }),
        fc.double({ min: 1.5, max: 3.0, noNaN: true }),
        (baseHeight, normalAR) => {
          // Create 4 "normal" words at normalAR and 1 word at 0.60× normalAR
          // Median AR of 5 words (4 at normalAR + 1 at 0.60×normalAR) = normalAR
          // Threshold = 0.55 × normalAR
          // Test word AR ≈ 0.60 × normalAR > 0.55 × normalAR → NOT italic
          const normalWidth = normalAR * baseHeight;
          const aboveThresholdWidth = 0.60 * normalAR * baseHeight;

          const wordBlocks = [
            makeWordBlock('n0', baseHeight, 0.1, normalWidth),
            makeWordBlock('n1', baseHeight, 0.1, normalWidth),
            makeWordBlock('n2', baseHeight, 0.1, normalWidth),
            makeWordBlock('n3', baseHeight, 0.1, normalWidth),
            makeWordBlock('above', baseHeight, 0.1, aboveThresholdWidth),
          ];
          const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());

          // Flatten to per-word italic status
          const perWord: Array<{ text: string; hasItalic: boolean }> = [];
          for (const run of result) {
            const hasItalic = run.marks.some((m) => m.type === 'italic');
            for (const w of run.text.split(/\s+/).filter(Boolean)) {
              perWord.push({ text: w, hasItalic });
            }
          }

          // The "above" word has AR ≈ 0.60 × normalAR ≥ 0.55 × normalAR → NOT italic
          const entry = perWord.find((p) => p.text === 'above');
          if (!entry) return;
          expect(entry.hasItalic).toBe(false);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('italic heuristic still applies when line has <3 words (only bold is skipped for <3)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.012, max: 0.03, noNaN: true }),
        fc.double({ min: 1.5, max: 3.0, noNaN: true }),
        (baseHeight, normalAR) => {
          // Create 2 words: one normal, one very narrow (italic candidate)
          // With <3 words, bold is skipped but italic still applies
          const normalWidth = normalAR * baseHeight;
          const narrowWidth = 0.20 * normalAR * baseHeight; // well below 0.55× threshold

          const wordBlocks = [
            makeWordBlock('wide', baseHeight, 0.1, normalWidth),
            makeWordBlock('slim', baseHeight, 0.1, narrowWidth),
          ];
          const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());

          // Explanation of expected behavior:
          // ar1 = normalWidth / baseHeight (normalAR)
          // ar2 = narrowWidth / baseHeight (0.20 × normalAR)
          // medAR = (ar1 + ar2) / 2 = 0.60 × normalAR
          // threshold = ITALIC_ASPECT_RATIO * medAR = 0.55 × 0.60 × normalAR = 0.33 × normalAR
          // ar2 = 0.20 × normalAR < 0.33 × normalAR → italic expected on "slim"
          // ar1 = normalAR > 0.33 × normalAR → NOT italic on "wide"

          const perWord: Array<{ text: string; hasItalic: boolean }> = [];
          for (const run of result) {
            const hasItalic = run.marks.some((m) => m.type === 'italic');
            for (const w of run.text.split(/\s+/).filter(Boolean)) {
              perWord.push({ text: w, hasItalic });
            }
          }

          const slimEntry = perWord.find((p) => p.text === 'slim');
          const wideEntry = perWord.find((p) => p.text === 'wide');

          if (slimEntry) expect(slimEntry.hasItalic).toBe(true);
          if (wideEntry) expect(wideEntry.hasItalic).toBe(false);
        },
      ),
      { numRuns: MIN_RUNS },
    );
  });

  it('no italic marks (or any marks) when <50% of words have valid geometry', () => {
    // Generate scenarios where majority of words lack geometry
    const invalidMajorityArb = fc
      .tuple(
        fc.integer({ min: 4, max: 8 }),
        fc.double({ min: 0.012, max: 0.03, noNaN: true }),
        fc.double({ min: 1.5, max: 3.0, noNaN: true }),
      )
      .map(([totalCount, baseHeight, normalAR]) => {
        const validCount = Math.floor(totalCount * 0.4); // 40% valid — below 50%
        const invalidCount = totalCount - validCount;

        const normalWidth = normalAR * baseHeight;
        const narrowWidth = 0.15 * normalAR * baseHeight; // would normally trigger italic

        const wordBlocks: Block[] = [];

        // Valid geometry words — some narrow, some normal
        for (let i = 0; i < validCount; i++) {
          const width = i === 0 ? narrowWidth : normalWidth;
          wordBlocks.push(makeWordBlock(`v${i}`, baseHeight, 0.1, width));
        }

        // Invalid geometry words
        for (let i = 0; i < invalidCount; i++) {
          wordBlocks.push(makeInvalidWordBlock(`inv${i}`));
        }

        return wordBlocks;
      });

    fc.assert(
      fc.property(invalidMajorityArb, (wordBlocks) => {
        const result = inferInlineFormatting(defaultLineBlock(), wordBlocks, defaultPageMetrics());

        // With <50% valid geometry, no marks should be applied at all
        for (const run of result) {
          expect(run.marks).toEqual([]);
        }
      }),
      { numRuns: MIN_RUNS },
    );
  });
});
