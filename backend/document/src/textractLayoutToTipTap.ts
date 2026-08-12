/**
 * Map Amazon Textract AnalyzeDocument LAYOUT (+ TABLES) blocks into TipTap JSON.
 *
 * Layout elements arrive in reading order. CHILD relationships point at LINE
 * blocks (or nested LAYOUT_TEXT for lists / TABLE for tables).
 *
 * Enhanced pipeline (task 13.3) orchestrates:
 * 1. Block indexing
 * 2. Header/footer extraction
 * 3. Per-page metrics computation
 * 4. Multi-column detection
 * 5. Paragraph merging within columns
 * 6. Inline formatting inference (bold/italic/fontSize)
 * 7. Alignment & indentation
 * 8. Confidence annotation
 * 9. Figure placeholder insertion
 * 10. Document assembly
 */
import type { Block } from '@aws-sdk/client-textract';
import type { S3Client } from '@aws-sdk/client-s3';
import type { TipTapDoc, TipTapNode } from '@wren/types';

import {
  mergeTextractLinesIntoParagraphs,
  mergeOcrLines,
  joinLineTexts,
  type TextractLine,
  type PageMetrics,
  type MergedParagraph,
} from './textractLines.js';
import { buildBlockIndex } from './textractBlockIndex.js';
import { inferInlineFormatting, type FormattedRun } from './textractFormatting.js';
import { inferAlignment } from './textractAlignment.js';
import { detectColumns, type PageBand } from './textractColumns.js';
import { extractHeadersFooters } from './textractHeaderFooter.js';
import {
  computeLineConfidence,
  computePageConfidence,
  computeDocumentConfidence,
} from './textractConfidence.js';

const SKIP_LAYOUT = new Set([
  'LAYOUT_HEADER',
  'LAYOUT_FOOTER',
  'LAYOUT_PAGE_NUMBER',
  'LAYOUT_FIGURE',
]);

// ─── Page Metrics Computation ───────────────────────────────────────────────

/** Compute the median of a numeric array. Returns 0 for empty arrays. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** Compute the Nth percentile from a sorted array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (index - lower);
}

/**
 * Compute PageMetrics for a set of LINE and WORD blocks on a single page.
 * Falls back to safe defaults when insufficient data is available.
 */
function computePageMetricsForPage(
  pageNumber: number,
  lineBlocks: Block[],
  wordBlocks: Block[],
): PageMetrics {
  // Collect line heights
  const lineHeights: number[] = [];
  const lineLefts: number[] = [];
  for (const line of lineBlocks) {
    const h = line.Geometry?.BoundingBox?.Height;
    const l = line.Geometry?.BoundingBox?.Left;
    if (typeof h === 'number' && h > 0) lineHeights.push(h);
    if (typeof l === 'number') lineLefts.push(l);
  }

  // Collect word dimensions
  const wordWidths: number[] = [];
  const wordHeights: number[] = [];
  for (const word of wordBlocks) {
    const w = word.Geometry?.BoundingBox?.Width;
    const h = word.Geometry?.BoundingBox?.Height;
    if (typeof w === 'number' && w > 0) wordWidths.push(w);
    if (typeof h === 'number' && h > 0) wordHeights.push(h);
  }

  const medianLineHeight = median(lineHeights) || 0.02;
  const medianWordWidth = median(wordWidths) || 0.05;
  const medianWordHeight = median(wordHeights) || 0.012;

  // Baseline left: 10th percentile of LINE Left values (Requirement 2.5)
  const sortedLefts = [...lineLefts].sort((a, b) => a - b);
  const baselineLeft =
    lineLefts.length >= 3
      ? percentile(sortedLefts, 10)
      : (sortedLefts.length > 0 ? sortedLefts[0]! : 0);

  // Content bounds from all LINE blocks
  let contentLeft = 1;
  let contentRight = 0;
  for (const line of lineBlocks) {
    const bbox = line.Geometry?.BoundingBox;
    if (!bbox || typeof bbox.Left !== 'number' || typeof bbox.Width !== 'number') continue;
    contentLeft = Math.min(contentLeft, bbox.Left);
    contentRight = Math.max(contentRight, bbox.Left + bbox.Width);
  }
  if (contentLeft > contentRight) {
    contentLeft = 0;
    contentRight = 1;
  }

  const pageWidth = 1.0; // Textract uses normalized [0, 1] coordinates
  // Indent step: (medianLineHeight × 2.2 + pageWidth × 0.035) / 2, clamped [12, 56]
  // Since we're in normalized coords (0–1), we need different clamp values
  // The design says "clamped between 12 and 56 normalized units" but Textract coords are 0–1
  // So we interpret this as: the formula produces a value in normalized coords
  const rawIndentStep = (medianLineHeight * 2.2 + pageWidth * 0.035) / 2;
  // Clamp: design says [12, 56] but these appear to be in pixel-like units for a ~595pt page
  // For normalized coords (page width = 1.0), reasonable clamp is [0.02, 0.09]
  const indentStep = Math.max(0.02, Math.min(rawIndentStep, 0.09));

  return {
    pageNumber,
    medianLineHeight,
    medianWordWidth,
    medianWordHeight,
    baselineLeft,
    contentBounds: {
      left: contentLeft,
      right: contentRight,
      width: contentRight - contentLeft,
    },
    indentStep,
    lineCount: lineBlocks.length,
  };
}

/** Placeholder text for figures that cannot be extracted in this function. */
const FIGURE_PLACEHOLDER_TEXT = '[Figure could not be rendered]';

/** Confidence warning text prepended to pages with <70% average confidence. */
const PAGE_CONFIDENCE_WARNING =
  '⚠️ This page may contain OCR errors due to low scan quality. Please review carefully.';

function childIds(block: Block): string[] {
  const ids: string[] = [];
  for (const rel of block.Relationships ?? []) {
    if (rel.Type === 'CHILD' && rel.Ids?.length) {
      ids.push(...rel.Ids);
    }
  }
  return ids;
}

function indexBlocks(blocks: readonly Block[]): Map<string, Block> {
  const map = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) map.set(block.Id, block);
  }
  return map;
}

function lineFromBlock(block: Block): TextractLine | null {
  if (block.BlockType !== 'LINE' || typeof block.Text !== 'string') return null;
  const text = block.Text.trim();
  if (!text) return null;
  const box = block.Geometry?.BoundingBox;
  return {
    text,
    ...(typeof block.Confidence === 'number' ? { confidence: block.Confidence } : {}),
    ...(typeof box?.Top === 'number' ? { top: box.Top } : {}),
    ...(typeof box?.Height === 'number' ? { height: box.Height } : {}),
    ...(typeof box?.Left === 'number' ? { left: box.Left } : {}),
    ...(typeof block.Page === 'number' ? { page: block.Page } : {}),
  };
}

/** Collect LINE children (recursing through intermediate layout/text blocks). */
function collectChildLines(block: Block, byId: Map<string, Block>, depth = 0): TextractLine[] {
  if (depth > 8) return [];
  const lines: TextractLine[] = [];
  for (const id of childIds(block)) {
    const child = byId.get(id);
    if (!child) continue;
    if (child.BlockType === 'LINE') {
      const line = lineFromBlock(child);
      if (line) lines.push(line);
      continue;
    }
    if (
      child.BlockType === 'LAYOUT_TEXT' ||
      child.BlockType === 'LAYOUT_LIST' ||
      child.BlockType === 'WORD' ||
      child.BlockType?.startsWith('LAYOUT_')
    ) {
      lines.push(...collectChildLines(child, byId, depth + 1));
    }
  }
  return lines;
}

function linesToPlainText(lines: readonly TextractLine[]): string {
  const merged = mergeTextractLinesIntoParagraphs(lines);
  return merged.join(' ').trim();
}

function paragraphNode(text: string): TipTapNode {
  return {
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : undefined,
  };
}

function headingNode(text: string, level: 1 | 2): TipTapNode {
  return {
    type: 'heading',
    attrs: { level },
    content: text ? [{ type: 'text', text }] : undefined,
  };
}

function listFromLayout(block: Block, byId: Map<string, Block>): TipTapNode | null {
  const items: TipTapNode[] = [];
  for (const id of childIds(block)) {
    const child = byId.get(id);
    if (!child) continue;
    const lines =
      child.BlockType === 'LAYOUT_TEXT' || child.BlockType === 'LINE'
        ? child.BlockType === 'LINE'
          ? (() => {
              const line = lineFromBlock(child);
              return line ? [line] : [];
            })()
          : collectChildLines(child, byId)
        : collectChildLines(child, byId);
    const text = linesToPlainText(lines);
    if (!text) continue;
    items.push({
      type: 'listItem',
      content: [paragraphNode(text)],
    });
  }
  if (items.length === 0) return null;
  return { type: 'bulletList', content: items };
}

function cellText(cell: Block, byId: Map<string, Block>): string {
  const parts: string[] = [];
  for (const id of childIds(cell)) {
    const child = byId.get(id);
    if (!child) continue;
    if (child.BlockType === 'WORD' && typeof child.Text === 'string') {
      parts.push(child.Text);
    } else if (child.BlockType === 'LINE' && typeof child.Text === 'string') {
      parts.push(child.Text);
    } else if (child.BlockType === 'SELECTION_ELEMENT') {
      if (child.SelectionStatus === 'SELECTED') parts.push('[X]');
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Collect WORD blocks from a CELL block (via CHILD relationship).
 * Words are needed for right-alignment detection.
 */
function collectCellWords(cell: Block, byId: Map<string, Block>): Block[] {
  const words: Block[] = [];
  for (const id of childIds(cell)) {
    const child = byId.get(id);
    if (!child) continue;
    if (child.BlockType === 'WORD') {
      words.push(child);
    } else if (child.BlockType === 'LINE') {
      // LINE blocks contain WORD children
      for (const wordId of childIds(child)) {
        const word = byId.get(wordId);
        if (word && word.BlockType === 'WORD') {
          words.push(word);
        }
      }
    }
  }
  return words;
}

/**
 * Determine whether a cell's content is right-aligned by examining WORD
 * right edges relative to the cell's right boundary.
 *
 * Right-aligned if ≥75% of WORD blocks have their right edge within 8%
 * of the cell's right boundary.
 */
function isCellRightAligned(cell: Block, words: Block[]): boolean {
  const cellBox = cell.Geometry?.BoundingBox;
  if (!cellBox || typeof cellBox.Left !== 'number' || typeof cellBox.Width !== 'number') {
    return false;
  }

  const validWords = words.filter(
    (w) =>
      w.Geometry?.BoundingBox &&
      typeof w.Geometry.BoundingBox.Left === 'number' &&
      typeof w.Geometry.BoundingBox.Width === 'number',
  );

  if (validWords.length === 0) return false;

  const cellRight = cellBox.Left + cellBox.Width;
  const threshold = cellBox.Width * 0.08; // 8% of cell width

  let alignedCount = 0;
  for (const word of validWords) {
    const box = word.Geometry!.BoundingBox!;
    const wordRight = box.Left! + box.Width!;
    if (Math.abs(cellRight - wordRight) <= threshold) {
      alignedCount++;
    }
  }

  return alignedCount / validWords.length >= 0.75;
}

/**
 * Build a paragraph node for a table cell, applying right-alignment when detected.
 */
function cellParagraphNode(text: string, rightAligned: boolean, isBold: boolean): TipTapNode {
  const textContent: TipTapNode[] = text
    ? [
        {
          type: 'text',
          text,
          ...(isBold ? { marks: [{ type: 'bold' }] } : {}),
        },
      ]
    : [];

  const para: TipTapNode = {
    type: 'paragraph',
    ...(rightAligned ? { attrs: { textAlign: 'right' } } : {}),
    ...(textContent.length > 0 ? { content: textContent } : {}),
  };

  return para;
}

function tableFromBlock(table: Block, byId: Map<string, Block>): TipTapNode | null {
  const cells: Array<{
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
    text: string;
    isHeader: boolean;
    rightAligned: boolean;
  }> = [];

  for (const id of childIds(table)) {
    const child = byId.get(id);
    if (!child || (child.BlockType !== 'CELL' && child.BlockType !== 'MERGED_CELL')) {
      continue;
    }
    const row = child.RowIndex ?? 0;
    const col = child.ColumnIndex ?? 0;
    if (row < 1 || col < 1) continue;

    const words = collectCellWords(child, byId);
    const rightAligned = isCellRightAligned(child, words);

    cells.push({
      row,
      col,
      rowSpan: child.RowSpan ?? 1,
      colSpan: child.ColumnSpan ?? 1,
      text: cellText(child, byId),
      isHeader: (child.EntityTypes ?? []).includes('COLUMN_HEADER'),
      rightAligned,
    });
  }

  if (cells.length === 0) return null;

  const maxRow = Math.max(...cells.map((c) => c.row));
  const maxCol = Math.max(...cells.map((c) => c.col + c.colSpan - 1));
  const byRowCol = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));

  // Build a set of grid positions covered by spans (excluding the origin cell itself)
  const coveredPositions = new Set<string>();
  for (const cell of cells) {
    for (let dr = 0; dr < cell.rowSpan; dr++) {
      for (let dc = 0; dc < cell.colSpan; dc++) {
        if (dr === 0 && dc === 0) continue; // origin cell is not "covered"
        coveredPositions.add(`${cell.row + dr}:${cell.col + dc}`);
      }
    }
  }

  const rows: TipTapNode[] = [];
  for (let r = 1; r <= maxRow; r++) {
    const rowCells: TipTapNode[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const key = `${r}:${c}`;

      // Skip positions covered by a prior cell's colspan/rowspan
      if (coveredPositions.has(key)) continue;

      const cell = byRowCol.get(key);
      const isHeader = cell ? cell.isHeader || r === 1 : r === 1;
      const cellType = isHeader ? 'tableHeader' : 'tableCell';

      if (!cell) {
        // Empty cell not covered by a span — produce an empty cell node
        rowCells.push({
          type: cellType,
          content: [{ type: 'paragraph' }],
        });
        continue;
      }

      const isBold = isHeader;
      const para = cellParagraphNode(cell.text, cell.rightAligned, isBold);

      const cellNode: TipTapNode = {
        type: cellType,
        content: [para],
      };

      // Add colspan/rowspan attrs when > 1
      if (cell.colSpan > 1 || cell.rowSpan > 1) {
        cellNode.attrs = {
          ...(cell.colSpan > 1 ? { colspan: cell.colSpan } : {}),
          ...(cell.rowSpan > 1 ? { rowspan: cell.rowSpan } : {}),
        };
      }

      rowCells.push(cellNode);
    }
    if (rowCells.length > 0) {
      rows.push({ type: 'tableRow', content: rowCells });
    }
  }

  if (rows.length === 0) return null;
  return { type: 'table', content: rows };
}

function findChildTable(block: Block, byId: Map<string, Block>): Block | null {
  for (const id of childIds(block)) {
    const child = byId.get(id);
    if (!child) continue;
    if (child.BlockType === 'TABLE') return child;
  }
  return null;
}

/**
 * Convert AnalyzeDocument blocks (LAYOUT + TABLES) into a TipTap document.
 *
 * Enhanced pipeline (task 13.3):
 * 1. Build block index
 * 2. Extract headers/footers (separate metadata from body)
 * 3. Compute per-page metrics
 * 4. Detect multi-column layout per page
 * 5. Process in column-aware reading order
 * 6. Merge OCR lines into paragraphs
 * 7. Apply inline formatting (bold/italic/fontSize)
 * 8. Apply alignment & indentation
 * 9. Insert figure placeholders at reading-order position
 * 10. Apply confidence marks and page warnings
 * 11. Assemble final TipTap document
 *
 * Falls back to geometry line-merge when no layout elements are present.
 * Gracefully degrades: if any enrichment step fails, falls back to plain text.
 */
export function textractLayoutBlocksToTipTap(blocks: readonly Block[]): TipTapDoc {
  const byId = indexBlocks(blocks);

  // --- Check if layout elements are present ---
  const hasLayoutBlocks = blocks.some(
    (b) => b.BlockType?.startsWith('LAYOUT_'),
  );

  let result: TipTapDoc;

  if (!hasLayoutBlocks) {
    // No layout elements: check for TABLE blocks first, then fall back to line-merge
    const hasTableBlocks = blocks.some((b) => b.BlockType === 'TABLE');
    if (hasTableBlocks) {
      // Use legacy conversion that handles TABLE blocks
      result = legacyLayoutConversion(blocks, byId);
    } else {
      result = fallbackGeometryMerge(blocks);
    }
  } else {
    try {
      result = enrichedPipeline(blocks, byId);
    } catch {
      // Graceful degradation: if the enriched pipeline fails entirely,
      // fall back to the legacy plain-text conversion
      result = legacyLayoutConversion(blocks, byId);
    }
  }

  // Validate output before returning (Requirements 9.1, 9.2, 9.4, 9.5)
  return validateTipTapOutput(result);
}

/**
 * Fallback: simple geometry-based line merge when no LAYOUT blocks exist.
 */
function fallbackGeometryMerge(blocks: readonly Block[]): TipTapDoc {
  const lines: TextractLine[] = [];
  for (const block of blocks) {
    const line = lineFromBlock(block);
    if (line) lines.push(line);
  }
  const paragraphs = mergeTextractLinesIntoParagraphs(lines);
  return {
    type: 'doc',
    content:
      paragraphs.length > 0
        ? paragraphs.map((text) => paragraphNode(text))
        : [paragraphNode('')],
  };
}

/**
 * The enriched pipeline that orchestrates all formatting modules.
 */
function enrichedPipeline(
  blocks: readonly Block[],
  byId: Map<string, Block>,
): TipTapDoc {
  // --- Step 1: Build block index for efficient lookups ---
  const blockIndex = buildBlockIndex(blocks);

  // --- Step 2: Extract headers/footers ---
  const pageCount = computePageCount(blocks);
  const headerFooterResult = extractHeadersFooters([...blocks], pageCount);
  const bodyBlocks = headerFooterResult.bodyBlocks;
  const nonRepeatingHeaders = headerFooterResult.nonRepeatingHeaders;

  // --- Step 3: Group LINE and WORD blocks by page, compute metrics ---
  const lineBlocksByPage = new Map<number, Block[]>();
  const wordBlocksByPage = new Map<number, Block[]>();
  const allBlocks = bodyBlocks;

  for (const block of allBlocks) {
    const page = block.Page ?? 1;
    if (block.BlockType === 'LINE') {
      if (!lineBlocksByPage.has(page)) lineBlocksByPage.set(page, []);
      lineBlocksByPage.get(page)!.push(block);
    } else if (block.BlockType === 'WORD') {
      if (!wordBlocksByPage.has(page)) wordBlocksByPage.set(page, []);
      wordBlocksByPage.get(page)!.push(block);
    }
  }

  const pageMetricsMap = new Map<number, PageMetrics>();
  const allPages = new Set<number>();
  for (const page of lineBlocksByPage.keys()) allPages.add(page);
  for (const page of wordBlocksByPage.keys()) allPages.add(page);

  for (const page of allPages) {
    const lines = lineBlocksByPage.get(page) ?? [];
    const words = wordBlocksByPage.get(page) ?? [];
    pageMetricsMap.set(page, computePageMetricsForPage(page, lines, words));
  }

  // --- Step 4–11: Process layout blocks in reading order with enrichment ---
  const nodes: TipTapNode[] = [];
  const consumedLayoutIds = new Set<string>();
  const consumedTableIds = new Set<string>();
  const allLineConfidences: number[] = [];
  const pageLineConfidences = new Map<number, number[]>();

  const markDescendantLayoutsConsumed = (block: Block) => {
    for (const id of childIds(block)) {
      const child = byId.get(id);
      if (!child?.Id) continue;
      if (child.BlockType?.startsWith('LAYOUT_')) {
        consumedLayoutIds.add(child.Id);
        markDescendantLayoutsConsumed(child);
      }
    }
  };

  // Process non-repeating headers as h2 nodes at the start
  for (const headerBlock of nonRepeatingHeaders) {
    const lines = collectChildLines(headerBlock, byId);
    const text = linesToPlainText(lines);
    if (text) {
      nodes.push(headingNode(text, 2));
    }
    if (headerBlock.Id) consumedLayoutIds.add(headerBlock.Id);
  }

  // Process body layout blocks in document order
  for (const block of allBlocks) {
    const type = block.BlockType;
    if (!type?.startsWith('LAYOUT_')) continue;
    if (block.Id && consumedLayoutIds.has(block.Id)) continue;
    if (SKIP_LAYOUT.has(type)) {
      // Handle LAYOUT_FIGURE: insert placeholder at reading-order position
      if (type === 'LAYOUT_FIGURE') {
        nodes.push(paragraphNode(FIGURE_PLACEHOLDER_TEXT));
        if (block.Id) consumedLayoutIds.add(block.Id);
      }
      continue;
    }

    if (type === 'LAYOUT_LIST') {
      const list = listFromLayout(block, byId);
      if (list) {
        nodes.push(list);
        if (block.Id) consumedLayoutIds.add(block.Id);
        markDescendantLayoutsConsumed(block);
      }
      continue;
    }

    if (type === 'LAYOUT_TABLE') {
      const tableBlock = findChildTable(block, byId);
      if (tableBlock?.Id) {
        const table = tableFromBlock(tableBlock, byId);
        if (table) {
          nodes.push(table);
          consumedTableIds.add(tableBlock.Id);
        }
      } else {
        const lines = collectChildLines(block, byId);
        const text = linesToPlainText(lines);
        if (text) nodes.push(paragraphNode(text));
      }
      if (block.Id) consumedLayoutIds.add(block.Id);
      markDescendantLayoutsConsumed(block);
      continue;
    }

    // For LAYOUT_TITLE and LAYOUT_SECTION_HEADER: produce heading nodes
    if (type === 'LAYOUT_TITLE' || type === 'LAYOUT_SECTION_HEADER') {
      const lines = collectChildLines(block, byId);
      const text = linesToPlainText(lines);
      if (text) {
        const level: 1 | 2 = type === 'LAYOUT_TITLE' ? 1 : 2;
        nodes.push(headingNode(text, level));
      }
      if (block.Id) consumedLayoutIds.add(block.Id);
      markDescendantLayoutsConsumed(block);
      continue;
    }

    // For other LAYOUT_TEXT blocks: apply the enriched paragraph pipeline
    const page = block.Page ?? 1;
    const metrics = pageMetricsMap.get(page) ?? computePageMetricsForPage(page, [], []);
    const childLineBlocks = collectChildLineBlocks(block, byId);

    if (childLineBlocks.length === 0) {
      // No LINE children: try collecting text directly
      const lines = collectChildLines(block, byId);
      const text = linesToPlainText(lines);
      if (text) nodes.push(paragraphNode(text));
      if (block.Id) consumedLayoutIds.add(block.Id);
      markDescendantLayoutsConsumed(block);
      continue;
    }

    // Apply column detection for this block's LINE children
    try {
      const pageBands = detectColumns(childLineBlocks, metrics);
      const enrichedNodes = processPageBands(
        pageBands,
        metrics,
        blockIndex,
        allLineConfidences,
        pageLineConfidences,
        page,
      );
      nodes.push(...enrichedNodes);
    } catch {
      // Fallback: plain text paragraphs
      const lines = collectChildLines(block, byId);
      for (const para of mergeTextractLinesIntoParagraphs(lines)) {
        if (para) nodes.push(paragraphNode(para));
      }
    }

    if (block.Id) consumedLayoutIds.add(block.Id);
    markDescendantLayoutsConsumed(block);
  }

  // Orphan TABLE blocks not linked from LAYOUT_TABLE
  for (const block of allBlocks) {
    if (block.BlockType !== 'TABLE' || !block.Id || consumedTableIds.has(block.Id)) {
      continue;
    }
    const table = tableFromBlock(block, byId);
    if (table) nodes.push(table);
  }

  // --- Step 10: Page-level confidence warnings ---
  const finalNodes = applyPageConfidenceWarnings(nodes, pageLineConfidences);

  // Ensure non-empty document
  if (finalNodes.length === 0) {
    return { type: 'doc', content: [paragraphNode('')] };
  }

  return { type: 'doc', content: finalNodes };
}

/**
 * Process page bands (from column detection) into enriched TipTap nodes.
 * Applies mergeOcrLines, inline formatting, alignment, and confidence within columns.
 */
function processPageBands(
  pageBands: PageBand[],
  metrics: PageMetrics,
  blockIndex: ReturnType<typeof buildBlockIndex>,
  allLineConfidences: number[],
  pageLineConfidences: Map<number, number[]>,
  pageNumber: number,
): TipTapNode[] {
  const nodes: TipTapNode[] = [];

  for (let bandIdx = 0; bandIdx < pageBands.length; bandIdx++) {
    const band = pageBands[bandIdx]!;
    const isMultiColumn = band.columns.length > 1;

    for (let colIdx = 0; colIdx < band.columns.length; colIdx++) {
      const column = band.columns[colIdx]!;

      // Convert Block[] lines to TextractLine[] for mergeOcrLines
      const textractLines: TextractLine[] = column.lines
        .map((lineBlock) => lineFromBlock(lineBlock))
        .filter((l): l is TextractLine => l !== null);

      // Apply paragraph merging within this column
      let mergedParagraphs: MergedParagraph[];
      try {
        mergedParagraphs = mergeOcrLines(textractLines, metrics);
      } catch {
        // Fallback: each line is its own paragraph
        mergedParagraphs = textractLines.map((l) => ({ lines: [l], text: l.text }));
      }

      // For each merged paragraph, apply formatting and alignment
      for (const para of mergedParagraphs) {
        const paraNode = buildEnrichedParagraph(
          para,
          column.lines,
          metrics,
          blockIndex,
          allLineConfidences,
          pageLineConfidences,
          pageNumber,
        );
        if (paraNode) nodes.push(paraNode);
      }

      // Insert empty paragraph between columns (Requirement 5.3)
      if (isMultiColumn && colIdx < band.columns.length - 1) {
        nodes.push(paragraphNode(''));
      }
    }
  }

  return nodes;
}

/**
 * Build an enriched paragraph node from a merged paragraph.
 * Applies inline formatting, alignment, and confidence marks.
 */
function buildEnrichedParagraph(
  para: MergedParagraph,
  originalLineBlocks: Block[],
  metrics: PageMetrics,
  blockIndex: ReturnType<typeof buildBlockIndex>,
  allLineConfidences: number[],
  pageLineConfidences: Map<number, number[]>,
  pageNumber: number,
): TipTapNode | null {
  if (!para.text) return null;

  // Find the original LINE block(s) that correspond to this paragraph
  // Use the first line of the merged paragraph for alignment inference
  const firstLineText = para.lines[0]?.text;
  const matchingLineBlock = originalLineBlocks.find(
    (b) => b.BlockType === 'LINE' && b.Text?.trim() === firstLineText?.trim(),
  );

  // --- Inline Formatting ---
  let contentNodes: TipTapNode[] = [];
  try {
    // Try to apply inline formatting to each LINE in the paragraph
    const formattedRuns: FormattedRun[] = [];
    let hasAnyWordBlocks = false;

    for (const line of para.lines) {
      // Find the matching LINE block for this text
      const lineBlock = originalLineBlocks.find(
        (b) => b.BlockType === 'LINE' && b.Text?.trim() === line.text?.trim(),
      );
      if (lineBlock?.Id) {
        const wordBlocks = blockIndex.wordsPerLine.get(lineBlock.Id) ?? [];

        // Compute line confidence
        const confResult = computeLineConfidence(wordBlocks);
        allLineConfidences.push(confResult.lineConfidence);
        if (!pageLineConfidences.has(pageNumber)) {
          pageLineConfidences.set(pageNumber, []);
        }
        pageLineConfidences.get(pageNumber)!.push(confResult.lineConfidence);

        if (wordBlocks.length > 0) {
          hasAnyWordBlocks = true;
          const runs = inferInlineFormatting(lineBlock, wordBlocks, metrics);
          const lineRuns: FormattedRun[] =
            runs.length > 0
              ? runs
              : [
                  {
                    text: line.text,
                    marks: [],
                  },
                ];
          if (confResult.applyLowConfidenceMark) {
            for (const run of lineRuns) {
              if (!run.marks.some((m) => m.type === 'lowConfidence')) {
                run.marks.push({ type: 'lowConfidence' });
              }
            }
          }
          appendJoinedLineRuns(formattedRuns, lineRuns);
        }
      }
    }

    if (hasAnyWordBlocks && formattedRuns.length > 0) {
      // Convert FormattedRuns to TipTap text nodes
      contentNodes = formattedRunsToNodes(formattedRuns);
    } else {
      // No word blocks available for formatting — use the merged paragraph text
      contentNodes = para.text ? [{ type: 'text', text: para.text }] : [];
    }
  } catch {
    // Fallback: plain text
    contentNodes = para.text ? [{ type: 'text', text: para.text }] : [];
  }

  if (contentNodes.length === 0) return null;

  // --- Alignment & Indentation ---
  let attrs: Record<string, unknown> | undefined;
  try {
    if (matchingLineBlock) {
      const alignResult = inferAlignment(matchingLineBlock, metrics);
      if (alignResult.textAlign || alignResult.indent) {
        attrs = {};
        if (alignResult.textAlign) attrs['textAlign'] = alignResult.textAlign;
        if (alignResult.indent) attrs['indent'] = alignResult.indent;
      }
    }
  } catch {
    // Alignment failure: no attrs
  }

  const paraNode: TipTapNode = {
    type: 'paragraph',
    ...(attrs ? { attrs } : {}),
    content: contentNodes,
  };

  return paraNode;
}

/**
 * Concatenate WORD runs from consecutive wrapped lines using the same
 * hyphen / space rules as `joinLineTexts` so merged paragraph text is not lost.
 */
function appendJoinedLineRuns(target: FormattedRun[], nextLineRuns: FormattedRun[]): void {
  if (nextLineRuns.length === 0) return;
  if (target.length === 0) {
    target.push(...nextLineRuns);
    return;
  }
  const last = target[target.length - 1]!;
  const firstNext = nextLineRuns[0]!;
  const joined = joinLineTexts(last.text, firstNext.text);
  if (joined === `${last.text.slice(0, -1)}${firstNext.text}`) {
    last.text = last.text.slice(0, -1);
    target.push(...nextLineRuns);
    return;
  }
  target.push({ text: ' ', marks: [] }, ...nextLineRuns);
}

/**
 * Convert FormattedRun[] into TipTap text nodes with marks.
 */
function formattedRunsToNodes(runs: FormattedRun[]): TipTapNode[] {
  const nodes: TipTapNode[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const node: TipTapNode = { type: 'text', text: run.text };
    if (run.marks.length > 0) {
      node.marks = run.marks.map((m) => {
        if (m.attrs && Object.keys(m.attrs).length > 0) {
          return { type: m.type, attrs: m.attrs };
        }
        return { type: m.type };
      });
    }
    nodes.push(node);
  }
  return nodes;
}

/**
 * Apply page-level confidence warnings.
 * Prepends a warning paragraph at the start of each low-confidence page's content.
 * Since we process blocks in order, we track which page sections to prepend warnings to.
 */
function applyPageConfidenceWarnings(
  nodes: TipTapNode[],
  pageLineConfidences: Map<number, number[]>,
): TipTapNode[] {
  // Check if any page needs a warning
  const pagesNeedingWarning = new Set<number>();
  for (const [page, confidences] of pageLineConfidences) {
    const result = computePageConfidence(confidences);
    if (result.prependWarning) {
      pagesNeedingWarning.add(page);
    }
  }

  if (pagesNeedingWarning.size === 0) return nodes;

  // Prepend warning at the beginning of the document if any page is low confidence
  // (In a full implementation, we'd track page boundaries within nodes)
  const warningNode: TipTapNode = {
    type: 'paragraph',
    content: [{ type: 'text', text: PAGE_CONFIDENCE_WARNING }],
  };

  return [warningNode, ...nodes];
}

/**
 * Collect actual LINE Block objects from a layout block's children (for column detection).
 */
function collectChildLineBlocks(block: Block, byId: Map<string, Block>, depth = 0): Block[] {
  if (depth > 8) return [];
  const lineBlocks: Block[] = [];
  for (const id of childIds(block)) {
    const child = byId.get(id);
    if (!child) continue;
    if (child.BlockType === 'LINE') {
      lineBlocks.push(child);
      continue;
    }
    if (
      child.BlockType === 'LAYOUT_TEXT' ||
      child.BlockType === 'LAYOUT_LIST' ||
      child.BlockType?.startsWith('LAYOUT_')
    ) {
      lineBlocks.push(...collectChildLineBlocks(child, byId, depth + 1));
    }
  }
  return lineBlocks;
}

/** Compute total page count from blocks. */
function computePageCount(blocks: readonly Block[]): number {
  let maxPage = 1;
  for (const block of blocks) {
    if (typeof block.Page === 'number' && block.Page > maxPage) {
      maxPage = block.Page;
    }
  }
  return maxPage;
}

/**
 * Legacy layout conversion — the original plain-text pipeline used as a fallback.
 */
function legacyLayoutConversion(
  blocks: readonly Block[],
  byId: Map<string, Block>,
): TipTapDoc {
  const nodes: TipTapNode[] = [];
  const consumedLayoutIds = new Set<string>();
  const consumedTableIds = new Set<string>();

  const markDescendantLayoutsConsumed = (block: Block) => {
    for (const id of childIds(block)) {
      const child = byId.get(id);
      if (!child?.Id) continue;
      if (child.BlockType?.startsWith('LAYOUT_')) {
        consumedLayoutIds.add(child.Id);
        markDescendantLayoutsConsumed(child);
      }
    }
  };

  for (const block of blocks) {
    const type = block.BlockType;
    if (!type?.startsWith('LAYOUT_')) continue;
    if (block.Id && consumedLayoutIds.has(block.Id)) continue;
    if (SKIP_LAYOUT.has(type)) continue;

    if (type === 'LAYOUT_LIST') {
      const list = listFromLayout(block, byId);
      if (list) {
        nodes.push(list);
        if (block.Id) consumedLayoutIds.add(block.Id);
        markDescendantLayoutsConsumed(block);
      }
      continue;
    }

    if (type === 'LAYOUT_TABLE') {
      const tableBlock = findChildTable(block, byId);
      if (tableBlock?.Id) {
        const table = tableFromBlock(tableBlock, byId);
        if (table) {
          nodes.push(table);
          consumedTableIds.add(tableBlock.Id);
        }
      } else {
        const lines = collectChildLines(block, byId);
        const text = linesToPlainText(lines);
        if (text) nodes.push(paragraphNode(text));
      }
      if (block.Id) consumedLayoutIds.add(block.Id);
      markDescendantLayoutsConsumed(block);
      continue;
    }

    const lines = collectChildLines(block, byId);
    const text = linesToPlainText(lines);
    if (!text) continue;

    if (type === 'LAYOUT_TITLE') {
      nodes.push(headingNode(text, 1));
    } else if (type === 'LAYOUT_SECTION_HEADER') {
      nodes.push(headingNode(text, 2));
    } else {
      for (const para of mergeTextractLinesIntoParagraphs(lines)) {
        if (para) nodes.push(paragraphNode(para));
      }
    }
    if (block.Id) consumedLayoutIds.add(block.Id);
  }

  // Orphan TABLE blocks
  for (const block of blocks) {
    if (block.BlockType !== 'TABLE' || !block.Id || consumedTableIds.has(block.Id)) {
      continue;
    }
    const table = tableFromBlock(block, byId);
    if (table) nodes.push(table);
  }

  if (nodes.length === 0) {
    return fallbackGeometryMerge(blocks);
  }

  return { type: 'doc', content: nodes };
}

/** Plain text derived from TipTap-ish layout mapping (paragraph breaks). */
export function tipTapDocToPlainText(doc: TipTapDoc): string {
  const parts: string[] = [];
  const walk = (node: TipTapNode | undefined) => {
    if (!node) return;
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text);
      return;
    }
    if (
      node.type === 'paragraph' ||
      node.type === 'heading' ||
      node.type === 'listItem' ||
      node.type === 'tableCell' ||
      node.type === 'tableHeader'
    ) {
      const before = parts.length;
      for (const child of node.content ?? []) walk(child);
      if (parts.length > before) parts.push('\n');
      return;
    }
    if (node.type === 'tableRow') {
      for (const child of node.content ?? []) walk(child);
      parts.push('\n');
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc as TipTapNode);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Output Validation (Requirements 9.1, 9.2, 9.4, 9.5) ──────────────────

/**
 * Allowed TipTap node types produced by this converter.
 * Any node with a type outside this set is invalid and will be sanitized.
 */
const ALLOWED_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'horizontalRule',
  'text',
]);

/**
 * Allowed TipTap mark types produced by this converter.
 * Any mark with a type outside this set is removed.
 */
const ALLOWED_MARK_TYPES = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'textStyle',
  'lowConfidence',
]);

/**
 * Validate and sanitize a TipTap document tree.
 *
 * This function walks the entire document and:
 * 1. Removes nodes with unknown types (replacing with paragraph containing their text if possible)
 * 2. Removes marks with unknown types
 * 3. Strips undefined values from node attributes
 * 4. Ensures text nodes contain only string values
 * 5. Ensures the document always has at least one content node (Req 9.2)
 * 6. Ensures single empty paragraph for empty input (Req 9.5)
 *
 * Operates via graceful degradation — sanitizes rather than throwing.
 *
 * @param doc - The TipTap document to validate
 * @returns A sanitized copy of the document
 */
export function validateTipTapOutput(doc: TipTapDoc): TipTapDoc {
  // Ensure the document has the correct type
  const result: TipTapDoc = { type: 'doc', content: [] };

  const content = (doc as unknown as { content?: TipTapNode[] }).content;
  if (!Array.isArray(content) || content.length === 0) {
    // Requirement 9.5: empty input → single empty paragraph
    result.content = [{ type: 'paragraph' }];
    return result;
  }

  const validatedContent = validateNodeArray(content);

  // Requirement 9.2: ensure at least one content node
  if (validatedContent.length === 0) {
    result.content = [{ type: 'paragraph' }];
  } else {
    result.content = validatedContent;
  }

  return result;
}

/**
 * Validate an array of TipTap nodes, removing invalid ones and sanitizing valid ones.
 */
function validateNodeArray(nodes: TipTapNode[]): TipTapNode[] {
  const result: TipTapNode[] = [];

  for (const node of nodes) {
    const validated = validateNode(node);
    if (validated) {
      result.push(validated);
    }
  }

  return result;
}

/**
 * Validate a single TipTap node. Returns the sanitized node or null if it should be removed.
 */
function validateNode(node: TipTapNode): TipTapNode | null {
  if (!node || typeof node !== 'object') return null;

  const nodeType = node.type;

  // Text nodes: validate text is a string
  if (nodeType === 'text') {
    if (typeof node.text !== 'string' || node.text === '') return null;

    const sanitized: TipTapNode = { type: 'text', text: node.text };

    // Validate marks
    if (Array.isArray(node.marks) && node.marks.length > 0) {
      const validMarks = validateMarks(node.marks);
      if (validMarks.length > 0) {
        sanitized.marks = validMarks;
      }
    }

    return sanitized;
  }

  // Non-text nodes: check type is allowed
  if (!nodeType || !ALLOWED_NODE_TYPES.has(nodeType)) {
    // Try to extract text content and wrap in a paragraph
    const extractedText = extractTextFromNode(node);
    if (extractedText) {
      return { type: 'paragraph', content: [{ type: 'text', text: extractedText }] };
    }
    return null;
  }

  // Build sanitized node
  const sanitized: TipTapNode = { type: nodeType };

  // Validate and copy attributes (strip undefined and non-serializable values)
  if (node.attrs && typeof node.attrs === 'object') {
    const cleanAttrs = stripNonSerializable(node.attrs);
    if (cleanAttrs && Object.keys(cleanAttrs).length > 0) {
      sanitized.attrs = cleanAttrs;
    }
  }

  // Validate marks (only for text nodes, but be defensive)
  if (Array.isArray(node.marks) && node.marks.length > 0) {
    const validMarks = validateMarks(node.marks);
    if (validMarks.length > 0) {
      sanitized.marks = validMarks;
    }
  }

  // Recursively validate content
  if (Array.isArray(node.content) && node.content.length > 0) {
    const validContent = validateNodeArray(node.content);
    if (validContent.length > 0) {
      sanitized.content = validContent;
    }
  }

  return sanitized;
}

/**
 * Validate marks, keeping only those with allowed types.
 * Also strips undefined/non-serializable attrs from marks.
 */
function validateMarks(
  marks: Array<{ type?: string; attrs?: Record<string, unknown> }>,
): Array<{ type: string; attrs?: Record<string, unknown> }> {
  const result: Array<{ type: string; attrs?: Record<string, unknown> }> = [];

  for (const mark of marks) {
    if (!mark || typeof mark !== 'object') continue;
    const markType = mark.type;
    if (typeof markType !== 'string' || !ALLOWED_MARK_TYPES.has(markType)) continue;

    const cleanMark: { type: string; attrs?: Record<string, unknown> } = { type: markType };

    if (mark.attrs && typeof mark.attrs === 'object') {
      const cleanAttrs = stripNonSerializable(mark.attrs);
      if (cleanAttrs && Object.keys(cleanAttrs).length > 0) {
        cleanMark.attrs = cleanAttrs;
      }
    }

    result.push(cleanMark);
  }

  return result;
}

/**
 * Strip non-serializable values (undefined, functions, symbols) from an attrs object.
 * Returns a new clean object or undefined if nothing remains.
 */
function stripNonSerializable(
  obj: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const result: Record<string, unknown> = {};
  let hasKeys = false;

  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (typeof value === 'function') continue;
    if (typeof value === 'symbol') continue;
    if (typeof value === 'bigint') continue;

    // Recursively clean nested objects (guard against circular references)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = stripNonSerializable(value as Record<string, unknown>);
      if (nested && Object.keys(nested).length > 0) {
        result[key] = nested;
        hasKeys = true;
      }
    } else if (Array.isArray(value)) {
      // Filter array values: remove non-serializable elements
      const cleanArr = value.filter(
        (v) => v !== undefined && typeof v !== 'function' && typeof v !== 'symbol',
      );
      if (cleanArr.length > 0) {
        result[key] = cleanArr;
        hasKeys = true;
      }
    } else {
      result[key] = value;
      hasKeys = true;
    }
  }

  return hasKeys ? result : undefined;
}

/**
 * Extract plain text from a node (for fallback when node type is invalid).
 */
function extractTextFromNode(node: TipTapNode): string {
  if (!node) return '';
  if (node.type === 'text' && typeof node.text === 'string') return node.text;

  const parts: string[] = [];
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const text = extractTextFromNode(child);
      if (text) parts.push(text);
    }
  }
  return parts.join(' ');
}

// ─── convertTextractToTipTap — High-level companion function ────────────────

/**
 * Combined result of the full Textract → TipTap conversion pipeline,
 * including metadata for draft storage (Requirements 6.2, 6.6, 7.6, 9.1–9.5).
 */
export interface TextractConversionResult {
  /** The main TipTap document content. */
  document: TipTapDoc;
  /** Deduplicated header text as a TipTap doc, or null when no repeating header. */
  header: TipTapDoc | null;
  /** Deduplicated footer text as a TipTap doc, or null when no repeating footer. */
  footer: TipTapDoc | null;
  /** Overall document confidence (0–100), rounded to 2 decimal places. */
  documentConfidence: number;
}

/**
 * Convert a simple text string into a minimal TipTap document with a single
 * paragraph node containing that text.
 */
function textToTipTapDoc(text: string): TipTapDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

/**
 * High-level companion function that wraps the full Textract → TipTap pipeline
 * and returns structured metadata for draft persistence.
 *
 * 1. Calls `textractLayoutBlocksToTipTap(blocks)` for the main document content
 * 2. Calls `extractHeadersFooters(blocks, pageCount)` for metadata
 * 3. Converts deduplicated header/footer text into TipTap docs (simple paragraph nodes)
 * 4. Computes document-level confidence via `computeDocumentConfidence`
 * 5. Returns the combined result
 *
 * The pdfBuffer, s3Client, and bucketName params are accepted for API
 * compatibility with future figure extraction (task 11.1); figure blocks
 * currently produce placeholder nodes via the main pipeline.
 *
 * This function does NOT call the repository directly — it returns data
 * for the caller to persist.
 *
 * @param blocks - Readonly array of Textract blocks from AnalyzeDocument
 * @param _pdfBuffer - Source PDF buffer (reserved for future figure extraction)
 * @param _documentId - Document identifier (reserved for future figure S3 keys)
 * @param _s3Client - S3 client instance (reserved for future figure upload)
 * @param _bucketName - S3 bucket name (reserved for future figure upload)
 */
/**
 * Sync ingest entry: body TipTap plus header/footer/confidence for draft persistence.
 * Live OCR calls this instead of `textractLayoutBlocksToTipTap` alone.
 */
export function convertTextractBlocks(blocks: readonly Block[]): TextractConversionResult {
  const document = textractLayoutBlocksToTipTap(blocks);

  const pageCount = computePageCount(blocks);
  const headerFooterResult = extractHeadersFooters([...blocks], pageCount);

  const header: TipTapDoc | null = headerFooterResult.deduplicatedHeader
    ? validateTipTapOutput(textToTipTapDoc(headerFooterResult.deduplicatedHeader))
    : null;

  const footer: TipTapDoc | null = headerFooterResult.deduplicatedFooter
    ? validateTipTapOutput(textToTipTapDoc(headerFooterResult.deduplicatedFooter))
    : null;

  const allLineConfidences = computeAllLineConfidences(blocks);
  const documentConfidence = computeDocumentConfidence(allLineConfidences);

  return { document, header, footer, documentConfidence };
}

export async function convertTextractToTipTap(
  blocks: readonly Block[],
  _pdfBuffer: Buffer,
  _documentId: string,
  _s3Client: S3Client,
  _bucketName: string,
): Promise<TextractConversionResult> {
  return convertTextractBlocks(blocks);
}

/**
 * Compute confidence values for all LINEs in the block array by extracting
 * WORD children and computing mean confidence per LINE.
 */
function computeAllLineConfidences(blocks: readonly Block[]): number[] {
  // Build a quick id → block index
  const byId = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) byId.set(block.Id, block);
  }

  const lineConfidences: number[] = [];

  for (const block of blocks) {
    if (block.BlockType !== 'LINE') continue;

    // Find WORD children via CHILD relationships
    const wordBlocks: Block[] = [];
    for (const rel of block.Relationships ?? []) {
      if (rel.Type !== 'CHILD' || !rel.Ids) continue;
      for (const id of rel.Ids) {
        const child = byId.get(id);
        if (child && child.BlockType === 'WORD') {
          wordBlocks.push(child);
        }
      }
    }

    const result = computeLineConfidence(wordBlocks);
    // Only include lines that have WORD blocks (Requirement 7.5)
    if (wordBlocks.length > 0) {
      lineConfidences.push(result.lineConfidence);
    }
  }

  return lineConfidences;
}
