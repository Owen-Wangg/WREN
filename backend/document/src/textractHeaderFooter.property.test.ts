/**
 * Property-based tests: Header/Footer metadata size cap (Task 6.4).
 *
 * Feature: scanned-pdf-reconstruction, Property 15: Header/footer metadata size cap
 *
 * For any extracted header and footer metadata, the combined text content
 * SHALL not exceed 10,000 characters.
 *
 * Validates: Requirements 6.2
 */
import fc from 'fast-check';
import type { Block } from '@aws-sdk/client-textract';

import { extractHeadersFooters } from './textractHeaderFooter';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_METADATA_CHARS = 10_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

let idCounter = 0;

/** Generate a unique block Id. */
function uniqueId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Create a LAYOUT_HEADER or LAYOUT_FOOTER block with specified text content
 * on a given page. Uses the block's Text property directly for simplicity.
 */
function makeHeaderFooterBlock(
  type: 'LAYOUT_HEADER' | 'LAYOUT_FOOTER',
  page: number,
  text: string,
): Block[] {
  const parentId = uniqueId(type.toLowerCase());
  const lineId = uniqueId('line');

  const parentBlock: Block = {
    BlockType: type,
    Id: parentId,
    Page: page,
    Relationships: [{ Type: 'CHILD', Ids: [lineId] }],
    Geometry: {
      BoundingBox: { Left: 0.1, Top: type === 'LAYOUT_HEADER' ? 0.01 : 0.95, Width: 0.8, Height: 0.02 },
      Polygon: [],
    },
  };

  const lineBlock: Block = {
    BlockType: 'LINE',
    Id: lineId,
    Page: page,
    Text: text,
    Geometry: {
      BoundingBox: { Left: 0.1, Top: type === 'LAYOUT_HEADER' ? 0.01 : 0.95, Width: 0.8, Height: 0.02 },
      Polygon: [],
    },
  };

  return [parentBlock, lineBlock];
}

/**
 * Compute the combined character count of all metadata values
 * (headerMetadata + footerMetadata).
 */
function combinedMetadataLength(
  headerMetadata: Record<number, string>,
  footerMetadata: Record<number, string>,
): number {
  let total = 0;
  for (const text of Object.values(headerMetadata)) {
    total += text.length;
  }
  for (const text of Object.values(footerMetadata)) {
    total += text.length;
  }
  return total;
}

/**
 * Generate a text string of a specific length composed of words.
 * Uses a simple repeating pattern to be fast.
 */
function makeText(length: number, seed: number): string {
  const word = `word${seed}`;
  const parts: string[] = [];
  let remaining = length;
  while (remaining > 0) {
    if (remaining < word.length + 1) {
      parts.push('x'.repeat(remaining));
      remaining = 0;
    } else {
      parts.push(word);
      remaining -= word.length + 1; // +1 for space
    }
  }
  return parts.join(' ').slice(0, length);
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: scanned-pdf-reconstruction, Property 15: Header/footer metadata size cap', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  /**
   * Property 15a: Combined header + footer metadata text never exceeds 10,000 characters.
   *
   * For any extracted header and footer metadata, the combined text content
   * SHALL not exceed 10,000 characters.
   *
   * Validates: Requirements 6.2
   */
  it('combined header + footer metadata text SHALL not exceed 10,000 characters', () => {
    const scenarioArb = fc.record({
      pageCount: fc.integer({ min: 3, max: 20 }),
      headerLen: fc.integer({ min: 100, max: 1500 }),
      footerLen: fc.integer({ min: 100, max: 1500 }),
    });

    fc.assert(
      fc.property(scenarioArb, ({ pageCount, headerLen, footerLen }) => {
        const blocks: Block[] = [];

        for (let page = 1; page <= pageCount; page++) {
          // Use unique text per page to avoid deduplication
          const headerText = makeText(headerLen, page * 1000);
          const footerText = makeText(footerLen, page * 2000);

          blocks.push(...makeHeaderFooterBlock('LAYOUT_HEADER', page, headerText));
          blocks.push(...makeHeaderFooterBlock('LAYOUT_FOOTER', page, footerText));
        }

        const result = extractHeadersFooters(blocks, pageCount);
        const totalLen = combinedMetadataLength(result.headerMetadata, result.footerMetadata);

        return totalLen <= MAX_METADATA_CHARS;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 15b: When input metadata clearly exceeds 10,000 chars, the function
   * truncates and the result stays within the cap.
   *
   * Validates: Requirements 6.2
   */
  it('metadata exceeding 10,000 chars total is truncated to within the cap', () => {
    const exceedingArb = fc.record({
      pageCount: fc.integer({ min: 10, max: 25 }),
      headerLen: fc.integer({ min: 600, max: 1200 }),
      footerLen: fc.integer({ min: 600, max: 1200 }),
    }).filter(({ pageCount, headerLen, footerLen }) =>
      // Ensure total input will exceed cap
      pageCount * (headerLen + footerLen) > MAX_METADATA_CHARS,
    );

    fc.assert(
      fc.property(exceedingArb, ({ pageCount, headerLen, footerLen }) => {
        const blocks: Block[] = [];

        for (let page = 1; page <= pageCount; page++) {
          const headerText = makeText(headerLen, page * 3000 + 1);
          const footerText = makeText(footerLen, page * 4000 + 1);

          blocks.push(...makeHeaderFooterBlock('LAYOUT_HEADER', page, headerText));
          blocks.push(...makeHeaderFooterBlock('LAYOUT_FOOTER', page, footerText));
        }

        const result = extractHeadersFooters(blocks, pageCount);
        const totalLen = combinedMetadataLength(result.headerMetadata, result.footerMetadata);

        return totalLen <= MAX_METADATA_CHARS;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 15c: When combined metadata is within the cap, all text is preserved.
   *
   * Validates: Requirements 6.2 (no unnecessary truncation)
   */
  it('metadata within 10,000 chars is preserved without truncation', () => {
    const underCapArb = fc.record({
      pageCount: fc.integer({ min: 1, max: 5 }),
      headerLen: fc.integer({ min: 10, max: 100 }),
      footerLen: fc.integer({ min: 10, max: 100 }),
    }).filter(({ pageCount, headerLen, footerLen }) =>
      // Ensure total will be well under cap
      pageCount * (headerLen + footerLen) < MAX_METADATA_CHARS * 0.5,
    );

    fc.assert(
      fc.property(underCapArb, ({ pageCount, headerLen, footerLen }) => {
        const blocks: Block[] = [];
        const expectedHeaders: Record<number, string> = {};
        const expectedFooters: Record<number, string> = {};

        for (let page = 1; page <= pageCount; page++) {
          const headerText = makeText(headerLen, page * 5000);
          const footerText = makeText(footerLen, page * 6000);

          expectedHeaders[page] = headerText;
          expectedFooters[page] = footerText;

          blocks.push(...makeHeaderFooterBlock('LAYOUT_HEADER', page, headerText));
          blocks.push(...makeHeaderFooterBlock('LAYOUT_FOOTER', page, footerText));
        }

        const result = extractHeadersFooters(blocks, pageCount);

        // All text should be preserved without truncation
        for (let page = 1; page <= pageCount; page++) {
          if (result.headerMetadata[page] !== expectedHeaders[page]) return false;
          if (result.footerMetadata[page] !== expectedFooters[page]) return false;
        }

        return true;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 15d: Truncation occurs at a whitespace boundary when the cap is exceeded.
   *
   * When the combined text exceeds 10,000 characters, any truncated metadata
   * value should end at a whitespace boundary (not mid-word), unless no
   * whitespace is available.
   *
   * Validates: Requirements 6.2
   */
  it('truncation occurs at a whitespace boundary when cap is exceeded', () => {
    const exceedingWithSpacesArb = fc.record({
      pageCount: fc.integer({ min: 10, max: 20 }),
      headerLen: fc.integer({ min: 800, max: 1500 }),
      footerLen: fc.integer({ min: 800, max: 1500 }),
    }).filter(({ pageCount, headerLen, footerLen }) =>
      pageCount * (headerLen + footerLen) > MAX_METADATA_CHARS,
    );

    fc.assert(
      fc.property(exceedingWithSpacesArb, ({ pageCount, headerLen, footerLen }) => {
        const blocks: Block[] = [];
        const originalHeaders: Record<number, string> = {};

        for (let page = 1; page <= pageCount; page++) {
          // Use word-based text with spaces so truncation has whitespace boundaries
          const headerText = makeText(headerLen, page * 7000);
          const footerText = makeText(footerLen, page * 8000);

          originalHeaders[page] = headerText;
          blocks.push(...makeHeaderFooterBlock('LAYOUT_HEADER', page, headerText));
          blocks.push(...makeHeaderFooterBlock('LAYOUT_FOOTER', page, footerText));
        }

        const result = extractHeadersFooters(blocks, pageCount);

        // Check truncated header values end at whitespace boundaries
        for (const [pageStr, text] of Object.entries(result.headerMetadata)) {
          const page = Number(pageStr);
          const original = originalHeaders[page];
          if (original && text.length < original.length && text.length > 0) {
            // Text was truncated. The character AFTER the truncation point
            // in the original should be a whitespace (or the text should end
            // at a word boundary).
            const nextCharInOriginal = original[text.length];
            const lastCharInTruncated = text[text.length - 1];
            // Either the next char in original is whitespace (truncated at boundary)
            // or the last char in truncated is whitespace (truncated before boundary)
            // or there was no whitespace available (fallback to hard cut)
            const validTruncation =
              nextCharInOriginal === undefined ||
              /\s/.test(nextCharInOriginal) ||
              /\s/.test(lastCharInTruncated!) ||
              !text.includes(' '); // no whitespace in text → hard cut is acceptable
            if (!validTruncation) return false;
          }
        }

        // The critical invariant: combined length ≤ cap
        const totalLen = combinedMetadataLength(result.headerMetadata, result.footerMetadata);
        return totalLen <= MAX_METADATA_CHARS;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * Property 15e: Edge case — way over the cap (50,000 chars of header text)
   * still gets properly capped.
   *
   * Validates: Requirements 6.2
   */
  it('very large metadata (50,000+ chars) is properly capped at 10,000', () => {
    const massiveArb = fc.record({
      pageCount: fc.integer({ min: 20, max: 30 }),
      // Each page gets ~2000 chars of header → 20 pages × 2000 = 40,000+
      headerLen: fc.integer({ min: 1500, max: 2500 }),
      footerLen: fc.integer({ min: 1500, max: 2500 }),
    });

    fc.assert(
      fc.property(massiveArb, ({ pageCount, headerLen, footerLen }) => {
        const blocks: Block[] = [];

        for (let page = 1; page <= pageCount; page++) {
          const headerText = makeText(headerLen, page * 9000);
          const footerText = makeText(footerLen, page * 10000);

          blocks.push(...makeHeaderFooterBlock('LAYOUT_HEADER', page, headerText));
          blocks.push(...makeHeaderFooterBlock('LAYOUT_FOOTER', page, footerText));
        }

        const result = extractHeadersFooters(blocks, pageCount);
        const totalLen = combinedMetadataLength(result.headerMetadata, result.footerMetadata);

        return totalLen <= MAX_METADATA_CHARS;
      }),
      { numRuns: 100 },
    );
  });
});
