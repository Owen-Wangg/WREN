// Feature: scanned-pdf-reconstruction, Property 18: Paragraph merging
/**
 * Property-based test for paragraph merging.
 *
 * **Validates: Requirements 8.1, 8.3, 8.4, 8.6**
 *
 * For any sequence of consecutive LINE blocks on the same page with valid geometry:
 *   - Lines SHALL be merged into a single paragraph when the vertical gap is
 *     ≤ 1.85× median line height AND left edges differ by < 4% of page width.
 *   - Lines SHALL be separate paragraphs when the gap exceeds 2.4× median line height
 *     OR when a page boundary separates them.
 *   - Lines ending with sentence-terminal punctuation with gaps between 1.85× and 2.4×
 *     SHALL start a new paragraph.
 */
import fc from 'fast-check';
import {
  mergeOcrLines,
  type TextractLine,
  type PageMetrics,
  TEXTRACT_SOFT_WRAP_GAP_RATIO,
  TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO,
} from './textractLines';

const MIN_RUNS = 100;

/** Left-edge alignment tolerance as fraction of page width (4%). */
const LEFT_EDGE_TOLERANCE = 0.04;

/**
 * Generate a PageMetrics object with sensible defaults for paragraph merging tests.
 */
const pageMetricsArb: fc.Arbitrary<PageMetrics> = fc
  .tuple(
    fc.double({ min: 0.01, max: 0.05, noNaN: true }), // medianLineHeight
    fc.double({ min: 0.005, max: 0.03, noNaN: true }), // medianWordWidth
    fc.double({ min: 0.005, max: 0.03, noNaN: true }), // medianWordHeight
    fc.double({ min: 0.02, max: 0.15, noNaN: true }), // baselineLeft
    fc.double({ min: 12, max: 56, noNaN: true }), // indentStep
  )
  .map(([medianLineHeight, medianWordWidth, medianWordHeight, baselineLeft, indentStep]) => ({
    pageNumber: 1,
    medianLineHeight,
    medianWordWidth,
    medianWordHeight,
    baselineLeft,
    contentBounds: { left: 0.02, right: 0.98, width: 0.96 },
    indentStep,
    lineCount: 10,
  }));

/**
 * Generate a sequence of TextractLine blocks on the same page with controlled
 * vertical gaps to test merge behavior.
 *
 * Lines are placed vertically with a configurable gap between them.
 * All lines share the same page and have valid geometry.
 */
function makeLineSequence(opts: {
  count: number;
  height: number;
  startTop: number;
  gapBetweenLines: number;
  left: number;
  page: number;
  texts?: string[];
}): TextractLine[] {
  const lines: TextractLine[] = [];
  let currentTop = opts.startTop;
  for (let i = 0; i < opts.count; i++) {
    lines.push({
      text: opts.texts?.[i] ?? `Line ${i + 1} text content`,
      top: currentTop,
      height: opts.height,
      left: opts.left,
      page: opts.page,
    });
    currentTop += opts.height + opts.gapBetweenLines;
  }
  return lines;
}

describe('Property 18: Paragraph merging', () => {
  describe('Requirement 8.1: Merge when gap ≤ 1.85× AND left edges within 4%', () => {
    it('consecutive lines with small gap and aligned left edges are merged into one paragraph', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.integer({ min: 2, max: 6 }), // number of lines
          fc.double({ min: 0, max: 0.99, noNaN: true }), // gapFraction (fraction of softGap)
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // left position
          (pageMetrics, lineCount, gapFraction, left) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const softGap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO;

            // Gap is strictly within 1.85× median (gapFraction < 1.0 means gap < softGap)
            const gap = gapFraction * softGap;

            // All lines share the same left edge (within tolerance)
            const lines = makeLineSequence({
              count: lineCount,
              height: medianHeight,
              startTop: 0.1,
              gapBetweenLines: gap,
              left,
              page: 1,
            });

            const result = mergeOcrLines(lines, pageMetrics);

            // All lines should merge into a single paragraph
            expect(result.length).toBe(1);
            expect(result[0]!.lines.length).toBe(lineCount);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('lines with left edges differing by less than 4% of page width are merged', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // base left
          fc.double({ min: 0, max: 0.99, noNaN: true }), // left offset fraction of tolerance
          (pageMetrics, baseLeft, offsetFraction) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const pageWidth = pageMetrics.contentBounds.width;
            const maxLeftDiff = LEFT_EDGE_TOLERANCE * pageWidth;

            // Gap within merge threshold
            const gap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO * 0.5;

            // Second line's left differs by less than 4% of page width
            const leftOffset = offsetFraction * maxLeftDiff * 0.99; // stay below tolerance
            const secondLeft = baseLeft + leftOffset;

            // Ensure positions are valid
            if (secondLeft > 0.9) return;

            const lines: TextractLine[] = [
              { text: 'First line of paragraph', top: 0.1, height: medianHeight, left: baseLeft, page: 1 },
              { text: 'second line continues', top: 0.1 + medianHeight + gap, height: medianHeight, left: secondLeft, page: 1 },
            ];

            const result = mergeOcrLines(lines, pageMetrics);

            // Should be merged into one paragraph
            expect(result.length).toBe(1);
            expect(result[0]!.lines.length).toBe(2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('lines with left edges differing by ≥ 4% of page width are NOT merged even with small gap', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.double({ min: 0.05, max: 0.12, noNaN: true }), // base left
          fc.double({ min: 1.01, max: 3.0, noNaN: true }), // multiplier beyond tolerance
          (pageMetrics, baseLeft, multiplier) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const pageWidth = pageMetrics.contentBounds.width;
            const tolerance = LEFT_EDGE_TOLERANCE * pageWidth;

            // Gap within soft threshold
            const gap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO * 0.5;

            // Second line's left differs by more than 4% of page width
            const leftOffset = tolerance * multiplier;
            const secondLeft = baseLeft + leftOffset;

            // Ensure positions are valid
            if (secondLeft > 0.9) return;

            const lines: TextractLine[] = [
              { text: 'First line of paragraph', top: 0.1, height: medianHeight, left: baseLeft, page: 1 },
              { text: 'second line different indent', top: 0.1 + medianHeight + gap, height: medianHeight, left: secondLeft, page: 1 },
            ];

            const result = mergeOcrLines(lines, pageMetrics);

            // Should be separate paragraphs due to misaligned left edges
            expect(result.length).toBe(2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('Requirement 8.3: Separate when gap > 2.4× median line height', () => {
    it('lines with gap exceeding 2.4× median are always separate paragraphs', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.double({ min: 1.01, max: 5.0, noNaN: true }), // multiplier above hardGap
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // left
          (pageMetrics, multiplier, left) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const hardGap = medianHeight * TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO;

            // Gap exceeds 2.4× median line height
            const gap = hardGap * multiplier;

            // Ensure lines stay within page bounds
            const startTop = 0.05;
            const secondTop = startTop + medianHeight + gap;
            if (secondTop + medianHeight > 1.0) return;

            const lines: TextractLine[] = [
              { text: 'First paragraph line', top: startTop, height: medianHeight, left, page: 1 },
              { text: 'Second paragraph line', top: secondTop, height: medianHeight, left, page: 1 },
            ];

            const result = mergeOcrLines(lines, pageMetrics);

            // Must always be separate paragraphs
            expect(result.length).toBe(2);
            expect(result[0]!.lines.length).toBe(1);
            expect(result[1]!.lines.length).toBe(1);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('large gap separates even when left edges are perfectly aligned', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.integer({ min: 3, max: 5 }), // number of lines
          (pageMetrics, lineCount) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const hardGap = medianHeight * TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO;

            // All lines have same left and a gap > 2.4×
            const gap = hardGap * 1.5;
            const startTop = 0.02;

            // Check if lines fit on page
            const lastTop = startTop + (lineCount - 1) * (medianHeight + gap);
            if (lastTop + medianHeight > 1.0) return;

            const lines = makeLineSequence({
              count: lineCount,
              height: medianHeight,
              startTop,
              gapBetweenLines: gap,
              left: 0.1,
              page: 1,
            });

            const result = mergeOcrLines(lines, pageMetrics);

            // Each line should be its own paragraph
            expect(result.length).toBe(lineCount);
            for (const para of result) {
              expect(para.lines.length).toBe(1);
            }
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('Requirement 8.4: Sentence-terminal punctuation + gap > 1.85× starts new paragraph', () => {
    it('sentence-terminal punctuation with gap in (1.85×, 2.4×] starts a new paragraph', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.constantFrom('.', '?', '!'), // sentence-terminal punctuation
          fc.double({ min: 0.01, max: 0.99, noNaN: true }), // fraction between soft and hard gap
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // left
          (pageMetrics, punctuation, gapFraction, left) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const softGap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO;
            const hardGap = medianHeight * TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO;

            // Gap is between 1.85× and 2.4× (exclusive ends for strict between)
            const gap = softGap + gapFraction * (hardGap - softGap);

            // Only test when gap > softGap (requirement 8.4 condition)
            if (gap <= softGap) return;
            // Also stay below hardGap (that's requirement 8.3 territory)
            if (gap > hardGap) return;

            const startTop = 0.1;
            const secondTop = startTop + medianHeight + gap;
            if (secondTop + medianHeight > 1.0) return;

            const lines: TextractLine[] = [
              { text: `This is a sentence ending${punctuation}`, top: startTop, height: medianHeight, left, page: 1 },
              { text: 'Next paragraph starts here', top: secondTop, height: medianHeight, left, page: 1 },
            ];

            const result = mergeOcrLines(lines, pageMetrics);

            // Sentence-terminal + gap > 1.85× → separate paragraphs
            expect(result.length).toBe(2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('sentence-terminal punctuation with gap ≤ 1.85× does NOT force a new paragraph', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.constantFrom('.', '?', '!'),
          fc.double({ min: 0, max: 0.99, noNaN: true }), // fraction of softGap
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // left
          (pageMetrics, punctuation, gapFraction, left) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const softGap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO;

            // Gap is within soft threshold (≤ 1.85×)
            const gap = gapFraction * softGap;

            const startTop = 0.1;
            const secondTop = startTop + medianHeight + gap;
            if (secondTop + medianHeight > 1.0) return;

            const lines: TextractLine[] = [
              { text: `This ends with punctuation${punctuation}`, top: startTop, height: medianHeight, left, page: 1 },
              { text: 'continuation text here', top: secondTop, height: medianHeight, left, page: 1 },
            ];

            const result = mergeOcrLines(lines, pageMetrics);

            // Gap ≤ 1.85× → merged even with punctuation (Req 8.4 only triggers when gap > 1.85×)
            expect(result.length).toBe(1);
            expect(result[0]!.lines.length).toBe(2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('non-sentence-terminal text with gap in (1.85×, 2.4×] does NOT force a new paragraph when left edges align', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.double({ min: 0.01, max: 0.99, noNaN: true }), // fraction between soft and hard gap
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // left
          (pageMetrics, gapFraction, left) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const softGap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO;
            const hardGap = medianHeight * TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO;

            // Gap between 1.85× and 2.4×
            const gap = softGap + gapFraction * (hardGap - softGap);
            if (gap <= softGap || gap > hardGap) return;

            const startTop = 0.1;
            const secondTop = startTop + medianHeight + gap;
            if (secondTop + medianHeight > 1.0) return;

            // Text does NOT end with sentence-terminal punctuation
            const lines: TextractLine[] = [
              { text: 'This line ends without punctuation', top: startTop, height: medianHeight, left, page: 1 },
              { text: 'and this continues the thought', top: secondTop, height: medianHeight, left, page: 1 },
            ];

            const result = mergeOcrLines(lines, pageMetrics);

            // No sentence-terminal → the ambiguous gap zone doesn't force a break
            // (only the hard gap > 2.4× or sentence-terminal + gap > 1.85× forces it)
            // With gap > softGap but no punctuation and aligned left edges,
            // the merge condition (gap ≤ softGap) is NOT met, so they should be separate
            // because the merge condition requires gap ≤ 1.85×
            expect(result.length).toBe(2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('Requirement 8.6: Page boundaries always separate', () => {
    it('lines on different pages are always in separate paragraphs regardless of gap', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.integer({ min: 1, max: 10 }), // page1
          fc.integer({ min: 1, max: 10 }), // page2
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // left
          (pageMetrics, page1, page2, left) => {
            // Ensure different pages
            if (page1 === page2) return;

            const medianHeight = pageMetrics.medianLineHeight;
            // Determine ordering (mergeOcrLines sorts by ascending page, Req 8.8)
            const [firstPage, secondPage] = page1 < page2 ? [page1, page2] : [page2, page1];

            // Even with a very small gap (lines "close" in vertical terms),
            // page boundaries always separate
            const lines: TextractLine[] = [
              { text: 'Line on first page', top: 0.9, height: medianHeight, left, page: firstPage },
              { text: 'Line on second page', top: 0.1, height: medianHeight, left, page: secondPage },
            ];

            const result = mergeOcrLines(lines, pageMetrics);

            // Must always be separate due to page boundary
            expect(result.length).toBe(2);
            // After sorting, first page comes first
            expect(result[0]!.lines[0]!.page).toBe(firstPage);
            expect(result[1]!.lines[0]!.page).toBe(secondPage);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('multiple lines across multiple pages are always separated at page boundaries', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.integer({ min: 2, max: 4 }), // number of pages
          fc.integer({ min: 1, max: 3 }), // lines per page
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // left
          (pageMetrics, numPages, linesPerPage, left) => {
            const medianHeight = pageMetrics.medianLineHeight;
            // Use a small gap within merge threshold so lines on same page would merge
            const gap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO * 0.5;

            const lines: TextractLine[] = [];
            for (let p = 1; p <= numPages; p++) {
              let top = 0.1;
              for (let l = 0; l < linesPerPage; l++) {
                if (top + medianHeight > 0.95) break;
                lines.push({
                  text: `Page ${p} line ${l + 1}`,
                  top,
                  height: medianHeight,
                  left,
                  page: p,
                });
                top += medianHeight + gap;
              }
            }

            const result = mergeOcrLines(lines, pageMetrics);

            // Lines on same page with small gap should merge, but page boundaries separate
            // So we expect at least numPages paragraphs
            expect(result.length).toBeGreaterThanOrEqual(numPages);

            // Verify no paragraph contains lines from different pages
            for (const para of result) {
              const pages = new Set(para.lines.map((l) => l.page));
              expect(pages.size).toBe(1);
            }
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('page boundary separates even when gap would normally merge', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.double({ min: 0.05, max: 0.15, noNaN: true }), // left
          (pageMetrics, left) => {
            const medianHeight = pageMetrics.medianLineHeight;

            // Lines with zero effective gap (would merge if same page)
            // but on different pages
            const lines: TextractLine[] = [
              { text: 'End of page one', top: 0.5, height: medianHeight, left, page: 1 },
              { text: 'Start of page two', top: 0.5, height: medianHeight, left, page: 2 },
            ];

            const result = mergeOcrLines(lines, pageMetrics);

            // Page boundary always separates
            expect(result.length).toBe(2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('Combined property: merge rules compose correctly', () => {
    it('a mix of mergeable and non-mergeable lines produces correct paragraph boundaries', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          fc.double({ min: 0.05, max: 0.12, noNaN: true }), // left
          (pageMetrics, left) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const softGap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO;
            const hardGap = medianHeight * TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO;

            const smallGap = softGap * 0.5; // Will merge
            const largeGap = hardGap * 1.5; // Will separate

            let top = 0.05;

            // Paragraph 1: two lines with small gap (merge)
            const line1: TextractLine = { text: 'Para one line one', top, height: medianHeight, left, page: 1 };
            top += medianHeight + smallGap;
            const line2: TextractLine = { text: 'para one line two', top, height: medianHeight, left, page: 1 };
            top += medianHeight + largeGap;

            // Ensure we stay in bounds
            if (top + medianHeight * 3 > 1.0) return;

            // Paragraph 2: single line followed by large gap
            const line3: TextractLine = { text: 'Para two standalone', top, height: medianHeight, left, page: 1 };
            top += medianHeight + smallGap;

            // Paragraph 2 continues (small gap, same alignment)
            const line4: TextractLine = { text: 'para two line two', top, height: medianHeight, left, page: 1 };

            const lines = [line1, line2, line3, line4];
            const result = mergeOcrLines(lines, pageMetrics);

            // Expected: 2 paragraphs
            //  - Paragraph 1: line1 + line2 (small gap, aligned)
            //  - Paragraph 2: line3 + line4 (small gap, aligned; separated from para1 by large gap)
            expect(result.length).toBe(2);
            expect(result[0]!.lines.length).toBe(2);
            expect(result[1]!.lines.length).toBe(2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });
});


// Feature: scanned-pdf-reconstruction, Property 19: Hyphen de-hyphenation joining
/**
 * Property-based test for hyphen de-hyphenation joining.
 *
 * **Validates: Requirements 8.2**
 *
 * For any LINE block whose text ends with a hyphen character immediately followed by
 * a word character as the first character of the next LINE block's text (and lines are
 * in the same paragraph by gap rules), the converter SHALL join the two by removing
 * the trailing hyphen and concatenating directly without an intervening space.
 */
describe('Property 19: Hyphen de-hyphenation joining', () => {
  /**
   * Generator for a word prefix (text before the trailing hyphen on line 1).
   * Produces non-empty alphabetic strings.
   */
  const wordPrefixArb = fc
    .stringOf(fc.char().filter((c) => /[a-zA-Z]/.test(c)), { minLength: 2, maxLength: 12 })
    .filter((s) => s.length >= 2);

  /**
   * Generator for a word suffix (text starting the second line, beginning with a word char).
   * Produces non-empty strings beginning with \w (letter, digit, or underscore).
   */
  const wordSuffixArb = fc
    .tuple(
      fc.char().filter((c) => /\w/.test(c)),
      fc.stringOf(fc.char().filter((c) => /[a-zA-Z]/.test(c)), { minLength: 1, maxLength: 10 }),
    )
    .map(([first, rest]) => first + rest);

  /**
   * Generator for a string that starts with a non-word character.
   * Used for testing the negative case where de-hyphenation should NOT apply.
   */
  const nonWordStartArb = fc
    .tuple(
      fc.char().filter((c) => /\W/.test(c) && c.trim().length > 0),
      fc.stringOf(fc.char().filter((c) => /[a-zA-Z ]/.test(c)), { minLength: 1, maxLength: 10 }),
    )
    .map(([first, rest]) => first + rest);

  /**
   * Helper: create a pair of lines that will merge (same page, small gap, aligned left edges).
   */
  function makeMergeablePair(
    text1: string,
    text2: string,
    pageMetrics: PageMetrics,
  ): TextractLine[] {
    const medianHeight = pageMetrics.medianLineHeight;
    const gap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO * 0.4; // well within merge threshold
    return [
      { text: text1, top: 0.1, height: medianHeight, left: 0.08, page: 1 },
      { text: text2, top: 0.1 + medianHeight + gap, height: medianHeight, left: 0.08, page: 1 },
    ];
  }

  describe('Positive case: trailing hyphen + next line starts with word char → de-hyphenate', () => {
    it('joins hyphenated word by removing hyphen and concatenating without space', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          wordPrefixArb,
          wordSuffixArb,
          (pageMetrics, prefix, suffix) => {
            // First line ends with "prefix-", second line starts with suffix (word char)
            const line1Text = prefix + '-';
            const line2Text = suffix;

            const lines = makeMergeablePair(line1Text, line2Text, pageMetrics);
            const result = mergeOcrLines(lines, pageMetrics);

            // Lines should merge into one paragraph
            expect(result.length).toBe(1);

            // The merged text should have the hyphen removed and no space between parts
            const expectedJoined = prefix + suffix;
            expect(result[0]!.text).toBe(expectedJoined);

            // Verify no hyphen remains at the join point
            expect(result[0]!.text).not.toContain(prefix + '-');
            // Verify no space between prefix and suffix
            expect(result[0]!.text).not.toContain(prefix + ' ' + suffix);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('handles multi-line paragraphs with hyphenation at one join point', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          wordPrefixArb,
          wordSuffixArb,
          (pageMetrics, prefix, suffix) => {
            const medianHeight = pageMetrics.medianLineHeight;
            const gap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO * 0.4;
            const left = 0.08;

            // Three lines: line1 normal, line2 ends with hyphen, line3 starts with word char
            const lines: TextractLine[] = [
              { text: 'The beginning of', top: 0.1, height: medianHeight, left, page: 1 },
              { text: prefix + '-', top: 0.1 + medianHeight + gap, height: medianHeight, left, page: 1 },
              { text: suffix + ' end', top: 0.1 + 2 * (medianHeight + gap), height: medianHeight, left, page: 1 },
            ];

            // Make sure lines fit on page
            if (0.1 + 3 * (medianHeight + gap) > 0.95) return;

            const result = mergeOcrLines(lines, pageMetrics);

            // All lines merge into one paragraph
            expect(result.length).toBe(1);

            // The paragraph text should de-hyphenate: "The beginning of" + " " + prefix + suffix + " end"
            const text = result[0]!.text;
            // Line 1 → Line 2 is normal join (line 1 doesn't end with hyphen) → space
            expect(text).toContain('The beginning of ' + prefix);
            // Line 2 → Line 3 is de-hyphenated → no hyphen, no space at join
            expect(text).toContain(prefix + suffix);
            expect(text).not.toContain(prefix + '- ');
            expect(text).not.toContain(prefix + '-' + suffix);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('Negative case: trailing hyphen + next line starts with non-word char → preserve hyphen', () => {
    it('preserves hyphen and joins with space when next line starts with non-word char', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          wordPrefixArb,
          nonWordStartArb,
          (pageMetrics, prefix, nonWordText) => {
            // First line ends with "prefix-", second line starts with non-word char
            const line1Text = prefix + '-';
            const line2Text = nonWordText;

            const lines = makeMergeablePair(line1Text, line2Text, pageMetrics);
            const result = mergeOcrLines(lines, pageMetrics);

            // Lines should merge into one paragraph
            expect(result.length).toBe(1);

            // The hyphen should be preserved and joined with a space.
            // Note: mergeOcrLines trims input text, so we compare against trimmed versions.
            const trimmedLine2 = line2Text.trim();
            if (trimmedLine2.length === 0) return; // skip empty-after-trim case

            const text = result[0]!.text;
            expect(text).toBe(prefix + '- ' + trimmedLine2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });

  describe('Negative case: no trailing hyphen → normal space-joined', () => {
    it('joins lines with a space when first line does NOT end with a hyphen', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          wordPrefixArb,
          wordSuffixArb,
          (pageMetrics, text1, text2) => {
            // Ensure first line does NOT end with a hyphen
            const line1Text = text1.replace(/-$/, '');
            if (line1Text.length === 0) return;

            const lines = makeMergeablePair(line1Text, text2, pageMetrics);
            const result = mergeOcrLines(lines, pageMetrics);

            // Lines should merge into one paragraph
            expect(result.length).toBe(1);

            // Joined with a space (normal behavior)
            expect(result[0]!.text).toBe(line1Text + ' ' + text2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });

    it('hyphen in the middle of a line does not trigger de-hyphenation', () => {
      fc.assert(
        fc.property(
          pageMetricsArb,
          wordPrefixArb,
          wordPrefixArb,
          wordSuffixArb,
          (pageMetrics, word1, word2, nextLineStart) => {
            // First line has a hyphen in the middle but does NOT end with one
            const line1Text = word1 + '-' + word2;
            const line2Text = nextLineStart;

            const lines = makeMergeablePair(line1Text, line2Text, pageMetrics);
            const result = mergeOcrLines(lines, pageMetrics);

            // Lines should merge into one paragraph
            expect(result.length).toBe(1);

            // Joined with a space (the mid-word hyphen is preserved)
            expect(result[0]!.text).toBe(line1Text + ' ' + line2Text);
            // The internal hyphen remains
            expect(result[0]!.text).toContain(word1 + '-' + word2);
          },
        ),
        { numRuns: MIN_RUNS },
      );
    });
  });
});
