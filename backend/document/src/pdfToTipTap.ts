/**
 * Convert spatial text items into TipTap JSONContent (Scope B+).
 *
 * Heuristics (4A): soft-wrap paragraph merging, font-name marks, font-size +
 * style headings, non-heading fontSize textStyle marks, x-based indent,
 * nested lists, column-clustered tables with cell marks.
 * Optional extras (color / underline / strike) pass through when
 * present; paragraph/heading textAlign is inferred from geometry.
 */
import type { TipTapDoc, TipTapNode } from '@wren/types';

import {
  headingLevelFromPlainText,
  isAllCapsHeadingText,
  isTocTitle,
  looksLikeBodyCopy,
  looksLikeStandaloneHeading,
  wordCount,
} from './pdfHeadingHeuristics';
import {
  bandIndex,
  cellAt,
  detectRuledTables,
  type PageRulings,
  type RuledTable,
} from './pdfRuledTables';
import {
  formatOrderedMarker,
  orderedListAttrs,
  orderedListStart,
  parseListMarker,
  type ListMarker,
} from './listMarkers';
import { filterWatermarkPages } from './pdfWatermarks';

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
  /** Non-whitespace text-layer characters (excluding stamps / rotated margin text). */
  textChars?: number;
  /**
   * Fraction of the page area painted by images (0–1). Undefined when the
   * operator list was unavailable; callers then classify by text alone.
   */
  imageCoverage?: number;
  /** Table-border rulings painted on the page (digital text layer only). */
  rulings?: PageRulings;
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
/** Match the editor toolbar max so letterhead/logo lines cannot blow up the page. */
const MAX_INLINE_FONT_SIZE_PT = 36;
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
  if (lineWidth / bounds.width > 0.75) return undefined;

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
        textStyleAttrs.fontSize = `${Math.round(Math.min(r.fontSize, MAX_INLINE_FONT_SIZE_PT))}pt`;
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

/** Closing punctuation stays glued to the previous word. Straight quotes are handled separately. */
const NO_SPACE_BEFORE = /^[.,;:!?%)\]}’”/-]/;
/** Opening punctuation stays glued to the following word. */
const NO_SPACE_AFTER = /[(\[{‘“-]$/;
const CONTRACTION_NEXT = /^'(?:s|t|re|ve|ll|d|m)$/i;

function isStraightQuote(ch: string | undefined): boolean {
  return ch === '"' || ch === "'";
}

function needsSpaceBetween(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  if (/\s$/.test(prev) || /^\s/.test(next)) return false;

  const prevTrim = prev.trimEnd();
  const nextTrim = next.trimStart();
  const prevEnd = prevTrim[prevTrim.length - 1];
  const nextStart = nextTrim[0];

  if (CONTRACTION_NEXT.test(nextTrim) && /[A-Za-z]$/.test(prevTrim)) {
    return false;
  }
  if (isStraightQuote(nextStart) && /[A-Za-z0-9]$/.test(prevTrim)) {
    return nextTrim.length > 1;
  }
  if (isStraightQuote(prevEnd) && /^[A-Za-z0-9]/.test(nextTrim)) {
    return prevTrim.length > 1;
  }
  if (NO_SPACE_BEFORE.test(nextTrim)) return false;
  if (NO_SPACE_AFTER.test(prevTrim)) return false;
  return true;
}

/**
 * Reconstruct a missing space between same-line PDF items. Per-character
 * glyphs have a tiny gap; word items whose space glyph was omitted have a
 * larger gap (or a bad/zero width that we estimated).
 */
function spacerForAdjacentRuns(prev: LineRun, next: LineRun): string {
  if (!needsSpaceBetween(prev.text, next.text)) return '';
  const gap = next.x - (prev.x + prev.width);
  const em = Math.max(prev.fontSize, next.fontSize, 1);
  if (gap > em * 0.12) return ' ';
  const prevWord = prev.text.trim();
  const nextWord = next.text.trim();
  if (
    gap >= -em * 0.35 &&
    ((/[A-Za-z0-9]$/.test(prevWord) && /^["']/.test(nextWord) && nextWord.length > 1) ||
      (/["']$/.test(prevWord) && prevWord.length > 1 && /^[A-Za-z0-9]/.test(nextWord)))
  ) {
    return ' ';
  }
  if (
    gap >= -em * 0.35 &&
    prevWord.length >= 2 &&
    nextWord.length >= 2 &&
    /[A-Za-z0-9]$/.test(prevWord) &&
    /^[A-Za-z0-9]/.test(nextWord)
  ) {
    return ' ';
  }
  return '';
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
      const prev = current.runs[current.runs.length - 1];
      const spacer = prev ? spacerForAdjacentRuns(prev, run) : '';
      const spacedRun = spacer ? { ...run, text: spacer + run.text } : run;
      current.runs.push(spacedRun);
      current.text += spacedRun.text;
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

function isListLine(line: Line): ListMarker | null {
  // Lone bullet glyph with no body — still a list item.
  const marker = parseListMarker(line.text.trim());
  if (!marker || marker.kind === 'bullet') return marker;

  // Letter markers like "A." often start prose sentences in OCR output.
  // Keep them as lists only when the item looks short / outline-like.
  if (/^[a-zA-Z][\.)]\s*$/.test(marker.marker) && wordCount(marker.remaining) > 18) {
    return null;
  }

  return marker;
}

/**
 * Drop the first `count` characters (after leading whitespace) from `runs`,
 * spanning run boundaries — the list marker is often its own text item.
 */
function stripLeadingChars(runs: LineRun[], count: number): LineRun[] {
  const out: LineRun[] = [];
  let toDrop = count;
  let leading = true;
  for (const run of runs) {
    let text = run.text;
    if (leading) text = text.trimStart();
    const dropped = Math.min(toDrop, text.length);
    text = text.slice(dropped);
    toDrop -= dropped;
    if (toDrop === 0 && leading) text = text.trimStart();
    if (text.length === 0) continue;
    leading = false;
    out.push({ ...run, text });
  }
  return out;
}

function lineIndentLevel(line: Line, baselineX: number, indentGap = INDENT_GAP_FALLBACK): number {
  const gap = indentGap > 0 ? indentGap : INDENT_GAP_FALLBACK;
  const delta = line.minX - baselineX;
  if (delta < gap * 0.6) return 0;
  return Math.min(MAX_INDENT_LEVEL, Math.max(0, Math.round(delta / gap)));
}

function lineBoldRatio(line: Line): number {
  const total = line.runs.reduce((n, r) => n + r.text.length, 0);
  if (total === 0) return 0;
  const bold = line.runs.reduce((n, r) => n + (r.bold ? r.text.length : 0), 0);
  return bold / total;
}

/**
 * Heading level 1–3, or null for body. Size ratios first; then TOC / judgment
 * titles, short bold, or ALL CAPS lines when the PDF uses a flat type size.
 */
function headingLevelForLine(line: Line, medianFontSize: number): number | null {
  if (isListLine(line)) return null;

  const text = line.text.trim();
  if (text.length === 0) return null;

  const structural = headingLevelFromPlainText(text);
  if (structural != null) return structural;

  // A long / multi-sentence line is body copy, never a heading — even if it
  // happens to be set in a larger-than-median font. Mirrors the Textract path.
  if (looksLikeBodyCopy(text)) return null;

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

/**
 * True when `headingLevelForLine` promotes a line *only* because its font is
 * larger than the body median — not because it is a structural / TOC / caps /
 * bold-short heading. Such a "soft" size-heading is often just one visual line
 * of a body paragraph that happens to be set in a larger-than-median font; the
 * fragments must stay mergeable so the whole paragraph reassembles as body
 * copy instead of rendering as a run of giant headings. See
 * {@link shouldMergeSoftWrap}.
 */
function isSizeOnlyHeadingLine(line: Line, medianFontSize: number): boolean {
  if (headingLevelForLine(line, medianFontSize) == null) return false;
  if (isListLine(line)) return false;
  const text = line.text.trim();
  // Structural titles (TOC / judgment) and standalone ALL-CAPS lines are hard
  // headings regardless of size.
  if (headingLevelFromPlainText(text) != null) return false;
  if (looksLikeStandaloneHeading(text)) return false;
  if (isAllCapsHeadingText(text)) return false;
  // Short bold lines are intentional headings in flat-size PDFs.
  if (lineBoldRatio(line) >= 0.75) return false;
  // Whatever is left is a heading purely due to the size-ratio branch.
  return true;
}

function listItemNode(line: Line, marker: ListMarker, medianFontSize: number): TipTapNode {
  // Strip the marker from the runs themselves: rebuilding the item from the
  // line-level `remaining` text would repeat every run after the first.
  const contentRuns = stripLeadingChars(line.runs, marker.marker.trimEnd().length);

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

/** A standalone table-of-contents leader target, e.g. "12". */
const BARE_PAGE_NUMBER_RE = /^\d{1,4}$/;

/**
 * Consume consecutive list lines starting at `start`, nesting by x-indent depth.
 * Deeper lines nest under the previous item whatever their marker kind, so a
 * bulleted sub-list does not split (and renumber) its numbered parent list.
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
  let firstOrdered: Extract<ListMarker, { kind: 'ordered' }> | undefined;
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    const list = isListLine(line);
    if (!list) break;

    const depth = lineIndentLevel(line, baselineX, indentGap);
    if (depth < parentDepth) break;

    if (depth > parentDepth) {
      const nested = consumeNestedList(
        lines,
        i,
        baselineX,
        medianFontSize,
        depth,
        list.kind,
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

    if (list.kind !== listKind) break;
    if (list.kind === 'ordered' && items.length === 0) firstOrdered = list;
    items.push(listItemNode(line, list, medianFontSize));
    i += 1;
  }

  const attrs = listType === 'orderedList' ? orderedListAttrs(firstOrdered) : undefined;
  return {
    block: { type: listType, ...(attrs ? { attrs } : {}), content: items },
    end: i,
  };
}

/** Gap from previous run's right edge to this run's left. */
function runGap(prev: LineRun, next: LineRun): number {
  return next.x - (prev.x + prev.width);
}

/**
 * Relaxed column gap (× font size) for a row whose cells all line up with a
 * table's established columns. Well above a word space, so prose never splits.
 */
const ALIGNED_COLUMN_GAP_RATIO = 0.9;

function lineRight(line: Line): number {
  return line.runs.reduce((max, r) => Math.max(max, r.x + r.width), line.minX);
}

/**
 * Split a line into column cells by large gaps after run widths.
 * Falls back to 2+ space splits when runs are glued into one item.
 * `minGap` overrides the page-scale threshold (used only for rows already
 * known to align with a table's columns).
 */
function splitColumnRuns(line: Line, scale: LayoutScale, minGap?: number): LineRun[][] {
  const sorted = [...line.runs].sort((a, b) => a.x - b.x);
  if (sorted.length >= 2) {
    const cells: LineRun[][] = [[sorted[0]!]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const gap = runGap(prev, cur);
      const threshold = minGap ?? Math.max(scale.columnGap, prev.fontSize * 1.6);
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
  // Single-run fallback: approximate cells as plain runs (no per-cell marks),
  // positioned by character offset so column clustering stays meaningful.
  const perChar = line.text.length > 0 ? (lineRight(line) - line.minX) / line.text.length : 6;
  let from = 0;
  return parts.map((text) => {
    const at = Math.max(0, line.text.indexOf(text, from));
    from = at + text.length;
    return [
      {
        text,
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        x: line.minX + at * perChar,
        width: Math.max(1, text.length * perChar),
        fontSize: line.maxFontSize,
      },
    ];
  });
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

/**
 * Assign each run to the right-most column starting at or before it. Nearest
 * column start would push the later words of a long left-aligned cell into
 * the next column.
 */
function assignRunsToColumns(line: Line, columnXs: number[], tolerance: number): LineRun[][] {
  const cells: LineRun[][] = columnXs.map(() => []);
  const sorted = [...line.runs].sort((a, b) => a.x - b.x);
  for (const run of sorted) {
    let best = 0;
    for (let c = 0; c < columnXs.length; c++) {
      if (columnXs[c]! <= run.x + tolerance) best = c;
    }
    cells[best]!.push(run);
  }
  return cells;
}

function cellStarts(cells: LineRun[][], fallbackX: number): number[] {
  return cells.map((cell) => cell[0]?.x ?? fallbackX);
}

/** True when every cell starts on one of the table's known columns. */
function alignsToColumns(cells: LineRun[][], columnXs: number[], tolerance: number): boolean {
  return cells.every((cell) =>
    columnXs.some((x) => Math.abs((cell[0]?.x ?? Number.NaN) - x) <= tolerance),
  );
}

/**
 * Column index a single-column line continues (wrapped cell text), or -1.
 * The line must sit tightly below the previous table line, start on a known
 * column, and end before the next column so body prose is never absorbed.
 */
function continuationColumn(
  line: Line,
  prev: Line,
  columnXs: number[],
  scale: LayoutScale,
): number {
  const gap = line.y - prev.y;
  if (gap <= 0 || gap > line.maxFontSize * SOFT_WRAP_GAP_RATIO) return -1;
  const col = columnXs.findIndex((x) => Math.abs(line.minX - x) <= scale.columnCluster);
  if (col < 0) return -1;
  const nextX = columnXs[col + 1];
  if (nextX !== undefined && lineRight(line) > nextX - scale.columnCluster / 2) return -1;
  return col;
}

/** Append wrapped cell text, de-hyphenating or inserting the line-break space. */
function appendWrappedRuns(target: LineRun[], next: LineRun[]): void {
  if (next.length === 0) return;
  const lastText = target.map((r) => r.text).join('');
  if (target.length === 0) {
    target.push(...next);
    return;
  }
  const copy = next.map((r) => ({ ...r }));
  if (endsWithHyphen(lastText)) {
    target.splice(0, target.length, ...trimTrailingHyphen(target));
  } else if (!copy[0]!.text.startsWith(' ') && !lastText.endsWith(' ')) {
    copy[0] = { ...copy[0]!, text: ` ${copy[0]!.text}` };
  }
  target.push(...copy);
}

/**
 * True when two consecutive lines both split at the relaxed gap into the same
 * columns: a tightly spaced table, since prose with an occasional wide space
 * never lines up like that twice in a row.
 */
function relaxedColumnsAlign(a: Line, b: Line, scale: LayoutScale): boolean {
  const aCells = splitColumnRuns(a, scale, a.maxFontSize * ALIGNED_COLUMN_GAP_RATIO);
  if (aCells.length < 2) return false;
  const bCells = splitColumnRuns(b, scale, b.maxFontSize * ALIGNED_COLUMN_GAP_RATIO);
  return (
    bCells.length === aCells.length &&
    alignsToColumns(bCells, cellStarts(aCells, a.minX), scale.columnCluster)
  );
}

/** Copy of a cell's runs without the inter-run spacer at its edges. */
function trimCellRuns(runs: LineRun[]): LineRun[] {
  const out = runs.map((r) => ({ ...r }));
  if (out[0]) out[0].text = out[0].text.trimStart();
  const last = out[out.length - 1];
  if (last) last.text = last.text.trimEnd();
  return out.filter((r) => r.text.length > 0);
}

type RawTableRow = { line: Line; continuations: Line[] };

function tryTableBlock(
  lines: Line[],
  start: number,
  medianFontSize: number,
  scale: LayoutScale,
): { table: TipTapNode; end: number } | null {
  const first = lines[start]!;
  let firstCells = splitColumnRuns(first, scale);
  if (firstCells.length < 2) {
    const next = lines[start + 1];
    if (!next || !relaxedColumnsAlign(first, next, scale)) return null;
    firstCells = splitColumnRuns(first, scale, first.maxFontSize * ALIGNED_COLUMN_GAP_RATIO);
  }

  // Gather rows: multi-column lines, plus wrapped cell text continuing a row.
  const rawRows: RawTableRow[] = [{ line: first, continuations: [] }];
  const starts = cellStarts(firstCells, first.minX);
  let columnXs = clusterXs(starts, scale.columnCluster);
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i]!;
    let cols = splitColumnRuns(line, scale);
    if (cols.length < 2) {
      // Tightly spaced columns: accept a smaller gap when it lands on known columns.
      const relaxed = splitColumnRuns(line, scale, line.maxFontSize * ALIGNED_COLUMN_GAP_RATIO);
      if (relaxed.length >= 2 && alignsToColumns(relaxed, columnXs, scale.columnCluster)) {
        cols = relaxed;
      }
    }

    if (cols.length >= 2) {
      // Stop if column count diverges wildly and the cells do not line up
      // with the columns seen so far (not the same table).
      if (
        Math.abs(cols.length - columnXs.length) > 1 &&
        !alignsToColumns(cols, columnXs, scale.columnCluster)
      ) {
        break;
      }
      rawRows.push({ line, continuations: [] });
      starts.push(...cellStarts(cols, line.minX));
      columnXs = clusterXs(starts, scale.columnCluster);
      i += 1;
      continue;
    }

    const row = rawRows[rawRows.length - 1]!;
    const prev = row.continuations[row.continuations.length - 1] ?? row.line;
    if (continuationColumn(line, prev, columnXs, scale) < 0) break;
    row.continuations.push(line);
    i += 1;
  }
  if (rawRows.length < 2) return null;
  if (columnXs.length < 2) return null;

  const rows: TableRowCells[] = rawRows.map((row) => {
    const cells = assignRunsToColumns(row.line, columnXs, scale.columnCluster);
    for (const cont of row.continuations) {
      assignRunsToColumns(cont, columnXs, scale.columnCluster).forEach((runs, c) =>
        appendWrappedRuns(cells[c]!, runs),
      );
    }
    return cells.map(trimCellRuns);
  });

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
  // Block merging across a genuine heading, but allow a line that is a heading
  // *only* because of its larger font to merge with another same-size
  // size-heading: a body paragraph set in a larger font arrives as short
  // fragments that would each be promoted and then render as giant headings.
  // Merging them back into one line lets the combined text read as body copy.
  // The font-size similarity guard below keeps a genuinely larger real heading
  // from absorbing smaller body lines.
  if (
    headingLevelForLine(prev, medianFontSize) != null &&
    !isSizeOnlyHeadingLine(prev, medianFontSize)
  ) {
    return false;
  }
  if (
    headingLevelForLine(next, medianFontSize) != null &&
    !isSizeOnlyHeadingLine(next, medianFontSize)
  ) {
    return false;
  }
  if (looksLikeStandaloneHeading(prev.text) || looksLikeStandaloneHeading(next.text)) {
    return false;
  }

  // Table-ish lines: defer to scale at call site via a wide column gap check.
  const probeScale: LayoutScale = {
    indentGap,
    columnGap: Math.max(indentGap, medianFontSize * 1.8),
    columnCluster: Math.max(10, indentGap * 0.65),
  };
  if (
    splitColumnRuns(prev, probeScale).length >= 2 ||
    splitColumnRuns(next, probeScale).length >= 2 ||
    relaxedColumnsAlign(prev, next, probeScale)
  ) {
    return false;
  }

  if (lineIndentLevel(prev, baselineX, indentGap) !== lineIndentLevel(next, baselineX, indentGap)) {
    if (endsSentence(prev.text) || Math.abs(prev.minX - next.minX) > indentGap * 6) {
      return false;
    }
  } else if (Math.abs(prev.minX - next.minX) > indentGap * 0.55) {
    if (endsSentence(prev.text)) return false;
  }

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
      // Advance y to the line just merged so the next soft-wrap gap is measured
      // between consecutive lines rather than from the paragraph's first line.
      // Otherwise the gap accumulates and a paragraph stops merging after a few
      // lines; for body copy set in a larger-than-median font the unmerged tail
      // fragments are then promoted to headings and render as giant text.
      // (Array order is preserved, so list/table ordering is unaffected.)
      prev.y = line.y;
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
  const align = inferTextAlign(line, bounds);
  const indent =
    align === 'center' ? 0 : lineIndentLevel(line, baselineX, indentGap);
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
      content: stripFontSizeMarks(runsToTextNodes(line.runs, medianFontSize, true)),
    };
  }

  // A paragraph whose text reads as body copy must not carry an oversized
  // per-run fontSize mark: a body paragraph set in a larger-than-median font
  // would otherwise render "huge". Keep size marks only for short non-body
  // lines (e.g. a slightly larger caption) where the size is meaningful.
  const attachSizeMarks = !looksLikeBodyCopy(line.text.trim());
  const content = runsToTextNodes(line.runs, medianFontSize, attachSizeMarks);

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
    // Numbered lists only join when the next one picks up the count (e.g.
    // across a page break); a list that restarts at 1 stays separate.
    const continuesNumbering =
      block.type !== 'orderedList' ||
      (prev !== undefined &&
        orderedListStart(block) === orderedListStart(prev) + (prev.content?.length ?? 0) &&
        block.attrs?.type === prev.attrs?.type);
    if (
      prev &&
      (block.type === 'bulletList' || block.type === 'orderedList') &&
      prev.type === block.type &&
      continuesNumbering
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

/** Page-wide metrics shared by every block builder on a page. */
type PageLayout = {
  medianFontSize: number;
  baselineX: number;
  scale: LayoutScale;
  bounds: ContentBounds;
};

/** Text items assigned to one ruled table's grid cells. */
type PlacedRuledTable = {
  table: RuledTable;
  cellItems: Map<string, SpatialTextItem[]>;
};

function itemCenter(item: SpatialTextItem): { x: number; y: number } {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 };
}

/**
 * Split page items into those inside a ruled table's grid and the rest.
 * Tables holding fewer than two non-empty cells are decorative boxes and
 * their text stays in the normal flow.
 */
function placeItemsInRuledTables(
  items: SpatialTextItem[],
  tables: RuledTable[],
): { placed: PlacedRuledTable[]; free: SpatialTextItem[] } {
  const placed: PlacedRuledTable[] = tables.map((table) => ({ table, cellItems: new Map() }));
  const owner = new Map<SpatialTextItem, number>();
  for (const item of items) {
    const { x, y } = itemCenter(item);
    const t = tables.findIndex(
      (tb) => x >= tb.left && x <= tb.right && y >= tb.top && y <= tb.bottom,
    );
    if (t < 0) continue;
    const table = tables[t]!;
    const cell = cellAt(table, bandIndex(table.rowYs, y), bandIndex(table.colXs, x));
    if (!cell) continue;
    const key = `${cell.row}:${cell.col}`;
    const list = placed[t]!.cellItems.get(key) ?? [];
    list.push(item);
    placed[t]!.cellItems.set(key, list);
    owner.set(item, t);
  }

  const kept = new Set<number>();
  placed.forEach((p, t) => {
    const nonEmpty = [...p.cellItems.values()].filter((list) =>
      list.some((i) => i.text.trim().length > 0),
    ).length;
    if (nonEmpty >= 2) kept.add(t);
  });

  return {
    placed: placed.filter((_, t) => kept.has(t)),
    free: items.filter((item) => {
      const t = owner.get(item);
      return t === undefined || !kept.has(t);
    }),
  };
}

/** Cell lines → paragraphs: wrapped lines join; a clear vertical gap splits. */
function cellParagraphs(items: SpatialTextItem[], medianFontSize: number): TipTapNode[] {
  const lines = itemsToLines(items);
  const paragraphs: LineRun[][] = [];
  let prev: Line | undefined;
  for (const line of lines) {
    const current = paragraphs[paragraphs.length - 1];
    const gap = prev ? line.y - prev.y : 0;
    if (!current || !prev || gap > prev.maxFontSize * SOFT_WRAP_GAP_RATIO || isListLine(line)) {
      paragraphs.push(line.runs.map((r) => ({ ...r })));
    } else {
      const hyphenated = endsWithHyphen(prev.text);
      if (hyphenated) {
        current.splice(0, current.length, ...trimTrailingHyphen(current));
      }
      const next = line.runs.map((r) => ({ ...r }));
      const last = current[current.length - 1];
      if (!hyphenated && next[0] && !next[0].text.startsWith(' ') && !last?.text.endsWith(' ')) {
        next[0] = { ...next[0], text: ` ${next[0].text}` };
      }
      current.push(...next);
    }
    prev = line;
  }
  const nodes = paragraphs.map((runs) => {
    const content = runsToTextNodes(runs, medianFontSize, false);
    return { type: 'paragraph', ...(content.length > 0 ? { content } : {}) } as TipTapNode;
  });
  return nodes.length > 0 ? nodes : [{ type: 'paragraph' }];
}

function ruledTableToNode(placed: PlacedRuledTable, medianFontSize: number): TipTapNode {
  const { table, cellItems } = placed;
  const rows = table.rowYs.length - 1;
  const content: TipTapNode[] = [];
  for (let r = 0; r < rows; r++) {
    const cells = table.cells
      .filter((c) => c.row === r)
      .sort((a, b) => a.col - b.col)
      .map((c) => {
        const node: TipTapNode = {
          type: r === 0 ? 'tableHeader' : 'tableCell',
          content: cellParagraphs(cellItems.get(`${c.row}:${c.col}`) ?? [], medianFontSize),
        };
        if (c.colSpan > 1 || c.rowSpan > 1) {
          node.attrs = {
            ...(c.colSpan > 1 ? { colspan: c.colSpan } : {}),
            ...(c.rowSpan > 1 ? { rowspan: c.rowSpan } : {}),
          };
        }
        return node;
      });
    // A row fully covered by rowspans from above has no origin cells.
    if (cells.length > 0) content.push({ type: 'tableRow', content: cells });
  }
  return { type: 'table', content };
}

function spatialItemsToBlocks(items: SpatialTextItem[], rulings?: PageRulings): TipTapNode[] {
  const allLines = itemsToLines(items);
  if (allLines.length === 0) return [];

  // Page metrics come from every line (table text included) so heading and
  // indent heuristics see the same page as before table extraction.
  const sizes = allLines.map((l) => l.maxFontSize).sort((a, b) => a - b);
  // Lower median so a single large title still counts as a heading vs body.
  const medianFontSize = sizes[Math.floor((sizes.length - 1) / 2)] ?? 12;

  const minXs = allLines.map((l) => l.minX).sort((a, b) => a - b);
  const layout: PageLayout = {
    medianFontSize,
    baselineX: percentile(minXs, 0.1),
    scale: resolveLayoutScale(allLines, medianFontSize),
    bounds: estimateContentBounds(allLines),
  };

  const { placed, free } = placeItemsInRuledTables(items, detectRuledTables(rulings));
  if (placed.length === 0) return linesToBlocks(allLines, layout);

  // Splice each ruled table between the free lines above and below it.
  const freeLines = itemsToLines(free);
  const blocks: TipTapNode[] = [];
  let li = 0;
  for (const p of placed) {
    const before: Line[] = [];
    while (li < freeLines.length && freeLines[li]!.y < p.table.top) {
      before.push(freeLines[li]!);
      li += 1;
    }
    blocks.push(...linesToBlocks(before, layout));
    blocks.push(ruledTableToNode(p, medianFontSize));
  }
  blocks.push(...linesToBlocks(freeLines.slice(li), layout));
  return blocks;
}

function linesToBlocks(rawLines: Line[], layout: PageLayout): TipTapNode[] {
  const { medianFontSize, baselineX, scale, bounds } = layout;
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

  return blocks;
}

/** Concatenated plain text of a TipTap node (all descendant text runs). */
function nodePlainText(node: TipTapNode): string {
  if (typeof node.text === 'string') return node.text;
  const children = (node.content ?? []) as TipTapNode[];
  return children.map(nodePlainText).join('');
}

/** Drop a single trailing whitespace-separated bare-page-number token. */
function stripTrailingPageNumber(text: string): string {
  return text.replace(/\s+\d{1,4}$/, '').trimEnd();
}

/**
 * Flatten a table-of-contents list into clean paragraphs: no bullets, and with
 * trailing page numbers dropped (the leading section numbering stays part of
 * the title text). Recursively walks nested sub-lists (e.g. 4.1 / 4.1.1) and
 * drops bare-page-number-only entries.
 */
function tocListToParagraphs(list: TipTapNode): TipTapNode[] {
  const paragraphs: TipTapNode[] = [];
  const walk = (current: TipTapNode): void => {
    // Ordered-list markers were stripped into list attrs; restore them so a
    // "1. Introduction" entry keeps its number once flattened.
    const ordered = current.type === 'orderedList';
    let ordinal = ordered ? orderedListStart(current) : 0;
    for (const item of (current.content ?? []) as TipTapNode[]) {
      if (item.type !== 'listItem') continue;
      const children = (item.content ?? []) as TipTapNode[];
      const entry = children[0];
      const subLists = children.filter(
        (c) => c.type === 'bulletList' || c.type === 'orderedList',
      );
      const marker = ordered ? `${formatOrderedMarker(ordinal, current.attrs?.type)} ` : '';
      ordinal += 1;

      if (entry && entry.type === 'paragraph') {
        const entryText = nodePlainText(entry).trim();
        // Drop bare page-number-only entries (dotted-leader targets).
        if (!BARE_PAGE_NUMBER_RE.test(entryText) && entryText.length > 0) {
          const cleaned = stripTrailingPageNumber(entryText);
          paragraphs.push({
            type: 'paragraph',
            content: [{ type: 'text', text: `${marker}${cleaned}` }],
          });
        }
      }

      for (const sub of subLists) {
        walk(sub);
      }
    }
  };
  walk(list);
  return paragraphs;
}

/**
 * Flatten a table-of-contents rendered as a `table` (Word emits TOC entries as
 * tab-leader rows, so the digital extractor clusters section number, nested
 * title, and page number into separate columns). Each row becomes one clean
 * paragraph: page-number-only cells are dropped and a trailing page number is
 * stripped, while the section numbering in the title cell is kept.
 */
function tocTableToParagraphs(table: TipTapNode): TipTapNode[] {
  const paragraphs: TipTapNode[] = [];
  for (const row of (table.content ?? []) as TipTapNode[]) {
    if (row.type !== 'tableRow') continue;
    const cellTexts = ((row.content ?? []) as TipTapNode[]).map((cell) =>
      nodePlainText(cell).replace(/\s+/g, ' ').trim(),
    );
    // Keep the title cell(s); drop empty cells and bare page-number cells
    // (the dotted-leader page target sits in its own column).
    const titleParts = cellTexts.filter(
      (t) => t.length > 0 && !BARE_PAGE_NUMBER_RE.test(t),
    );
    if (titleParts.length === 0) continue;
    const text = stripTrailingPageNumber(titleParts.join(' ').trim());
    if (text.length === 0 || BARE_PAGE_NUMBER_RE.test(text)) continue;
    paragraphs.push({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    });
  }
  return paragraphs;
}

/** First non-empty block at or after `start` (skips blank spacer paragraphs). */
function nextContentIndex(nodes: TipTapNode[], start: number): number {
  let j = start;
  while (j < nodes.length) {
    const cand = nodes[j]!;
    const isEmptyParagraph =
      cand.type === 'paragraph' && nodePlainText(cand).trim() === '';
    if (!isEmptyParagraph) break;
    j += 1;
  }
  return j;
}

/**
 * Post-pass: render a document's table of contents as clean paragraphs. Finds a
 * top-level TOC title (heading or paragraph whose plain text matches
 * {@link isTocTitle}); when the next non-empty block is a list *or* a table
 * (Word TOCs cluster into table columns in the digital path), it is replaced
 * with flattened, bullet-free paragraphs. Blank spacer paragraphs between the
 * title and the list/table are skipped. Only the one block associated with the
 * title is transformed.
 */
export function flattenTableOfContents(nodes: TipTapNode[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    out.push(node);
    if (node.type !== 'heading' && node.type !== 'paragraph') continue;
    if (!isTocTitle(nodePlainText(node).trim())) continue;

    const j = nextContentIndex(nodes, i + 1);
    const next = nodes[j];
    if (!next) continue;
    if (next.type === 'bulletList' || next.type === 'orderedList') {
      out.push(...tocListToParagraphs(next));
      i = j; // Consume the skipped spacers and the transformed list.
    } else if (next.type === 'table') {
      out.push(...tocTableToParagraphs(next));
      i = j; // Consume the skipped spacers and the transformed table.
    }
  }
  return out;
}

/** Page furniture that may sit between a table's halves across a page break. */
const PAGE_FURNITURE_RE = /^(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?$/i;

function isPageFurniture(node: TipTapNode): boolean {
  return node.type === 'paragraph' && PAGE_FURNITURE_RE.test(nodePlainText(node).trim());
}

function tableColumnCount(table: TipTapNode): number {
  const firstRow = (table.content ?? [])[0];
  return (firstRow?.content ?? []).reduce(
    (n, cell) => n + (Number((cell.attrs as { colspan?: number } | undefined)?.colspan) || 1),
    0,
  );
}

function rowText(row: TipTapNode | undefined): string {
  return (row?.content ?? []).map((cell) => nodePlainText(cell).trim()).join('\u0001');
}

/**
 * Append one page's blocks, continuing a table split by the page break: when
 * the previous page ends with a table and this page starts with one of the
 * same column count, their rows are joined (a repeated header row is dropped).
 */
function appendPageBlocks(blocks: TipTapNode[], pageBlocks: TipTapNode[]): void {
  let tail = blocks.length - 1;
  while (tail >= 0 && isPageFurniture(blocks[tail]!)) tail -= 1;
  let head = 0;
  while (head < pageBlocks.length && isPageFurniture(pageBlocks[head]!)) head += 1;

  const prev = blocks[tail];
  const next = pageBlocks[head];
  if (
    prev?.type !== 'table' ||
    next?.type !== 'table' ||
    tableColumnCount(prev) !== tableColumnCount(next)
  ) {
    blocks.push(...pageBlocks);
    return;
  }

  const prevRows = prev.content ?? [];
  let nextRows = next.content ?? [];
  if (rowText(nextRows[0]) === rowText(prevRows[0])) {
    nextRows = nextRows.slice(1);
  } else {
    // Continuation rows are body rows, not a second header.
    nextRows = nextRows.map((row, r) =>
      r === 0
        ? {
            ...row,
            content: (row.content ?? []).map((cell) =>
              cell.type === 'tableHeader' ? { ...cell, type: 'tableCell' } : cell,
            ),
          }
        : row,
    );
  }
  prev.content = [...prevRows, ...nextRows];
  blocks.splice(tail + 1); // drop page furniture between the halves
  blocks.push(...pageBlocks.slice(head + 1));
}

/** Build a TipTap doc from spatial pages of text items. */
export function spatialPagesToTipTap(pages: SpatialPage[]): TipTapDoc {
  // Process pages separately so page-local Y coordinates cannot interleave.
  const cleaned = filterWatermarkPages(pages);
  const blocks: TipTapNode[] = [];
  for (const page of cleaned) {
    appendPageBlocks(blocks, spatialItemsToBlocks(page.textItems ?? [], page.rulings));
  }

  // Wrap stitching runs in polishPdfTipTapNodes, after heading promotion.
  const merged = flattenTableOfContents(mergeAdjacentLists(blocks));
  return {
    type: 'doc',
    content: merged.length > 0 ? merged : [{ type: 'paragraph' }],
  };
}
