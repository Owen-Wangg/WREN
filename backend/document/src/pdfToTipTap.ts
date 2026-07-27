/**
 * Convert LiteParse spatial text items into TipTap JSONContent (Scope B).
 *
 * Heuristics (4A): Y-gap paragraphs, font-name marks, font-size headings,
 * bullet/number lists, aligned multi-column rows → simple tables.
 */
import type { TipTapDoc, TipTapNode } from '@wren/types';

export interface SpatialTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  fontSize?: number;
}

export interface SpatialPage {
  textItems: SpatialTextItem[];
}

type LineRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  x: number;
  fontSize: number;
};

type Line = {
  y: number;
  runs: LineRun[];
  text: string;
  maxFontSize: number;
};

function fontFlags(fontName: string | undefined): { bold: boolean; italic: boolean } {
  const name = (fontName ?? '').toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi/.test(name),
    italic: /italic|oblique/.test(name),
  };
}

function runsToTextNodes(runs: LineRun[]): TipTapNode[] {
  return runs
    .filter((r) => r.text.length > 0)
    .map((r) => {
      const marks: NonNullable<TipTapNode['marks']> = [];
      if (r.bold) marks.push({ type: 'bold' });
      if (r.italic) marks.push({ type: 'italic' });
      return {
        type: 'text',
        text: r.text,
        ...(marks.length > 0 ? { marks } : {}),
      };
    });
}

function itemsToLines(items: SpatialTextItem[]): Line[] {
  const sorted = [...items]
    .filter((i) => i.text.trim().length > 0)
    .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));

  const lines: Line[] = [];
  let current: Line | null = null;

  for (const item of sorted) {
    const flags = fontFlags(item.fontName);
    const fontSize = item.fontSize && item.fontSize > 0 ? item.fontSize : item.height || 12;
    const run: LineRun = {
      text: item.text,
      bold: flags.bold,
      italic: flags.italic,
      x: item.x,
      fontSize,
    };

    if (current && Math.abs(item.y - current.y) <= Math.max(3, fontSize * 0.35)) {
      current.runs.push(run);
      current.text += item.text;
      current.maxFontSize = Math.max(current.maxFontSize, fontSize);
    } else {
      if (current) lines.push(current);
      current = {
        y: item.y,
        runs: [run],
        text: item.text,
        maxFontSize: fontSize,
      };
    }
  }
  if (current) lines.push(current);
  return lines;
}

const BULLET_RE = /^[\u2022\u2023\u25E6\u2043\u2219•·▪‣*-]\s+/;
const NUMBERED_RE = /^(\d+[\.)]|[a-zA-Z][\.)]|[ivxlcdmIVXLCDM]+[\.)])\s+/;

function tryListItem(line: Line): TipTapNode | null {
  const raw = line.text.trim();
  const bullet = BULLET_RE.exec(raw);
  const numbered = NUMBERED_RE.exec(raw);
  if (!bullet && !numbered) return null;

  const remaining = raw
    .replace(BULLET_RE, '')
    .replace(NUMBERED_RE, '')
    .trim();
  const runs = line.runs.map((r, idx) =>
    idx === 0
      ? {
          ...r,
          text: r.text.replace(BULLET_RE, '').replace(NUMBERED_RE, ''),
        }
      : r,
  );

  return {
    type: numbered ? 'orderedList' : 'bulletList',
    content: [
      {
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: runsToTextNodes(
              remaining
                ? [{ ...runs[0]!, text: remaining }, ...runs.slice(1)]
                : runs,
            ),
          },
        ],
      },
    ],
  };
}

function splitColumns(line: Line): string[] {
  if (line.runs.length >= 2) {
    const sorted = [...line.runs].sort((a, b) => a.x - b.x);
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i]!.x - sorted[i - 1]!.x);
    }
    // Absolute gap threshold — relative-to-median fails when only one large gap exists.
    if (gaps.some((g) => g > 40)) {
      return sorted.map((r) => r.text.trim()).filter(Boolean);
    }
  }
  const parts = line.text.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : [];
}

function tryTableBlock(
  lines: Line[],
  start: number,
): { table: TipTapNode; end: number } | null {
  const firstCols = splitColumns(lines[start]!);
  if (firstCols.length < 2) return null;

  const rows: string[][] = [firstCols];
  let i = start + 1;
  while (i < lines.length) {
    const cols = splitColumns(lines[i]!);
    if (cols.length !== firstCols.length) break;
    rows.push(cols);
    i += 1;
  }
  if (rows.length < 2) return null;

  return {
    end: i,
    table: {
      type: 'table',
      content: rows.map((cols, rowIndex) => ({
        type: 'tableRow',
        content: cols.map((text) => ({
          type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
          content: [
            {
              type: 'paragraph',
              content: text ? [{ type: 'text', text }] : undefined,
            },
          ],
        })),
      })),
    },
  };
}

function lineToBlock(line: Line, medianFontSize: number): TipTapNode {
  const list = tryListItem(line);
  if (list) return list;

  const content = runsToTextNodes(line.runs);
  if (line.maxFontSize >= medianFontSize * 1.35) {
    const level =
      line.maxFontSize >= medianFontSize * 1.8
        ? 1
        : line.maxFontSize >= medianFontSize * 1.5
          ? 2
          : 3;
    return {
      type: 'heading',
      attrs: { level },
      content: content.length > 0 ? content : undefined,
    };
  }

  return {
    type: 'paragraph',
    content: content.length > 0 ? content : undefined,
  };
}

function mergeAdjacentLists(blocks: TipTapNode[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const block of blocks) {
    const prev = out[out.length - 1];
    if (
      prev &&
      (block.type === 'bulletList' || block.type === 'orderedList') &&
      prev.type === block.type
    ) {
      prev.content = [...(prev.content ?? []), ...(block.content ?? [])];
    } else {
      out.push(block);
    }
  }
  return out;
}

/** Build a TipTap doc from LiteParse-style pages of spatial text items. */
export function spatialPagesToTipTap(pages: SpatialPage[]): TipTapDoc {
  const allItems = pages.flatMap((p) => p.textItems ?? []);
  const lines = itemsToLines(allItems);
  if (lines.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }

  const sizes = lines.map((l) => l.maxFontSize).sort((a, b) => a - b);
  // Lower median so a single large title still counts as a heading vs body.
  const medianFontSize = sizes[Math.floor((sizes.length - 1) / 2)] ?? 12;

  const blocks: TipTapNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const table = tryTableBlock(lines, i);
    if (table) {
      blocks.push(table.table);
      i = table.end;
      continue;
    }
    blocks.push(lineToBlock(lines[i]!, medianFontSize));
    i += 1;
  }

  const merged = mergeAdjacentLists(blocks);
  return {
    type: 'doc',
    content: merged.length > 0 ? merged : [{ type: 'paragraph' }],
  };
}
