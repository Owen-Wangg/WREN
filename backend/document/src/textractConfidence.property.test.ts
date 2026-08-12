/**
 * Property-based test: Line confidence marking (Task 10.2).
 *
 * Feature: scanned-pdf-reconstruction, Property 16: Line confidence marking
 *
 * Design Property 16: For any LINE block containing WORD blocks with Confidence
 * values, the line confidence SHALL equal the arithmetic mean of all WORD
 * Confidence values rounded to two decimal places. If this mean is below 80%,
 * a `lowConfidence` mark SHALL be applied to the corresponding text node;
 * otherwise no `lowConfidence` mark SHALL be present.
 *
 * Validates: Requirements 7.1, 7.3
 */
import fc from 'fast-check';
import type { Block } from '@aws-sdk/client-textract';

import {
  computeLineConfidence,
  computePageConfidence,
  type ConfidenceResult,
  type PageConfidenceResult,
} from './textractConfidence';

// ─── Constants matching the implementation ───────────────────────────────────

const LOW_CONFIDENCE_THRESHOLD = 80;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a WORD block with a specific Confidence value. */
function makeWordBlock(confidence: number | undefined): Block {
  return {
    BlockType: 'WORD',
    Id: `word-${Math.random().toString(36).slice(2, 10)}`,
    Text: 'word',
    Confidence: confidence,
    Geometry: {
      BoundingBox: { Height: 0.02, Width: 0.05, Top: 0.1, Left: 0.1 },
      Polygon: [],
    },
  };
}

/** Round a number to 2 decimal places using the same formula as the implementation. */
function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: scanned-pdf-reconstruction, Property 16: Line confidence marking', () => {
  /**
   * Property 16a: Line confidence equals the arithmetic mean of WORD Confidence
   * values, rounded to two decimal places.
   * Validates: Requirement 7.3
   */
  it('line confidence SHALL equal the arithmetic mean of WORD Confidence values rounded to 2 decimal places', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (confidences) => {
          const wordBlocks = confidences.map((c) => makeWordBlock(c));

          const result: ConfidenceResult = computeLineConfidence(wordBlocks);

          // Compute expected mean
          const sum = confidences.reduce((acc, c) => acc + c, 0);
          const expectedMean = sum / confidences.length;
          const expectedConfidence = roundTo2(expectedMean);

          // Allow tiny floating-point tolerance
          return Math.abs(result.lineConfidence - expectedConfidence) < 1e-10;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 16b: If the mean confidence is below 80%, applyLowConfidenceMark
   * SHALL be true; otherwise it SHALL be false.
   * Validates: Requirement 7.1
   */
  it('applyLowConfidenceMark SHALL be true when lineConfidence < 80%, false otherwise', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (confidences) => {
          const wordBlocks = confidences.map((c) => makeWordBlock(c));

          const result: ConfidenceResult = computeLineConfidence(wordBlocks);

          // Compute expected
          const sum = confidences.reduce((acc, c) => acc + c, 0);
          const expectedMean = sum / confidences.length;
          const expectedConfidence = roundTo2(expectedMean);
          const expectedMark = expectedConfidence < LOW_CONFIDENCE_THRESHOLD;

          return result.applyLowConfidenceMark === expectedMark;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 16c: Combined biconditional — lineConfidence and applyLowConfidenceMark
   * are always consistent: mark applied ⟺ lineConfidence < 80%.
   * Validates: Requirements 7.1, 7.3
   */
  it('lowConfidence mark is applied if AND only if lineConfidence < 80%', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (confidences) => {
          const wordBlocks = confidences.map((c) => makeWordBlock(c));

          const result: ConfidenceResult = computeLineConfidence(wordBlocks);

          // Biconditional check
          return result.applyLowConfidenceMark === (result.lineConfidence < LOW_CONFIDENCE_THRESHOLD);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 16d: Missing Confidence values are treated as 100%.
   * Validates: Requirement 7.4 (supports 7.1, 7.3 correctness)
   */
  it('missing Confidence values (undefined) SHALL be treated as 100%', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
          { minLength: 1, maxLength: 15 },
        ),
        (maybeConfidences) => {
          const wordBlocks = maybeConfidences.map((c) => makeWordBlock(c));

          const result: ConfidenceResult = computeLineConfidence(wordBlocks);

          // Missing = 100%
          const effectiveValues = maybeConfidences.map((c) => c ?? 100);
          const sum = effectiveValues.reduce((acc, c) => acc + c, 0);
          const expectedMean = sum / effectiveValues.length;
          const expectedConfidence = roundTo2(expectedMean);

          return Math.abs(result.lineConfidence - expectedConfidence) < 1e-10;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 16e: Empty word block array returns confidence 100 with no lowConfidence mark.
   * Validates: Requirement 7.5 (supports 7.1 no mark condition)
   */
  it('empty WORD block array returns lineConfidence 100 and applyLowConfidenceMark false', () => {
    const result: ConfidenceResult = computeLineConfidence([]);

    expect(result.lineConfidence).toBe(100);
    expect(result.applyLowConfidenceMark).toBe(false);
  });

  /**
   * Property 16f: Boundary test — confidence exactly at 80% does NOT trigger the mark.
   * Validates: Requirement 7.1 (< 80%, not ≤ 80%)
   */
  it('lineConfidence exactly at 80% SHALL NOT trigger lowConfidence mark', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        (wordCount) => {
          // All words at exactly 80% confidence → mean = 80 → no mark
          const wordBlocks = Array.from({ length: wordCount }, () => makeWordBlock(80));

          const result: ConfidenceResult = computeLineConfidence(wordBlocks);

          return result.lineConfidence === 80 && result.applyLowConfidenceMark === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 16g: All words with 100% confidence → line confidence 100, no mark.
   * Validates: Requirements 7.1, 7.3
   */
  it('all words at 100% confidence yields lineConfidence 100 and no mark', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (wordCount) => {
          const wordBlocks = Array.from({ length: wordCount }, () => makeWordBlock(100));

          const result: ConfidenceResult = computeLineConfidence(wordBlocks);

          return result.lineConfidence === 100 && result.applyLowConfidenceMark === false;
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 16h: All words with 0% confidence → line confidence 0, mark applied.
   * Validates: Requirements 7.1, 7.3
   */
  it('all words at 0% confidence yields lineConfidence 0 and mark applied', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (wordCount) => {
          const wordBlocks = Array.from({ length: wordCount }, () => makeWordBlock(0));

          const result: ConfidenceResult = computeLineConfidence(wordBlocks);

          return result.lineConfidence === 0 && result.applyLowConfidenceMark === true;
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// Property 17: Page confidence warning (Task 10.3)
//
// Feature: scanned-pdf-reconstruction, Property 17: Page confidence warning
//
// For any page where the average of all line confidences falls below 70%, the
// converter SHALL prepend an informational paragraph indicating potential OCR
// errors to the beginning of that page's content.
//
// Validates: Requirements 7.2
// ─────────────────────────────────────────────────────────────────────────────

// ─── Constants for Property 17 ───────────────────────────────────────────────

const PAGE_WARNING_THRESHOLD = 70;

// ─── Arbitraries for Property 17 ─────────────────────────────────────────────

/**
 * Generate an array of line confidence values (0–100).
 * Confidence values are realistic floats rounded to 2 decimal places.
 */
const lineConfidencesArb = fc.array(
  fc.double({ min: 0, max: 100, noNaN: true }).map((v) => Math.round(v * 100) / 100),
  { minLength: 1, maxLength: 30 },
);

/**
 * Generate line confidences that produce a mean BELOW 70%.
 * Strategy: all values between 0 and 69.99.
 */
const lowPageConfidencesArb = fc.array(
  fc.double({ min: 0, max: 69.99, noNaN: true }).map((v) => Math.round(v * 100) / 100),
  { minLength: 1, maxLength: 20 },
);

/**
 * Generate line confidences that produce a mean at or ABOVE 70%.
 * Strategy: all values between 70 and 100.
 */
const highPageConfidencesArb = fc.array(
  fc.double({ min: 70, max: 100, noNaN: true }).map((v) => Math.round(v * 100) / 100),
  { minLength: 1, maxLength: 20 },
);

// ─── Helpers for Property 17 ─────────────────────────────────────────────────

/** Compute expected average confidence rounded to 2 decimal places. */
function expectedPageMean(values: number[]): number {
  if (values.length === 0) return 100;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length) * 100) / 100;
}

// ─── Property 17 Tests ───────────────────────────────────────────────────────

describe('Feature: scanned-pdf-reconstruction, Property 17: Page confidence warning', () => {
  /**
   * Property 17a: When mean of line confidences < 70%, prependWarning === true.
   * Validates: Requirement 7.2
   */
  it('page with average line confidence below 70% SHALL have prependWarning === true', () => {
    fc.assert(
      fc.property(lowPageConfidencesArb, (lineConfidences) => {
        const mean = expectedPageMean(lineConfidences);
        // Only test cases where mean is actually < 70
        if (mean >= PAGE_WARNING_THRESHOLD) return true;

        const result: PageConfidenceResult = computePageConfidence(lineConfidences);

        return result.prependWarning === true;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17b: When mean of line confidences ≥ 70%, prependWarning === false.
   * Validates: Requirement 7.2
   */
  it('page with average line confidence at or above 70% SHALL have prependWarning === false', () => {
    fc.assert(
      fc.property(highPageConfidencesArb, (lineConfidences) => {
        const mean = expectedPageMean(lineConfidences);
        // Only test cases where mean is actually >= 70
        if (mean < PAGE_WARNING_THRESHOLD) return true;

        const result: PageConfidenceResult = computePageConfidence(lineConfidences);

        return result.prependWarning === false;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17c: averageConfidence equals the arithmetic mean of all line
   * confidence values, rounded to 2 decimal places.
   * Validates: Requirement 7.2
   */
  it('averageConfidence SHALL equal round(mean of line confidences, 2)', () => {
    fc.assert(
      fc.property(lineConfidencesArb, (lineConfidences) => {
        const result: PageConfidenceResult = computePageConfidence(lineConfidences);
        const expected = expectedPageMean(lineConfidences);

        // Allow tiny floating-point tolerance (rounding)
        return Math.abs(result.averageConfidence - expected) < 1e-10;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 17d: Empty array (no lines with words) returns confidence 100
   * and prependWarning === false.
   * Validates: Requirement 7.2 (edge case)
   */
  it('empty line confidences array SHALL return averageConfidence 100 and prependWarning false', () => {
    const result: PageConfidenceResult = computePageConfidence([]);

    expect(result.averageConfidence).toBe(100);
    expect(result.prependWarning).toBe(false);
  });

  /**
   * Property 17e: prependWarning is strictly determined by the threshold —
   * for any arbitrary line confidences, prependWarning === (averageConfidence < 70).
   * Validates: Requirement 7.2
   */
  it('prependWarning SHALL be true if and only if averageConfidence < 70', () => {
    fc.assert(
      fc.property(lineConfidencesArb, (lineConfidences) => {
        const result: PageConfidenceResult = computePageConfidence(lineConfidences);

        const shouldWarn = result.averageConfidence < PAGE_WARNING_THRESHOLD;
        return result.prependWarning === shouldWarn;
      }),
      { numRuns: 100 },
    );
  });
});
