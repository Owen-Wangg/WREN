// Feature: scanned-pdf-reconstruction, Property 12: Multi-column detection and reading order
/**
 * Property-based test for multi-column detection and reading order.
 *
 * **Validates: Requirements 5.1, 5.2, 5.4**
 *
 * For any page where LINE blocks cluster into 2–6 distinct horizontal regions
 * separated by gaps exceeding 1.8× the median word width, the converter SHALL
 * identify columns and emit content in left-to-right column order (ascending
 * BoundingBox.Left), with lines processed top-to-bottom within each column.
 * Full-width and multi-column regions on the same page SHALL be segmented into
 * independent vertical bands.
 */
import fc from 'fast-check';
import type { Block } from '@aws-sdk/client-textract';
import { detectColumns, type PageMetrics } from './textractColumns';

const MIN_RUNS = 100;

/** Column gap ratio threshold from design: gaps > 1.8× median word width = column separator */
const COLUMN_GAP_RATIO = 1.8;

/** Vertical band gap ratio: gaps > 2.4× median line height = band separator */
const VERTICAL_BAND_GAP_RATIO = 2.4;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a LINE block with explicit bounding box.
 */
function makeLine(left: number, top: number, width: number, height: number): Block {
  return {
    BlockType: 'LINE',
    Id: `line-${left.toFixed(4)}-${top.toFixed(4)}`,
    Geometry: {
      BoundingBox: { Left: left, Top: top, Width: width, Height: height },
    },
  };
}

/**
 * Generate a PageMetrics with controlled medianWordWidth and medianLineHeight.
 */
function makePageMetrics(medianWordWidth: number, medianLineHeight: number): PageMetrics {
  return {
    pageNumber: 1,
    medianLineHeight,
    medianWordWidth,
    medianWordHeight: 0.012,
    baselineLeft: 0.05,
    contentBounds: { left: 0.05, right: 0.95, width: 0.9 },
    indentStep: 24,
    lineCount: 10,
  };
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

/**
 * Generate a PageMetrics with reasonable values for column detection testing.
 */
const pageMetricsArb: fc.Arbitrary<PageMetrics> = fc
  .tuple(
    fc.double({ min: 0.02, max: 0.06, noNaN: true }),  // medianWordWidth
    fc.double({ min: 0.015, max: 0.04, noNaN: true }), // medianLineHeight
  )
  .map(([medianWordWidth, medianLineHeight]) => makePageMetrics(medianWordWidth, medianLineHeight));

/**
 * Generate a 2-column layout: two clusters of LINE blocks with a clear gap
 * exceeding 1.8× median word width between them.
 *
 * Left column: lines with left in [0.05, 0.05 + colWidth]
 * Gap: > 1.8× medianWordWidth
 * Right column: lines with left in [rightStart, rightStart + colWidth]
 */
const twoColumnLayoutArb = (metrics: PageMetrics): fc.Arbitrary<Block[]> => {
  const gap = metrics.medianWordWidth * COLUMN_GAP_RATIO * 1.5; // well above threshold
  const colWidth = 0.15; // width of each column region
  const lineHeight = metrics.medianLineHeight;

  return fc
    .tuple(
      fc.integer({ min: 2, max: 6 }), // lines in left column
      fc.integer({ min: 2, max: 6 }), // lines in right column
    )
    .map(([leftCount, rightCount]) => {
      const lines: Block[] = [];
      const leftColStart = 0.05;
      const rightColStart = leftColStart + colWidth + gap;

      // Left column: lines stacked vertically
      for (let i = 0; i < leftCount; i++) {
        const top = 0.1 + i * (lineHeight * 1.5);
        lines.push(makeLine(leftColStart, top, colWidth, lineHeight));
      }

      // Right column: lines stacked vertically
      for (let i = 0; i < rightCount; i++) {
        const top = 0.1 + i * (lineHeight * 1.5);
        lines.push(makeLine(rightColStart, top, colWidth, lineHeight));
      }

      return lines;
    });
};

/**
 * Generate a 3-column layout with clear gaps between all three columns.
 */
const threeColumnLayoutArb = (metrics: PageMetrics): fc.Arbitrary<Block[]> => {
  const gap = metrics.medianWordWidth * COLUMN_GAP_RATIO * 1.5;
  const colWidth = 0.12;
  const lineHeight = metrics.medianLineHeight;

  return fc
    .tuple(
      fc.integer({ min: 2, max: 4 }),
      fc.integer({ min: 2, max: 4 }),
      fc.integer({ min: 2, max: 4 }),
    )
    .map(([count1, count2, count3]) => {
      const lines: Block[] = [];
      const col1Start = 0.05;
      const col2Start = col1Start + colWidth + gap;
      const col3Start = col2Start + colWidth + gap;

      for (let i = 0; i < count1; i++) {
        lines.push(makeLine(col1Start, 0.1 + i * (lineHeight * 1.5), colWidth, lineHeight));
      }
      for (let i = 0; i < count2; i++) {
        lines.push(makeLine(col2Start, 0.1 + i * (lineHeight * 1.5), colWidth, lineHeight));
      }
      for (let i = 0; i < count3; i++) {
        lines.push(makeLine(col3Start, 0.1 + i * (lineHeight * 1.5), colWidth, lineHeight));
      }

      return lines;
    });
};

/**
 * Generate a layout with two vertical bands separated by a large vertical gap
 * (> 2.4× median line height). Each band has single-column lines.
 */
const verticalBandsArb = (metrics: PageMetrics): fc.Arbitrary<Block[]> => {
  const verticalGap = metrics.medianLineHeight * VERTICAL_BAND_GAP_RATIO * 1.5;
  const lineHeight = metrics.medianLineHeight;
  const lineWidth = 0.4;

  return fc
    .tuple(
      fc.integer({ min: 2, max: 5 }), // lines in top band
      fc.integer({ min: 2, max: 5 }), // lines in bottom band
    )
    .map(([topCount, bottomCount]) => {
      const lines: Block[] = [];

      // Top band
      for (let i = 0; i < topCount; i++) {
        lines.push(makeLine(0.1, 0.05 + i * (lineHeight * 1.5), lineWidth, lineHeight));
      }

      // Bottom band: starts after the large vertical gap
      const topBandBottom = 0.05 + (topCount - 1) * (lineHeight * 1.5) + lineHeight;
      const bottomBandTop = topBandBottom + verticalGap;

      for (let i = 0; i < bottomCount; i++) {
        lines.push(makeLine(0.1, bottomBandTop + i * (lineHeight * 1.5), lineWidth, lineHeight));
      }

      return lines;
    });
};

/**
 * Generate a layout with two vertical bands where the second band has 2 columns.
 * This tests segmentation into independent vertical bands.
 */
const mixedBandsArb = (metrics: PageMetrics): fc.Arbitrary<Block[]> => {
  const verticalGap = metrics.medianLineHeight * VERTICAL_BAND_GAP_RATIO * 1.5;
  const columnGap = metrics.medianWordWidth * COLUMN_GAP_RATIO * 1.5;
  const lineHeight = metrics.medianLineHeight;
  const colWidth = 0.15;

  return fc
    .tuple(
      fc.integer({ min: 2, max: 4 }), // lines in top full-width band
      fc.integer({ min: 2, max: 4 }), // lines per column in bottom band
    )
    .map(([topCount, bottomCountPerCol]) => {
      const lines: Block[] = [];

      // Top band: full-width lines (single column)
      for (let i = 0; i < topCount; i++) {
        lines.push(makeLine(0.1, 0.05 + i * (lineHeight * 1.5), 0.6, lineHeight));
      }

      // Bottom band: 2-column layout
      const topBandBottom = 0.05 + (topCount - 1) * (lineHeight * 1.5) + lineHeight;
      const bottomBandTop = topBandBottom + verticalGap;

      const leftColStart = 0.1;
      const rightColStart = leftColStart + colWidth + columnGap;

      for (let i = 0; i < bottomCountPerCol; i++) {
        const top = bottomBandTop + i * (lineHeight * 1.5);
        lines.push(makeLine(leftColStart, top, colWidth, lineHeight));
        lines.push(makeLine(rightColStart, top, colWidth, lineHeight));
      }

      return lines;
    });
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Property 12: Multi-column detection and reading order', () => {
  describe('Requirement 5.1: Detect 2–6 columns via gaps > 1.8× median word width', () => {
    it('detects 2 columns when LINE blocks form two clusters with gap > 1.8× median word width', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = twoColumnLayoutArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              // Should produce at least one band
              expect(bands.length).toBeGreaterThanOrEqual(1);

              // At least one band should have 2+ columns
              const multiColBand = bands.find((b) => b.columns.length >= 2);
              expect(multiColBand).toBeDefined();
              expect(multiColBand!.columns.length).toBeGreaterThanOrEqual(2);
              expect(multiColBand!.columns.length).toBeLessThanOrEqual(6);
            }),
            { numRuns: 5 }, // inner loop runs fewer iterations since outer is already 100
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });

    it('detects 3 columns when LINE blocks form three clusters with gaps > 1.8× median word width', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = threeColumnLayoutArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              expect(bands.length).toBeGreaterThanOrEqual(1);

              const multiColBand = bands.find((b) => b.columns.length >= 3);
              expect(multiColBand).toBeDefined();
              expect(multiColBand!.columns.length).toBeGreaterThanOrEqual(3);
              expect(multiColBand!.columns.length).toBeLessThanOrEqual(6);
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('Requirement 5.2: Emit left-to-right column order, top-to-bottom within each', () => {
    it('columns are sorted left-to-right (ascending left values)', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = twoColumnLayoutArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              for (const band of bands) {
                // Within each band, columns should be left-to-right
                for (let i = 1; i < band.columns.length; i++) {
                  expect(band.columns[i]!.left).toBeGreaterThanOrEqual(
                    band.columns[i - 1]!.left,
                  );
                }
              }
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });

    it('lines within each column are sorted top-to-bottom (ascending BoundingBox.Top)', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = twoColumnLayoutArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              for (const band of bands) {
                for (const column of band.columns) {
                  for (let i = 1; i < column.lines.length; i++) {
                    const prevTop =
                      column.lines[i - 1]!.Geometry?.BoundingBox?.Top ?? 0;
                    const currTop =
                      column.lines[i]!.Geometry?.BoundingBox?.Top ?? 0;
                    expect(currTop).toBeGreaterThanOrEqual(prevTop);
                  }
                }
              }
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });

    it('left-to-right and top-to-bottom hold for 3 column layouts', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = threeColumnLayoutArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              for (const band of bands) {
                // Columns left-to-right
                for (let i = 1; i < band.columns.length; i++) {
                  expect(band.columns[i]!.left).toBeGreaterThanOrEqual(
                    band.columns[i - 1]!.left,
                  );
                }
                // Lines top-to-bottom within each column
                for (const column of band.columns) {
                  for (let i = 1; i < column.lines.length; i++) {
                    const prevTop =
                      column.lines[i - 1]!.Geometry?.BoundingBox?.Top ?? 0;
                    const currTop =
                      column.lines[i]!.Geometry?.BoundingBox?.Top ?? 0;
                    expect(currTop).toBeGreaterThanOrEqual(prevTop);
                  }
                }
              }
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('Requirement 5.4: Segment into vertical bands via gaps > 2.4× median line height', () => {
    it('produces multiple bands when vertical gap exceeds 2.4× median line height', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = verticalBandsArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              // Should produce at least 2 bands due to the large vertical gap
              expect(bands.length).toBeGreaterThanOrEqual(2);
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });

    it('full-width and multi-column regions produce independent vertical bands', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = mixedBandsArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              // Should produce at least 2 bands
              expect(bands.length).toBeGreaterThanOrEqual(2);

              // First band should be single-column (full-width lines)
              expect(bands[0]!.columns.length).toBe(1);

              // Second band should have 2 columns (the multi-column section)
              expect(bands[1]!.columns.length).toBeGreaterThanOrEqual(2);
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });

    it('bands are ordered top-to-bottom (ascending top values)', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = verticalBandsArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              for (let i = 1; i < bands.length; i++) {
                expect(bands[i]!.top).toBeGreaterThanOrEqual(bands[i - 1]!.top);
              }
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('All lines are preserved in output', () => {
    it('every input LINE block appears in exactly one column of one band', () => {
      fc.assert(
        fc.property(pageMetricsArb, (metrics) => {
          const linesArb = twoColumnLayoutArb(metrics);
          fc.assert(
            fc.property(linesArb, (lines) => {
              const bands = detectColumns(lines, metrics);

              // Collect all lines from the output
              const outputLines: Block[] = [];
              for (const band of bands) {
                for (const col of band.columns) {
                  outputLines.push(...col.lines);
                }
              }

              // Every input line should appear in the output
              expect(outputLines.length).toBe(lines.length);
            }),
            { numRuns: 5 },
          );
        }),
        { numRuns: MIN_RUNS },
      );
    });
  });
});
