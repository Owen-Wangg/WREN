/**
 * Browser-side PDF → TipTap mapping (best-effort Scope B).
 *
 * Uses pdfjs-dist text items:
 * - Paragraphs via Y-gap grouping
 * - Bold/italic heuristics from font names
 * - Bullet/number prefixes → list nodes
 * - Simple multi-column line grids → tables when column counts align
 */
import type { JSONContent } from '@tiptap/react';

type PdfTextItem = {
  str: string;
  transform?: number[];
  fontName?: string;
  width?: number;
};

type LineRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  x: number;
};

type Line = {
  y: number;
  runs: LineRun[];
  text: string;
};

function fontFlags(fontName: string | undefined): { bold: boolean; italic: boolean } {
  const name = (fontName ?? '').toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi/.test(name),
    italic: /italic|oblique/.test(name),
  };
}

function runsToTextNodes(runs: LineRun[]): JSONContent[] {
  return runs
    .filter((r) => r.text.length > 0)
    .map((r) => {
      const marks: NonNullable<JSONContent['marks']> = [];
      if (r.bold) marks.push({ type: 'bold' });
      if (r.italic) marks.push({ type: 'italic' });
      return {
        type: 'text' as const,
        text: r.text,
        ...(marks.length > 0 ? { marks } : {}),
      };
    });
}

function lineToParagraph(line: Line): JSONContent {
  const content = runsToTextNodes(line.runs);
  return {
    type: 'paragraph',
    content: content.length > 0 ? content : undefined,
  };
}

const BULLET_RE = /^[\u2022\u2023\u25E6\u2043\u2219•·▪‣*-]\s+/;
const NUMBERED_RE = /^(\d+[\.)]|[a-zA-Z][\.)]|[ivxlcdmIVXLCDM]+[\.)])\s+/;

function tryListItem(line: Line): JSONContent | null {
  const raw = line.text.trim();
  const bullet = BULLET_RE.exec(raw);
  const numbered = NUMBERED_RE.exec(raw);
  if (!bullet && !numbered) return null;

  const prefixLen = (bullet?.[0] ?? numbered?.[0] ?? '').length;
  let remaining = raw.slice(prefixLen);
  // Rebuild runs roughly by stripping prefix from first run.
  const runs = line.runs.map((r, idx) => {
    if (idx !== 0) return r;
    const stripped = r.text.replace(BULLET_RE, '').replace(NUMBERED_RE, '');
    return { ...r, text: stripped };
  });
  if (!remaining) remaining = runs.map((r) => r.text).join('').trim();

  return {
    type: numbered ? 'orderedList' : 'bulletList',
    content: [
      {
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: runsToTextNodes(
              runs.map((r, idx) =>
                idx === 0 ? { ...r, text: remaining || r.text } : r,
              ),
            ),
          },
        ],
      },
    ],
  };
}

/**
 * Detect a contiguous block of lines that share the same multi-column layout.
 * Returns null unless at least 2 rows × 2 columns look aligned.
 */
function tryTableBlock(lines: Line[], start: number): { table: JSONContent; end: number } | null {
  const splitLine = (line: Line): string[] => {
    if (line.runs.length >= 2) {
      const sorted = [...line.runs].sort((a, b) => a.x - b.x);
      const gaps: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        gaps.push(sorted[i]!.x - (sorted[i - 1]!.x + (sorted[i - 1]!.text.length * 4)));
      }
      const largeGap = gaps.some((g) => g > 24);
      if (largeGap) {
        return sorted.map((r) => r.text.trim()).filter(Boolean);
      }
    }
    // Fallback: split on 2+ spaces
    const parts = line.text.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
    return parts.length >= 2 ? parts : [];
  };

  const firstCols = splitLine(lines[start]!);
  if (firstCols.length < 2) return null;

  const rows: string[][] = [firstCols];
  let i = start + 1;
  while (i < lines.length) {
    const cols = splitLine(lines[i]!);
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

function mergeAdjacentLists(blocks: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
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

export async function pdfBytesToTiptapContent(bytes: Uint8Array): Promise<JSONContent> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const lines: Line[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    let current: Line | null = null;

    for (const raw of textContent.items) {
      if (!('str' in raw)) continue;
      const item = raw as PdfTextItem;
      if (!item.str) continue;
      const y = item.transform?.[5] ?? 0;
      const x = item.transform?.[4] ?? 0;
      const flags = fontFlags(item.fontName);
      const run: LineRun = {
        text: item.str,
        bold: flags.bold,
        italic: flags.italic,
        x,
      };

      if (current && Math.abs(y - current.y) <= 3) {
        current.runs.push(run);
        current.text += item.str;
      } else {
        if (current && current.text.trim()) lines.push(current);
        current = { y, runs: [run], text: item.str };
      }
    }
    if (current && current.text.trim()) lines.push(current);
  }

  const blocks: JSONContent[] = [];
  let i = 0;
  while (i < lines.length) {
    const table = tryTableBlock(lines, i);
    if (table) {
      blocks.push(table.table);
      i = table.end;
      continue;
    }

    const line = lines[i]!;
    const list = tryListItem(line);
    if (list) {
      blocks.push(list);
      i += 1;
      continue;
    }

    blocks.push(lineToParagraph(line));
    i += 1;
  }

  const merged = mergeAdjacentLists(blocks);
  return {
    type: 'doc',
    content: merged.length > 0 ? merged : [{ type: 'paragraph' }],
  };
}
