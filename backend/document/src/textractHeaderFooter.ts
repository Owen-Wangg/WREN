/**
 * Header/Footer Extraction — identifies repeating LAYOUT_HEADER, LAYOUT_FOOTER,
 * and LAYOUT_PAGE_NUMBER blocks, deduplicates repeated content, and separates
 * metadata from body blocks.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
import type { Block } from '@aws-sdk/client-textract';

import { getChildBlocks } from './textractBlockIndex.js';

/** Maximum combined characters for header + footer metadata. */
const MAX_METADATA_CHARS = 10_000;

/** Minimum page occurrences to consider text "repeating". */
const DEDUP_THRESHOLD = 3;

/**
 * Result of header/footer extraction. Body blocks exclude all
 * LAYOUT_HEADER, LAYOUT_FOOTER, and LAYOUT_PAGE_NUMBER blocks.
 */
export interface HeaderFooterResult {
  /** Header text per page number. */
  headerMetadata: Record<number, string>;
  /** Footer text per page number. */
  footerMetadata: Record<number, string>;
  /** Single instance of header text that repeats on ≥3 pages, or null. */
  deduplicatedHeader: string | null;
  /** Single instance of footer text that repeats on ≥3 pages, or null. */
  deduplicatedFooter: string | null;
  /** Non-repeating LAYOUT_HEADER blocks to include in body as h2 nodes. */
  nonRepeatingHeaders: Block[];
  /** Remaining blocks for main content (excludes header/footer/page-number). */
  bodyBlocks: Block[];
}

/**
 * Normalize text for deduplication: collapse consecutive whitespace to a
 * single space, then trim leading/trailing whitespace.
 */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Extract text content from a LAYOUT_HEADER/FOOTER/PAGE_NUMBER block.
 *
 * Strategy:
 * 1. If the block has a Text property directly, use it.
 * 2. Otherwise, traverse CHILD relationships to find LINE blocks and
 *    concatenate their Text values with a space separator.
 */
function extractBlockText(
  block: Block,
  byId: ReadonlyMap<string, Block>,
): string {
  // Direct text on the block itself
  if (typeof block.Text === 'string' && block.Text.trim()) {
    return block.Text.trim();
  }

  // Traverse children to collect LINE text
  const children = getChildBlocks(block, byId);
  const parts: string[] = [];

  for (const child of children) {
    if (child.BlockType === 'LINE' && typeof child.Text === 'string') {
      const trimmed = child.Text.trim();
      if (trimmed) parts.push(trimmed);
    } else if (child.BlockType === 'WORD' && typeof child.Text === 'string') {
      const trimmed = child.Text.trim();
      if (trimmed) parts.push(trimmed);
    }
  }

  // If no LINE children, recurse one more level for nested structure
  if (parts.length === 0) {
    for (const child of children) {
      const grandChildren = getChildBlocks(child, byId);
      for (const gc of grandChildren) {
        if (gc.BlockType === 'LINE' && typeof gc.Text === 'string') {
          const trimmed = gc.Text.trim();
          if (trimmed) parts.push(trimmed);
        } else if (gc.BlockType === 'WORD' && typeof gc.Text === 'string') {
          const trimmed = gc.Text.trim();
          if (trimmed) parts.push(trimmed);
        }
      }
    }
  }

  return parts.join(' ').trim();
}

/**
 * Truncate text at a whitespace boundary so it doesn't exceed maxLength.
 * If no whitespace boundary exists before maxLength, truncate at maxLength.
 */
function truncateAtWhitespace(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  // Find the last whitespace at or before maxLength
  let cutoff = maxLength;
  while (cutoff > 0 && !/\s/.test(text[cutoff]!)) {
    cutoff--;
  }

  // If no whitespace found, just cut at max
  if (cutoff === 0) return text.slice(0, maxLength);

  return text.slice(0, cutoff);
}

/**
 * Count how many distinct pages a normalized text appears on.
 */
function countPageOccurrences(
  entries: Array<{ page: number; normalized: string }>,
  targetNormalized: string,
): number {
  const pages = new Set<number>();
  for (const entry of entries) {
    if (entry.normalized === targetNormalized) {
      pages.add(entry.page);
    }
  }
  return pages.size;
}

/**
 * Extract headers and footers from Textract blocks, separating metadata
 * from body content.
 *
 * - Identifies LAYOUT_HEADER, LAYOUT_FOOTER, LAYOUT_PAGE_NUMBER blocks
 * - Extracts text content keyed by page number
 * - Deduplicates text appearing on ≥3 pages (case-sensitive, collapsed whitespace)
 * - Non-repeating headers (<3 pages) returned as blocks for body h2 nodes
 * - Excludes header/footer/page-number blocks from body
 * - Caps combined metadata at 10,000 characters (truncated at whitespace boundary)
 * - Returns null metadata when no header/footer blocks exist
 */
export function extractHeadersFooters(
  blocks: Block[],
  _pageCount: number,
): HeaderFooterResult {
  // Build block index for relationship traversal
  const byId = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) byId.set(block.Id, block);
  }

  // Separate header/footer/page-number blocks from body
  const headerBlocks: Block[] = [];
  const footerBlocks: Block[] = [];
  const pageNumberBlocks: Block[] = [];
  const bodyBlocks: Block[] = [];

  for (const block of blocks) {
    const blockType = block.BlockType;
    if (blockType === 'LAYOUT_HEADER') {
      headerBlocks.push(block);
    } else if (blockType === 'LAYOUT_FOOTER') {
      footerBlocks.push(block);
    } else if (blockType === 'LAYOUT_PAGE_NUMBER') {
      pageNumberBlocks.push(block);
    } else {
      bodyBlocks.push(block);
    }
  }

  // Handle null case: no header/footer/page-number blocks at all
  const hasHeaderFooter =
    headerBlocks.length > 0 ||
    footerBlocks.length > 0 ||
    pageNumberBlocks.length > 0;

  if (!hasHeaderFooter) {
    return {
      headerMetadata: {},
      footerMetadata: {},
      deduplicatedHeader: null,
      deduplicatedFooter: null,
      nonRepeatingHeaders: [],
      bodyBlocks,
    };
  }

  // Extract text for each header block, keyed by page
  const headerEntries: Array<{ page: number; text: string; normalized: string; block: Block }> = [];
  for (const block of headerBlocks) {
    const page = block.Page ?? 1;
    const text = extractBlockText(block, byId);
    if (text) {
      headerEntries.push({ page, text, normalized: normalizeText(text), block });
    }
  }

  // Extract text for each footer block (includes page numbers), keyed by page
  const footerEntries: Array<{ page: number; text: string; normalized: string }> = [];
  for (const block of [...footerBlocks, ...pageNumberBlocks]) {
    const page = block.Page ?? 1;
    const text = extractBlockText(block, byId);
    if (text) {
      footerEntries.push({ page, text, normalized: normalizeText(text) });
    }
  }

  // Build headerMetadata: page → text
  const headerMetadata: Record<number, string> = {};
  for (const entry of headerEntries) {
    if (headerMetadata[entry.page]) {
      headerMetadata[entry.page] += ' ' + entry.text;
    } else {
      headerMetadata[entry.page] = entry.text;
    }
  }

  // Build footerMetadata: page → text
  const footerMetadata: Record<number, string> = {};
  for (const entry of footerEntries) {
    if (footerMetadata[entry.page]) {
      footerMetadata[entry.page] += ' ' + entry.text;
    } else {
      footerMetadata[entry.page] = entry.text;
    }
  }

  // Deduplicate headers: find text appearing on ≥3 distinct pages
  let deduplicatedHeader: string | null = null;
  const nonRepeatingHeaders: Block[] = [];
  const seenHeaderNormalized = new Set<string>();

  for (const entry of headerEntries) {
    if (seenHeaderNormalized.has(entry.normalized)) continue;
    seenHeaderNormalized.add(entry.normalized);

    const pageCount = countPageOccurrences(headerEntries, entry.normalized);
    if (pageCount >= DEDUP_THRESHOLD) {
      // Store only the first occurrence's text for deduplicated header
      if (deduplicatedHeader === null) {
        deduplicatedHeader = entry.text;
      } else {
        // Append additional repeating header texts
        deduplicatedHeader += ' ' + entry.text;
      }
    }
  }

  // Non-repeating headers: blocks whose normalized text appears on <3 pages
  for (const entry of headerEntries) {
    const pageCount = countPageOccurrences(headerEntries, entry.normalized);
    if (pageCount < DEDUP_THRESHOLD) {
      nonRepeatingHeaders.push(entry.block);
    }
  }

  // Deduplicate footers: find text appearing on ≥3 distinct pages
  let deduplicatedFooter: string | null = null;
  const seenFooterNormalized = new Set<string>();

  for (const entry of footerEntries) {
    if (seenFooterNormalized.has(entry.normalized)) continue;
    seenFooterNormalized.add(entry.normalized);

    const pageCount = countPageOccurrences(footerEntries, entry.normalized);
    if (pageCount >= DEDUP_THRESHOLD) {
      if (deduplicatedFooter === null) {
        deduplicatedFooter = entry.text;
      } else {
        deduplicatedFooter += ' ' + entry.text;
      }
    }
  }

  // Cap combined metadata at MAX_METADATA_CHARS
  const allMetadataTexts: string[] = [];
  for (const page of Object.keys(headerMetadata).sort((a, b) => Number(a) - Number(b))) {
    allMetadataTexts.push(headerMetadata[Number(page)]!);
  }
  for (const page of Object.keys(footerMetadata).sort((a, b) => Number(a) - Number(b))) {
    allMetadataTexts.push(footerMetadata[Number(page)]!);
  }

  const combinedMetadata = allMetadataTexts.join(' ');
  if (combinedMetadata.length > MAX_METADATA_CHARS) {
    // Truncate the metadata - rebuild records within the cap
    const truncated = truncateAtWhitespace(combinedMetadata, MAX_METADATA_CHARS);
    let remaining = truncated.length;

    // Truncate header metadata entries
    for (const page of Object.keys(headerMetadata).sort((a, b) => Number(a) - Number(b))) {
      const pageNum = Number(page);
      const text = headerMetadata[pageNum]!;
      if (remaining <= 0) {
        delete headerMetadata[pageNum];
      } else if (text.length > remaining) {
        headerMetadata[pageNum] = truncateAtWhitespace(text, remaining);
        remaining = 0;
      } else {
        remaining -= text.length + 1; // +1 for joining space
      }
    }

    // Truncate footer metadata entries
    for (const page of Object.keys(footerMetadata).sort((a, b) => Number(a) - Number(b))) {
      const pageNum = Number(page);
      const text = footerMetadata[pageNum]!;
      if (remaining <= 0) {
        delete footerMetadata[pageNum];
      } else if (text.length > remaining) {
        footerMetadata[pageNum] = truncateAtWhitespace(text, remaining);
        remaining = 0;
      } else {
        remaining -= text.length + 1;
      }
    }

    // Truncate deduplicated strings if needed
    if (deduplicatedHeader && deduplicatedHeader.length > MAX_METADATA_CHARS) {
      deduplicatedHeader = truncateAtWhitespace(deduplicatedHeader, MAX_METADATA_CHARS);
    }
    if (deduplicatedFooter && deduplicatedFooter.length > MAX_METADATA_CHARS) {
      deduplicatedFooter = truncateAtWhitespace(deduplicatedFooter, MAX_METADATA_CHARS);
    }
  }

  return {
    headerMetadata,
    footerMetadata,
    deduplicatedHeader,
    deduplicatedFooter,
    nonRepeatingHeaders,
    bodyBlocks,
  };
}
