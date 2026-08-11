/**
 * Textract Confidence Annotator — quality indicators for OCR output.
 *
 * Computes per-line, per-page, and per-document confidence scores from
 * Textract WORD block Confidence values. Determines whether to apply
 * lowConfidence marks (line < 80%) or prepend warning paragraphs (page < 70%).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */
import type { Block } from '@aws-sdk/client-textract';

/**
 * Result of computing confidence for a single LINE's WORD blocks.
 */
export interface ConfidenceResult {
  /** Per-line arithmetic mean of WORD Confidence values, rounded to 2 decimal places. */
  lineConfidence: number;
  /** True when lineConfidence < 80% — signals that a lowConfidence mark should be applied. */
  applyLowConfidenceMark: boolean;
}

/**
 * Result of computing average confidence across all lines on a page.
 */
export interface PageConfidenceResult {
  /** Average of line confidences, rounded to 2 decimal places. */
  averageConfidence: number;
  /** True when averageConfidence < 70% — signals that a warning paragraph should be prepended. */
  prependWarning: boolean;
}

/**
 * Compute confidence for a single LINE based on its WORD blocks.
 *
 * - Arithmetic mean of WORD Confidence values, rounded to 2 decimal places.
 * - Missing Confidence values are treated as 100% (Requirement 7.4).
 * - Zero-WORD lines: returns confidence 100 with no lowConfidence mark (Requirement 7.5).
 * - Line confidence < 80% triggers lowConfidence mark (Requirement 7.1).
 *
 * @param wordBlocks - WORD blocks belonging to the LINE (filtered to BlockType === 'WORD')
 */
export function computeLineConfidence(wordBlocks: Block[]): ConfidenceResult {
  // Requirement 7.5: Zero-WORD lines are excluded from calculations, no lowConfidence mark.
  if (wordBlocks.length === 0) {
    return { lineConfidence: 100, applyLowConfidenceMark: false };
  }

  // Requirement 7.3: arithmetic mean of WORD Confidence values.
  // Requirement 7.4: missing Confidence → treat as 100%.
  let sum = 0;
  for (const word of wordBlocks) {
    sum += word.Confidence ?? 100;
  }

  const mean = sum / wordBlocks.length;
  const lineConfidence = Math.round(mean * 100) / 100;

  // Requirement 7.1: < 80% → apply lowConfidence mark.
  const applyLowConfidenceMark = lineConfidence < 80;

  return { lineConfidence, applyLowConfidenceMark };
}

/**
 * Compute average confidence across all lines on a page.
 *
 * - Arithmetic mean of line confidences, rounded to 2 decimal places.
 * - Page confidence < 70% triggers a warning paragraph (Requirement 7.2).
 * - Empty array (no lines with words): returns 100 confidence, no warning.
 *
 * @param lineConfidences - Array of per-line confidence values (from computeLineConfidence results)
 */
export function computePageConfidence(
  lineConfidences: number[],
): PageConfidenceResult {
  if (lineConfidences.length === 0) {
    return { averageConfidence: 100, prependWarning: false };
  }

  let sum = 0;
  for (const confidence of lineConfidences) {
    sum += confidence;
  }

  const mean = sum / lineConfidences.length;
  const averageConfidence = Math.round(mean * 100) / 100;

  // Requirement 7.2: < 70% → prepend warning paragraph.
  const prependWarning = averageConfidence < 70;

  return { averageConfidence, prependWarning };
}

/**
 * Compute overall document confidence as the arithmetic mean of all line confidences.
 *
 * - Rounded to 2 decimal places (Requirement 7.6).
 * - Empty array: returns 100 (no lines to evaluate).
 *
 * @param allLineConfidences - Array of all per-line confidence values across the entire document
 */
export function computeDocumentConfidence(
  allLineConfidences: number[],
): number {
  if (allLineConfidences.length === 0) {
    return 100;
  }

  let sum = 0;
  for (const confidence of allLineConfidences) {
    sum += confidence;
  }

  const mean = sum / allLineConfidences.length;
  return Math.round(mean * 100) / 100;
}
