/**
 * Map Amazon Textract AnalyzeDocument LAYOUT (+ TABLES) blocks into TipTap JSON.
 *
 * Layout elements arrive in reading order. CHILD relationships point at LINE
 * blocks (or nested LAYOUT_TEXT for lists / TABLE for tables).
 */
import type { Block } from '@aws-sdk/client-textract';
import type { TipTapDoc, TipTapNode } from '@wren/types';

import {
  mergeTextractLinesIntoParagraphs,
  type TextractLine,
} from './textractLines.js';

const SKIP_LAYOUT = new Set([
  'LAYOUT_HEADER',
  'LAYOUT_FOOTER',
  'LAYOUT_PAGE_NUMBER',
  'LAYOUT_FIGURE',
]);

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

function tableFromBlock(table: Block, byId: Map<string, Block>): TipTapNode | null {
  const cells: Array<{
    row: number;
    col: number;
    rowSpan: number;
    colSpan: number;
    text: string;
    isHeader: boolean;
  }> = [];

  for (const id of childIds(table)) {
    const child = byId.get(id);
    if (!child || (child.BlockType !== 'CELL' && child.BlockType !== 'MERGED_CELL')) {
      continue;
    }
    const row = child.RowIndex ?? 0;
    const col = child.ColumnIndex ?? 0;
    if (row < 1 || col < 1) continue;
    cells.push({
      row,
      col,
      rowSpan: child.RowSpan ?? 1,
      colSpan: child.ColumnSpan ?? 1,
      text: cellText(child, byId),
      isHeader: (child.EntityTypes ?? []).includes('COLUMN_HEADER'),
    });
  }

  if (cells.length === 0) return null;

  const maxRow = Math.max(...cells.map((c) => c.row));
  const maxCol = Math.max(...cells.map((c) => c.col + c.colSpan - 1));
  const byRowCol = new Map(cells.map((c) => [`${c.row}:${c.col}`, c]));

  const rows: TipTapNode[] = [];
  for (let r = 1; r <= maxRow; r++) {
    const rowCells: TipTapNode[] = [];
    for (let c = 1; c <= maxCol; c++) {
      const cell = byRowCol.get(`${r}:${c}`);
      if (!cell) {
        // Covered by a prior colspan/rowspan — TipTap still wants a cell per grid
        // slot only for present cells; skip missing to avoid empty phantom cells
        // when Textract omits sparse indexes.
        continue;
      }
      const cellType = cell.isHeader || r === 1 ? 'tableHeader' : 'tableCell';
      rowCells.push({
        type: cellType,
        content: [paragraphNode(cell.text)],
      });
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
 * Falls back to geometry line-merge when no layout elements are present.
 */
export function textractLayoutBlocksToTipTap(blocks: readonly Block[]): TipTapDoc {
  const byId = indexBlocks(blocks);
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

  // Orphan TABLE blocks not linked from LAYOUT_TABLE
  for (const block of blocks) {
    if (block.BlockType !== 'TABLE' || !block.Id || consumedTableIds.has(block.Id)) {
      continue;
    }
    const table = tableFromBlock(block, byId);
    if (table) nodes.push(table);
  }

  if (nodes.length === 0) {
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
