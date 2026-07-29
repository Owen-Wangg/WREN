/**
 * Convert LiteParse spatial text items into TipTap JSONContent (Scope B+).
 *
 * Heuristics (4A): soft-wrap paragraph merging, font-name marks, font-size +
 * style headings, non-heading fontSize textStyle marks, x-based indent,
 * nested lists, column-clustered tables with cell marks.
 * Optional LiteParse extras (color / underline / strike) pass through when
 * present; paragraph/heading textAlign is inferred from geometry.
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
  /** Hex or CSS color when the extractor provides it. */
  color?: string;
  underline?: boolean;
  strike?: boolean;
  backgroundColor?: string;
}

export interface SpatialPage {
  textItems: SpatialTextItem[];
}

type LineRun = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color?: string;
  backgroundColor?: string;
  x: number;
  width: number;
  fontSize: number;
};

type Line = {
  y: number;
  runs: LineRun[];
  text: string;
  maxFontSize: number;
  minX: number;
};

/** One logical table row: cells as rich runs (not flattened strings). */
type TableRowCells = LineRun[][];

const MAX_INDENT_LEVEL = 8;
/** Fallback indent step when page metrics are unavailable (legacy PDF units). */
const INDENT_GAP_FALLBACK = 28;
/** Attach fontSize mark when run differs from body median by this ratio. */
const FONT_SIZE_MARK_RATIO = 1.12;
/** Soft-wrap: max vertical gap between lines of the same paragraph (× median size). */
const SOFT_WRAP_GAP_RATIO = 1.85;
/** Paragraph break: gap larger than this (× median size) always starts a new block. */
const PARAGRAPH_BREAK_GAP_RATIO = 2.4;

/** Per-document horizontal thresholds derived from page width + body font size. */
type LayoutScale = {
  /** One indent / list-nest step in PDF units. */
  indentGap: number;
  /** Minimum gap after a run's right edge to start a new table column. */
  columnGap: number;
  /** Cluster run X positions into the same column within this tolerance. */
  columnCluster: number;
};

type ContentBounds = { left: number; width: number };

function estimateContentBounds(lines: Line[]): ContentBounds {
  let maxRight = 0;
  let minLeft = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    minLeft = Math.min(minLeft, line.minX);
    for (const run of line.runs) {
      maxRight = Math.max(maxRight, run.x + run.width);
    }
  }
  if (!Number.isFinite(minLeft) || maxRight <= minLeft) {
    return { left: 0, width: Math.max(maxRight, 200) };
  }
  return { left: minLeft, width: maxRight - minLeft };
}

/**
 * Infer center/right alignment from margins vs the page content box.
 * Full-width lines stay default (left). Only helps when geometry is clear.
 */
function inferTextAlign(
  line: Line,
  bounds: ContentBounds,
): 'center' | 'right' | undefined {
  if (bounds.width < 40) return undefined;
  const lineRight = line.runs.reduce(
    (max, r) => Math.max(max, r.x + r.width),
    line.minX,
  );
  const lineWidth = Math.max(0, lineRight - line.minX);
  if (lineWidth < 8) return undefined;
  // Nearly full-width → leave default left.
  if (lineWidth / bounds.width > 0.85) return undefined;

  const leftMargin = line.minX - bounds.left;
  const rightMargin = bounds.left + bounds.width - lineRight;
  const centerSlack = Math.abs(leftMargin - rightMargin);
  const edgeTol = Math.max(8, bounds.width * 0.04);

  if (centerSlack <= edgeTol && leftMargin > bounds.width * 0.12) {
    return 'center';
  }
  if (rightMargin <= edgeTol && leftMargin > bounds.width * 0.2) {
    return 'right';
  }
  return undefined;
}

/**
 * Normalize indent/list/table gaps so letter-size vs large-format (or zoomed
 * OCR coordinates) use proportional steps instead of a fixed 28pt heuristic.
 */
function resolveLayoutScale(lines: Line[], medianFontSize: number): LayoutScale {
  const body = medianFontSize > 0 ? medianFontSize : 12;
  const contentWidth = Math.max(estimateContentBounds(lines).width, body * 20, 160);
  const fromFont = body * 2.2;
  const fromPage = contentWidth * 0.035;
  const indentGap = Math.min(56, Math.max(12, (fromFont + fromPage) / 2));
  return {
    indentGap,
    columnGap: Math.max(indentGap, body * 1.8),
    columnCluster: Math.max(10, indentGap * 0.65),
  };
}

function fontFlags(fontName: string | undefined): {
  bold: boolean;
  italic: boolean;
  underline: boolean;
} {
  const name = (fontName ?? '').toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi/.test(name),
    italic: /italic|oblique/.test(name),
    underline: /underline|underscored/.test(name),
  };
}

/** Normalize extractor colors to `#rrggbb` when possible. */
export function normalizePdfColor(color: string | undefined | null): string | undefined {
  if (!color || typeof color !== 'string') return undefined;
  const trimmed = color.trim();
  if (!trimmed || /^auto$/i.test(trimmed) || /^transparent$/i.test(trimmed)) {
    return undefined;
  }
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const [r, g, b] = hex.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return `#${hex.slice(0, 6).toLowerCase()}`;
  // rgb(r,g,b)
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (rgb) {
    const toHex = (n: string) =>
      Math.max(0, Math.min(255, Number.parseInt(n, 10)))
        .toString(16)
        .padStart(2, '0');
    return `#${toHex(rgb[1]!)}${toHex(rgb[2]!)}${toHex(rgb[3]!)}`;
  }
  return undefined;
}

function runsToTextNodes(
  runs: LineRun[],
  medianFontSize: number,
  attachSizeMarks: boolean,
): TipTapNode[] {
  return runs
    .filter((r) => r.text.length > 0)
    .map((r) => {
      const marks: NonNullable<TipTapNode['marks']> = [];
      if (r.bold) marks.push({ type: 'bold' });
      if (r.italic) marks.push({ type: 'italic' });
      if (r.underline) marks.push({ type: 'underline' });
      if (r.strike) marks.push({ type: 'strike' });

      const textStyleAttrs: Record<string, string> = {};
      if (
        attachSizeMarks &&
        medianFontSize > 0 &&
        Math.abs(r.fontSize - medianFontSize) / medianFontSize >= FONT_SIZE_MARK_RATIO - 1
      ) {
        textStyleAttrs.fontSize = `${Math.round(r.fontSize)}pt`;
      }
      const color = normalizePdfColor(r.color);
      if (color) textStyleAttrs.color = color;
      const backgroundColor = normalizePdfColor(r.backgroundColor);
      if (backgroundColor) textStyleAttrs.backgroundColor = backgroundColor;

      if (Object.keys(textStyleAttrs).length > 0) {
        marks.push({ type: 'textStyle', attrs: textStyleAttrs });
      }
      return {
        type: 'text',
        text: r.text,
        ...(marks.length > 0 ? { marks } : {}),
      };
    });
}

/** Drop fontSize from textStyle (heading level already encodes size) but keep color. */
function stripFontSizeMarks(nodes: TipTapNode[]): TipTapNode[] | undefined {
  if (nodes.length === 0) return undefined;
  return nodes.map((n) => {
    if (!n.marks) return n;
    const marks = n.marks
      .map((m) => {
        if (m.type !== 'textStyle' || !m.attrs) return m;
        const { fontSize: _drop, ...rest } = m.attrs as Record<string, unknown>;
        if (Object.keys(rest).length === 0) return null;
        return { type: 'textStyle' as const, attrs: rest };
      })
      .filter((m): m is NonNullable<typeof m> => m != null);
    return marks.length > 0 ? { ...n, marks } : { type: n.type, text: n.text };
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
      underline: Boolean(item.underline) || flags.underline,
      strike: Boolean(item.strike),
      color: item.color,
      backgroundColor: item.backgroundColor,
      x: item.x,
      width: item.width > 0 ? item.width : Math.max(1, item.text.length * fontSize * 0.5),
      fontSize,
    };

    if (current && Math.abs(item.y - current.y) <= Math.max(3, fontSize * 0.35)) {
      current.runs.push(run);
      current.text += item.text;
      current.maxFontSize = Math.max(current.maxFontSize, fontSize);
      current.minX = Math.min(current.minX, item.x);
    } else {
      if (current) lines.push(current);
      current = {
        y: item.y,
        runs: [run],
        text: item.text,
        maxFontSize: fontSize,
        minX: item.x,
      };
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Glyph bullets + common OCR stand-ins ("o ", "O ", hollow/square).
const BULLET_RE =
  /^(?:[\u2022\u2023\u25E6\u2043\u2219•·▪‣*◦○●■□-]|(?:o|O)(?=\s))\s*/;
// Numbered / lettered / roman — require a following space so "A.Long" stays prose.
const NUMBERED_RE = /^(\d+[\.)]|[a-zA-Z][\.)]|[ivxlcdmIVXLCDM]+[\.)])\s+/;

function isListLine(line: Line): { kind: 'bullet' | 'ordered'; remaining: string } | null {
  const raw = line.text.trim();
  const bullet = BULLET_RE.exec(raw);
  if (bullet) {
    const remaining = raw.slice(bullet[0].length).trim();
    // Lone bullet glyph with no body — still a list item.
    return { kind: 'bullet', remaining };
  }

  const numbered = NUMBERED_RE.exec(raw);
  if (!numbered) return null;

  const prefix = numbered[1] ?? '';
  const remaining = raw.slice(numbered[0].length).trim();

  // Letter markers like "A." often start prose sentences in OCR output.
  // Keep them as lists only when the item looks short / outline-like.
  if (/^[a-zA-Z][\.)]$/.test(prefix) && wordCount(remaining) > 18) {
    return null;
  }

  return { kind: 'ordered', remaining };
}

function lineIndentLevel(line: Line, baselineX: number, indentGap = INDENT_GAP_FALLBACK): number {
  const gap = indentGap > 0 ? indentGap : INDENT_GAP_FALLBACK;
  const delta = line.minX - baselineX;
  if (delta < gap * 0.6) return 0;
  return Math.min(MAX_INDENT_LEVEL, Math.max(0, Math.round(delta / gap)));
}

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function lineBoldRatio(line: Line): number {
  const total = line.runs.reduce((n, r) => n + r.text.length, 0);
  if (total === 0) return 0;
  const bold = line.runs.reduce((n, r) => n + (r.bold ? r.text.length : 0), 0);
  return bold / total;
}

function isAllCapsHeadingText(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase();
}

/**
 * Heading level 1–3, or null for body. Size ratios first; then short bold /
 * ALL CAPS lines when the PDF uses a flat type size.
 */
function headingLevelForLine(line: Line, medianFontSize: number): number | null {
  if (isListLine(line)) return null;

  const text = line.text.trim();
  if (text.length === 0) return null;

  if (line.maxFontSize >= medianFontSize * 1.35) {
    if (line.maxFontSize >= medianFontSize * 1.8) return 1;
    if (line.maxFontSize >= medianFontSize * 1.5) return 2;
    return 3;
  }

  // Flat-size PDFs: short, non-sentence lines that are mostly bold or ALL CAPS.
  const words = wordCount(text);
  const short = text.length <= 90 && words <= 12 && !/[.!?].*\s/.test(text);
  if (!short) return null;

  const boldHeavy = lineBoldRatio(line) >= 0.75;
  const caps = isAllCapsHeadingText(text);
  if (!boldHeavy && !caps) return null;

  // Avoid promoting long bold body lead-ins.
  if (words > 10 && !caps) return null;

  if (caps && (boldHeavy || words <= 8)) {
    return line.maxFontSize >= medianFontSize * 1.1 ? 1 : 2;
  }
  if (boldHeavy) {
    return line.maxFontSize >= medianFontSize * 1.12 ? 2 : 3;
  }
  return null;
}

function listItemNode(
  line: Line,
  remaining: string,
  medianFontSize: number,
): TipTapNode {
  const runs = line.runs.map((r, idx) =>
    idx === 0
      ? {
          ...r,
          text: r.text.replace(BULLET_RE, '').replace(NUMBERED_RE, ''),
        }
      : r,
  );
  const contentRuns =
    remaining.length > 0
      ? [{ ...runs[0]!, text: remaining }, ...runs.slice(1)]
      : runs;

  return {
    type: 'listItem',
    content: [
      {
        type: 'paragraph',
        content: runsToTextNodes(contentRuns, medianFontSize, true),
      },
    ],
  };
}

/**
 * Consume consecutive list lines starting at `start`, nesting by x-indent depth.
 */
function consumeNestedList(
  lines: Line[],
  start: number,
  baselineX: number,
  medianFontSize: number,
  parentDepth: number,
  listKind: 'bullet' | 'ordered',
  indentGap: number,
): { block: TipTapNode; end: number } {
  const listType = listKind === 'ordered' ? 'orderedList' : 'bulletList';
  const items: TipTapNode[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    const list = isListLine(line);
    if (!list || list.kind !== listKind) break;

    const depth = lineIndentLevel(line, baselineX, indentGap);
    if (depth < parentDepth) break;

    if (depth > parentDepth) {
      const nested = consumeNestedList(
        lines,
        i,
        baselineX,
        medianFontSize,
        depth,
        listKind,
        indentGap,
      );
      const prev = items[items.length - 1];
      if (prev) {
        prev.content = [...(prev.content ?? []), nested.block];
      } else {
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph' }, nested.block],
        });
      }
      i = nested.end;
      continue;
    }

    items.push(listItemNode(line, list.remaining, medianFontSize));
    i += 1;
  }

  return {
    block: { type: listType, content: items },
    end: i,
  };
}

/** Gap from previous run's right edge to this run's left. */
function runGap(prev: LineRun, next: LineRun): number {
  return next.x - (prev.x + prev.width);
}

/**
 * Split a line into column cells by large gaps after run widths.
 * Falls back to 2+ space splits when runs are glued into one item.
 */
function splitColumnRuns(line: Line, scale: LayoutScale): LineRun[][] {
  const sorted = [...line.runs].sort((a, b) => a.x - b.x);
  if (sorted.length >= 2) {
    const cells: LineRun[][] = [[sorted[0]!]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const gap = runGap(prev, cur);
      const threshold = Math.max(scale.columnGap, prev.fontSize * 1.6);
      if (gap > threshold) {
        cells.push([cur]);
      } else {
        cells[cells.length - 1]!.push(cur);
      }
    }
    if (cells.length >= 2) return cells;
  }

  const parts = line.text.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [];
  // Single-run fallback: approximate cells as plain runs (no per-cell marks).
  return parts.map((text, idx) => [
    {
      text,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      x: line.minX + idx * 50,
      width: Math.max(1, text.length * 6),
      fontSize: line.maxFontSize,
    },
  ]);
}

function clusterXs(xs: number[], clusterTolerance: number): number[] {
  if (xs.length === 0) return [];
  const sorted = [...xs].sort((a, b) => a - b);
  const clusters: number[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i++) {
    const x = sorted[i]!;
    const cluster = clusters[clusters.length - 1]!;
    const centroid = cluster.reduce((a, b) => a + b, 0) / cluster.length;
    if (Math.abs(x - centroid) <= clusterTolerance) {
      cluster.push(x);
    } else {
      clusters.push([x]);
    }
  }
  return clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}

function assignRunsToColumns(line: Line, columnXs: number[]): LineRun[][] {
  const cells: LineRun[][] = columnXs.map(() => []);
  const sorted = [...line.runs].sort((a, b) => a.x - b.x);
  for (const run of sorted) {
    let best = 0;
    let bestDist = Infinity;
    for (let c = 0; c < columnXs.length; c++) {
      const d = Math.abs(run.x - columnXs[c]!);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    cells[best]!.push(run);
  }
  return cells;
}

function tryTableBlock(
  lines: Line[],
  start: number,
  medianFontSize: number,
  scale: LayoutScale,
): { table: TipTapNode; end: number } | null {
  const firstCells = splitColumnRuns(lines[start]!, scale);
  if (firstCells.length < 2) return null;

  // Gather a window of multi-column rows (allow slight column-count jitter).
  const rawRows: Line[] = [lines[start]!];
  let i = start + 1;
  while (i < lines.length) {
    const cols = splitColumnRuns(lines[i]!, scale);
    if (cols.length < 2) break;
    // Stop if column count diverges wildly (not the same table).
    if (Math.abs(cols.length - firstCells.length) > 1) break;
    rawRows.push(lines[i]!);
    i += 1;
  }
  if (rawRows.length < 2) return null;

  const allXs = rawRows.flatMap((row) =>
    splitColumnRuns(row, scale).map((cell) => cell[0]?.x ?? row.minX),
  );
  const columnXs = clusterXs(allXs, scale.columnCluster);
  if (columnXs.length < 2) return null;

  const rows: TableRowCells[] = rawRows.map((row) => assignRunsToColumns(row, columnXs));

  return {
    end: i,
    table: {
      type: 'table',
      content: rows.map((cells, rowIndex) => ({
        type: 'tableRow',
        content: cells.map((cellRuns) => {
          const joined =
            cellRuns.length > 0
              ? cellRuns
              : [
                  {
                    text: '',
                    bold: false,
                    italic: false,
                    underline: false,
                    strike: false,
                    x: 0,
                    width: 0,
                    fontSize: medianFontSize,
                  },
                ];
          const content = runsToTextNodes(joined, medianFontSize, false);
          return {
            type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
            content: [
              {
                type: 'paragraph',
                content: content.length > 0 ? content : undefined,
              },
            ],
          };
        }),
      })),
    },
  };
}

function endsWithHyphen(text: string): boolean {
  return /[A-Za-z]-$/.test(text.trimEnd());
}

function endsSentence(text: string): boolean {
  return /[.!?]["')\]]*$/.test(text.trimEnd());
}

/**
 * True when `next` continues `prev` as a soft-wrapped paragraph line.
 */
function shouldMergeSoftWrap(
  prev: Line,
  next: Line,
  medianFontSize: number,
  baselineX: number,
  indentGap: number,
): boolean {
  if (isListLine(prev) || isListLine(next)) return false;
  if (headingLevelForLine(prev, medianFontSize) != null) return false;
  if (headingLevelForLine(next, medianFontSize) != null) return false;

  // Table-ish lines: defer to scale at call site via a wide column gap check.
  const probeScale: LayoutScale = {
    indentGap,
    columnGap: Math.max(indentGap, medianFontSize * 1.8),
    columnCluster: Math.max(10, indentGap * 0.65),
  };
  if (
    splitColumnRuns(prev, probeScale).length >= 2 ||
    splitColumnRuns(next, probeScale).length >= 2
  ) {
    return false;
  }

  if (lineIndentLevel(prev, baselineX, indentGap) !== lineIndentLevel(next, baselineX, indentGap)) {
    return false;
  }
  if (Math.abs(prev.minX - next.minX) > indentGap * 0.55) return false;

  // Similar body size — don't glue a caption onto body.
  if (
    medianFontSize > 0 &&
    Math.abs(prev.maxFontSize - next.maxFontSize) / medianFontSize > 0.25
  ) {
    return false;
  }

  const gap = next.y - prev.y;
  if (gap <= 0) return false;
  if (gap > medianFontSize * PARAGRAPH_BREAK_GAP_RATIO) return false;
  if (gap > medianFontSize * SOFT_WRAP_GAP_RATIO && endsSentence(prev.text)) return false;

  if (endsWithHyphen(prev.text)) return true;
  if (!endsSentence(prev.text)) return true;

  // Sentence ended but lines are still tightly stacked — treat as wrap only
  // when the previous line looks truncated (rely on tight gap).
  return gap <= medianFontSize * 1.35;
}

function trimTrailingHyphen(runs: LineRun[]): LineRun[] {
  if (runs.length === 0) return runs;
  const out = runs.map((r) => ({ ...r }));
  const last = out[out.length - 1]!;
  last.text = last.text.replace(/([A-Za-z])-$/, '$1');
  return out;
}

function mergeSoftWrappedLines(
  lines: Line[],
  medianFontSize: number,
  baselineX: number,
  indentGap: number,
): Line[] {
  const out: Line[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev && shouldMergeSoftWrap(prev, line, medianFontSize, baselineX, indentGap)) {
      const hyphenated = endsWithHyphen(prev.text);
      let prevRuns = hyphenated ? trimTrailingHyphen(prev.runs) : prev.runs.map((r) => ({ ...r }));
      const nextRuns = line.runs.map((r) => ({ ...r }));

      if (!hyphenated && nextRuns.length > 0) {
        const first = nextRuns[0]!;
        if (!first.text.startsWith(' ') && !prevRuns[prevRuns.length - 1]?.text.endsWith(' ')) {
          nextRuns[0] = { ...first, text: ` ${first.text}` };
        }
      }

      prev.runs = [...prevRuns, ...nextRuns];
      prev.text = hyphenated
        ? prev.text.trimEnd().replace(/([A-Za-z])-$/, '$1') + line.text.trimStart()
        : `${prev.text.trimEnd()} ${line.text.trimStart()}`;
      prev.maxFontSize = Math.max(prev.maxFontSize, line.maxFontSize);
      prev.minX = Math.min(prev.minX, line.minX);
      // Keep earliest y so table/list ordering stays stable.
    } else {
      out.push({
        ...line,
        runs: line.runs.map((r) => ({ ...r })),
      });
    }
  }
  return out;
}

function lineToBlock(
  line: Line,
  medianFontSize: number,
  baselineX: number,
  indentGap: number,
  bounds: ContentBounds,
): TipTapNode {
  const content = runsToTextNodes(line.runs, medianFontSize, true);
  const indent = lineIndentLevel(line, baselineX, indentGap);
  const align = inferTextAlign(line, bounds);
  const attrs: Record<string, unknown> = {
    ...(indent > 0 ? { indent } : {}),
    ...(align ? { textAlign: align } : {}),
  };
  const hasAttrs = Object.keys(attrs).length > 0;
  const level = headingLevelForLine(line, medianFontSize);

  if (level != null) {
    return {
      type: 'heading',
      attrs: { level, ...attrs },
      content: stripFontSizeMarks(content),
    };
  }

  return {
    type: 'paragraph',
    ...(hasAttrs ? { attrs } : {}),
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx]!;
}

/** Build a TipTap doc from LiteParse-style pages of spatial text items. */
export function spatialPagesToTipTap(pages: SpatialPage[]): TipTapDoc {
  const allItems = pages.flatMap((p) => p.textItems ?? []);
  const rawLines = itemsToLines(allItems);
  if (rawLines.length === 0) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }

  const sizes = rawLines.map((l) => l.maxFontSize).sort((a, b) => a - b);
  // Lower median so a single large title still counts as a heading vs body.
  const medianFontSize = sizes[Math.floor((sizes.length - 1) / 2)] ?? 12;

  const minXs = rawLines.map((l) => l.minX).sort((a, b) => a - b);
  const baselineX = percentile(minXs, 0.1);
  const scale = resolveLayoutScale(rawLines, medianFontSize);
  const bounds = estimateContentBounds(rawLines);

  const lines = mergeSoftWrappedLines(rawLines, medianFontSize, baselineX, scale.indentGap);

  const blocks: TipTapNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const table = tryTableBlock(lines, i, medianFontSize, scale);
    if (table) {
      blocks.push(table.table);
      i = table.end;
      continue;
    }

    const listInfo = isListLine(lines[i]!);
    if (listInfo) {
      const depth = lineIndentLevel(lines[i]!, baselineX, scale.indentGap);
      const nested = consumeNestedList(
        lines,
        i,
        baselineX,
        medianFontSize,
        depth,
        listInfo.kind,
        scale.indentGap,
      );
      blocks.push(nested.block);
      i = nested.end;
      continue;
    }

    blocks.push(lineToBlock(lines[i]!, medianFontSize, baselineX, scale.indentGap, bounds));
    i += 1;
  }

  const merged = mergeAdjacentLists(blocks);
  return {
    type: 'doc',
    content: merged.length > 0 ? merged : [{ type: 'paragraph' }],
  };
}
