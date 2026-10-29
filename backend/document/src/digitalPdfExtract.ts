/**
 * Extract spatial text items from a digital PDF text layer (pdf.js).
 *
 * Per page we also resolve real font names (for bold / italic marks) and
 * measure how much of the page is painted by images, so callers can route
 * scanned pages to OCR while keeping exact text for born-digital pages.
 */
import { isCanliiOverlayStamp } from './pdfHeadingHeuristics.js';
import type { PageRulings } from './pdfRuledTables.js';
import type { SpatialPage, SpatialTextItem } from './pdfToTipTap.js';

export interface PdfjsTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PdfjsOperatorList {
  fnArray: number[];
  argsArray: unknown[];
}

export interface PdfjsPageProxy {
  /** Page box `[x1, y1, x2, y2]` in PDF user space. */
  view?: number[];
  getViewport(opts: { scale: number }): { width: number; height: number };
  getTextContent(opts?: { includeMarkedContent?: boolean }): Promise<{
    items: Array<PdfjsTextItem | { type?: string }>;
    styles?: Record<string, { fontFamily?: string }>;
  }>;
  /** Loads fonts into `commonObjs` and lists paint operations (images). */
  getOperatorList?(): Promise<PdfjsOperatorList>;
  commonObjs?: { get(id: string): unknown };
  cleanup?(): unknown;
}

/** pdf.js `OPS` codes used for image-coverage measurement. */
export type PdfjsOps = Readonly<Record<string, number>>;

export interface PdfjsDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPageProxy>;
  destroy?: () => Promise<void>;
  /** pdf.js `OPS` table; image coverage is skipped when absent. */
  ops?: PdfjsOps;
}

export type LoadPdfDocument = (bytes: Uint8Array) => Promise<PdfjsDocumentProxy>;

function isTextItem(item: PdfjsTextItem | { type?: string }): item is PdfjsTextItem {
  return typeof (item as PdfjsTextItem).str === 'string';
}

function resolveFontName(
  resourceName: string | undefined,
  styles: Record<string, { fontFamily?: string }> | undefined,
): string | undefined {
  if (!resourceName) return undefined;
  const family = styles?.[resourceName]?.fontFamily;
  if (family && family.trim()) return `${family} ${resourceName}`;
  return resourceName;
}

interface PdfjsFontInfo {
  name?: unknown;
  bold?: unknown;
  black?: unknown;
  italic?: unknown;
}

/**
 * Build a font name `fontFlags()` can read (e.g. `Arial-BoldMT`) from the
 * pdf.js font object. Text content only exposes ids like `g_d0_f3`.
 */
export function describePdfjsFont(font: PdfjsFontInfo | null | undefined): string | undefined {
  if (!font || typeof font !== 'object') return undefined;
  const raw = typeof font.name === 'string' ? font.name : '';
  // Drop the subset tag on embedded fonts: `ABCDEF+Arial-BoldMT`.
  let name = raw.replace(/^[A-Z]{6}\+/, '');
  if (font.bold === true || font.black === true) {
    if (!/bold|black|heavy|semibold|demi/i.test(name)) name = `${name}-Bold`;
  }
  if (font.italic === true && !/italic|oblique/i.test(name)) name = `${name}-Italic`;
  name = name.replace(/^-/, '');
  return name || undefined;
}

function fontLookup(page: PdfjsPageProxy): (id: string | undefined) => string | undefined {
  const cache = new Map<string, string | undefined>();
  return (id) => {
    if (!id || !page.commonObjs) return undefined;
    if (cache.has(id)) return cache.get(id);
    let described: string | undefined;
    try {
      described = describePdfjsFont(page.commonObjs.get(id) as PdfjsFontInfo);
    } catch {
      described = undefined;
    }
    cache.set(id, described);
    return described;
  };
}

/** Rotation of a text matrix in degrees (0 for normal horizontal text). */
export function textRotationDegrees(transform: number[] | undefined): number {
  const a = transform?.[0] ?? 1;
  const b = transform?.[1] ?? 0;
  return Math.abs((Math.atan2(b, a) * 180) / Math.PI);
}

/** Text rotated more than this is margin / stamp text, not body copy. */
const ROTATED_TEXT_DEGREES = 15;
/** Only drop rotated text when it is a minority of the page's characters. */
const MAX_ROTATED_CHAR_SHARE = 0.2;

/** Convert a pdf.js text item into a top-origin spatial item. */
export function pdfjsItemToSpatial(
  item: PdfjsTextItem,
  pageHeight: number,
  styles?: Record<string, { fontFamily?: string }>,
  realFontName?: string,
): SpatialTextItem | null {
  const raw = item.str ?? '';
  if (raw.length === 0) return null;
  const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
  const a = transform[0] ?? 1;
  const b = transform[1] ?? 0;
  const d = transform[3] ?? 1;
  const e = transform[4] ?? 0;
  const f = transform[5] ?? 0;
  const fontSize = Math.hypot(a, b) || Math.abs(d) || item.height || 12;
  const width = item.width && item.width > 0 ? item.width : Math.max(1, raw.length * fontSize * 0.5);
  const height = item.height && item.height > 0 ? item.height : fontSize;
  return {
    text: raw,
    x: e,
    y: pageHeight - f - height,
    width,
    height,
    fontName: realFontName ?? resolveFontName(item.fontName, styles),
    fontSize,
  };
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m1: Matrix, m2: readonly number[]): Matrix {
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = m2;
  return [
    m1[0] * a2 + m1[2] * b2,
    m1[1] * a2 + m1[3] * b2,
    m1[0] * c2 + m1[2] * d2,
    m1[1] * c2 + m1[3] * d2,
    m1[0] * e2 + m1[2] * f2 + m1[4],
    m1[1] * e2 + m1[3] * f2 + m1[5],
  ];
}

function isMatrix(value: unknown): value is number[] {
  if (!value || typeof value !== 'object') return false;
  const arr = Array.from(value as ArrayLike<unknown>);
  return arr.length === 6 && arr.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** Area of the unit square mapped through `m`, clipped to the page box. */
function clippedUnitSquareArea(m: Matrix, box: readonly number[]): number {
  const pts = [
    [m[4], m[5]],
    [m[0] + m[4], m[1] + m[5]],
    [m[2] + m[4], m[3] + m[5]],
    [m[0] + m[2] + m[4], m[1] + m[3] + m[5]],
  ];
  const xs = pts.map((p) => p[0]!);
  const ys = pts.map((p) => p[1]!);
  const [bx1 = 0, by1 = 0, bx2 = 0, by2 = 0] = box;
  const x1 = Math.max(Math.min(...xs), Math.min(bx1, bx2));
  const x2 = Math.min(Math.max(...xs), Math.max(bx1, bx2));
  const y1 = Math.max(Math.min(...ys), Math.min(by1, by2));
  const y2 = Math.min(Math.max(...ys), Math.max(by1, by2));
  return x2 > x1 && y2 > y1 ? (x2 - x1) * (y2 - y1) : 0;
}

/**
 * Fraction of the page box painted by images (0–1), from a pdf.js operator
 * list. Tracks the CTM through save / restore / transform and form XObjects.
 */
export function imageCoverageFromOperatorList(
  opList: PdfjsOperatorList,
  ops: PdfjsOps,
  pageBox: readonly number[],
): number {
  const [bx1 = 0, by1 = 0, bx2 = 0, by2 = 0] = pageBox;
  const pageArea = Math.abs(bx2 - bx1) * Math.abs(by2 - by1);
  if (pageArea <= 0) return 0;

  const imageOps = new Set(
    ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject']
      .map((k) => ops[k])
      .filter((v): v is number => typeof v === 'number'),
  );
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  let painted = 0;

  opList.fnArray.forEach((fn, i) => {
    const args = opList.argsArray[i] as unknown[] | null | undefined;
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.transform && Array.isArray(args) && args.length >= 6) {
      ctm = multiply(ctm, args as number[]);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = Array.isArray(args) ? args[0] : undefined;
      if (isMatrix(matrix)) ctm = multiply(ctm, Array.from(matrix));
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (imageOps.has(fn)) {
      painted += clippedUnitSquareArea(ctm, pageBox);
    } else if (fn === ops.paintImageXObjectRepeat && Array.isArray(args)) {
      const scaleX = Number(args[1]) || 0;
      const scaleY = Number(args[2]) || 0;
      const positions = Array.from((args[3] as ArrayLike<number>) ?? []);
      for (let p = 0; p + 1 < positions.length; p += 2) {
        const m = multiply(ctm, [scaleX, 0, 0, scaleY, positions[p]!, positions[p + 1]!]);
        painted += clippedUnitSquareArea(m, pageBox);
      }
    }
  });

  return Math.min(1, painted / pageArea);
}

/** pdf.js `DrawOPS` codes inside a `constructPath` path buffer. */
const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_CLOSE_PATH = 3;
/** Axis-aligned slack for a stroked segment, in page units. */
const RULING_AXIS_SLACK = 1;
/** A filled rectangle at most this thick is a border line, not shading. */
const MAX_RULING_THICKNESS = 3;

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Split a pdf.js path buffer into subpaths of page-space points (curves dropped). */
function pathSubpaths(path: ArrayLike<number>, ctm: Matrix): Array<Array<[number, number]>> {
  const subpaths: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  const flush = () => {
    if (current.length > 0) subpaths.push(current);
    current = [];
  };
  let i = 0;
  while (i < path.length) {
    const op = path[i]!;
    if (op === DRAW_MOVE_TO) {
      flush();
      current.push(applyMatrix(ctm, path[i + 1]!, path[i + 2]!));
      i += 3;
    } else if (op === DRAW_LINE_TO) {
      current.push(applyMatrix(ctm, path[i + 1]!, path[i + 2]!));
      i += 3;
    } else if (op === DRAW_CURVE_TO) {
      // Curves (rounded corners, glyph-like art) are never table rulings.
      flush();
      i += 7;
    } else if (op === DRAW_CLOSE_PATH) {
      if (current.length > 1) current.push(current[0]!);
      flush();
      i += 1;
    } else {
      break;
    }
  }
  flush();
  return subpaths;
}

/**
 * Horizontal / vertical rulings (table borders) painted on a page, in
 * top-origin coordinates matching {@link pdfjsItemToSpatial}. Stroked
 * axis-aligned segments and thin filled rectangles both count; curves,
 * diagonals and large fills (cell shading, backgrounds) are ignored.
 */
export function rulingsFromOperatorList(
  opList: PdfjsOperatorList,
  ops: PdfjsOps,
  pageHeight: number,
): PageRulings {
  const horizontal: PageRulings['horizontal'] = [];
  const vertical: PageRulings['vertical'] = [];
  const strokeOps = new Set(
    ['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']
      .map((k) => ops[k])
      .filter((v): v is number => typeof v === 'number'),
  );
  const fillOps = new Set(
    ['fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']
      .map((k) => ops[k])
      .filter((v): v is number => typeof v === 'number'),
  );
  if (typeof ops.constructPath !== 'number') return { horizontal, vertical };

  const addSegment = (a: [number, number], b: [number, number]) => {
    const [x1, y1] = a;
    const [x2, y2] = b;
    if (Math.abs(y1 - y2) <= RULING_AXIS_SLACK && Math.abs(x1 - x2) > RULING_AXIS_SLACK) {
      horizontal.push({ y: pageHeight - (y1 + y2) / 2, x1: Math.min(x1, x2), x2: Math.max(x1, x2) });
    } else if (Math.abs(x1 - x2) <= RULING_AXIS_SLACK && Math.abs(y1 - y2) > RULING_AXIS_SLACK) {
      vertical.push({
        x: (x1 + x2) / 2,
        y1: pageHeight - Math.max(y1, y2),
        y2: pageHeight - Math.min(y1, y2),
      });
    }
  };

  const addThinFill = (points: Array<[number, number]>) => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;
    if (h <= MAX_RULING_THICKNESS && w > h) {
      horizontal.push({ y: pageHeight - (minY + maxY) / 2, x1: minX, x2: maxX });
    } else if (w <= MAX_RULING_THICKNESS && h > w) {
      vertical.push({ x: (minX + maxX) / 2, y1: pageHeight - maxY, y2: pageHeight - minY });
    }
  };

  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  opList.fnArray.forEach((fn, i) => {
    const args = opList.argsArray[i] as unknown[] | null | undefined;
    if (fn === ops.save) {
      stack.push(ctm);
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.transform && Array.isArray(args) && args.length >= 6) {
      ctm = multiply(ctm, args as number[]);
    } else if (fn === ops.paintFormXObjectBegin) {
      stack.push(ctm);
      const matrix = Array.isArray(args) ? args[0] : undefined;
      if (isMatrix(matrix)) ctm = multiply(ctm, Array.from(matrix));
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === ops.constructPath && Array.isArray(args)) {
      // pdf.js 5: [paintOp, [Float32Array path], minMax]
      const paintOp = Number(args[0]);
      const buffers = args[1];
      const path = Array.isArray(buffers) ? buffers[0] : undefined;
      if (!path || typeof (path as ArrayLike<number>).length !== 'number') return;
      for (const sub of pathSubpaths(path as ArrayLike<number>, ctm)) {
        if (strokeOps.has(paintOp)) {
          for (let p = 1; p < sub.length; p++) addSegment(sub[p - 1]!, sub[p]!);
        } else if (fillOps.has(paintOp) && sub.length >= 3) {
          addThinFill(sub);
        }
      }
    }
  });

  return { horizontal, vertical };
}

async function defaultLoadPdf(bytes: Uint8Array): Promise<PdfjsDocumentProxy> {
  // Worker polyfill for Node / Lambda before pdf.js loads. Dynamic Function
  // import keeps tsc from requiring package export types that Jest also skips.
  await (Function('return import("pdf-parse/worker")')() as Promise<unknown>);
  const pdfjs = (await (Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')() as Promise<{
    getDocument: (opts: Record<string, unknown>) => { promise: Promise<PdfjsDocumentProxy> };
    OPS?: PdfjsOps;
  }>)) as {
    getDocument: (opts: Record<string, unknown>) => { promise: Promise<PdfjsDocumentProxy> };
    OPS?: PdfjsOps;
  };
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  return {
    numPages: doc.numPages,
    getPage: (n) => doc.getPage(n),
    destroy: () => doc.destroy?.() ?? Promise.resolve(),
    ...(pdfjs.OPS ? { ops: pdfjs.OPS } : {}),
  };
}

const MAX_PAGES = 200;
/**
 * Wall-clock budget for operator-list scans (font loading + image decode).
 * Pages past the budget skip coverage and are classified by text alone, so a
 * long scanned document cannot eat the Lambda timeout before Textract runs.
 */
const OPERATOR_LIST_BUDGET_MS = 60_000;

function countTextChars(items: readonly SpatialTextItem[]): number {
  let n = 0;
  for (const item of items) {
    if (isCanliiOverlayStamp(item.text)) continue;
    n += item.text.replace(/\s+/g, '').length;
  }
  return n;
}

export async function extractSpatialPagesFromPdf(
  bytes: Buffer | Uint8Array,
  loadPdf: LoadPdfDocument = defaultLoadPdf,
): Promise<SpatialPage[]> {
  // pdf.js rejects Node Buffers (which *are* Uint8Arrays), so always copy
  // into a plain Uint8Array.
  const data = Uint8Array.from(bytes);
  const doc = await loadPdf(data);
  const started = Date.now();
  try {
    const pageCount = Math.min(Math.max(0, doc.numPages), MAX_PAGES);
    const pages: SpatialPage[] = [];
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });

      let opList: PdfjsOperatorList | null = null;
      if (page.getOperatorList && Date.now() - started < OPERATOR_LIST_BUDGET_MS) {
        try {
          opList = await page.getOperatorList();
        } catch {
          opList = null;
        }
      }
      const realFont = opList ? fontLookup(page) : () => undefined;

      const content = await page.getTextContent({ includeMarkedContent: false });
      const horizontal: SpatialTextItem[] = [];
      const rotated: SpatialTextItem[] = [];
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        const spatial = pdfjsItemToSpatial(
          item,
          viewport.height,
          content.styles,
          realFont(item.fontName),
        );
        if (!spatial) continue;
        if (textRotationDegrees(item.transform) > ROTATED_TEXT_DEGREES) rotated.push(spatial);
        else horizontal.push(spatial);
      }

      // Rotated margin stamps (`2024 BCSC 1953 (CanLII)`) distort alignment
      // and column detection. Keep rotated text only when it is the page's
      // main content (e.g. a landscape table drawn sideways).
      const rotatedChars = countTextChars(rotated);
      const totalChars = rotatedChars + countTextChars(horizontal);
      const textItems =
        totalChars > 0 && rotatedChars / totalChars > MAX_ROTATED_CHAR_SHARE
          ? [...horizontal, ...rotated]
          : horizontal;

      const box = page.view ?? [0, 0, viewport.width, viewport.height];
      const imageCoverage =
        opList && doc.ops ? imageCoverageFromOperatorList(opList, doc.ops, box) : undefined;
      const rulings =
        opList && doc.ops ? rulingsFromOperatorList(opList, doc.ops, viewport.height) : undefined;

      pages.push({
        textItems,
        textChars: countTextChars(textItems),
        ...(imageCoverage !== undefined ? { imageCoverage } : {}),
        ...(rulings && (rulings.horizontal.length > 0 || rulings.vertical.length > 0)
          ? { rulings }
          : {}),
      });
      page.cleanup?.();
    }
    return pages;
  } finally {
    await doc.destroy?.();
  }
}

export function digitalTextCharCount(pages: SpatialPage[]): number {
  return pages
    .flatMap((p) => p.textItems)
    .map((i) => i.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim().length;
}

/** Enough recoverable text-layer content (whole document) to skip OCR. */
export const MIN_DIGITAL_CHARS = 80;

export function digitalExtractionIsUseful(pages: SpatialPage[]): boolean {
  return digitalTextCharCount(pages) >= MIN_DIGITAL_CHARS;
}

/** A page with less text-layer content than this is "text-poor". */
export const MIN_PAGE_TEXT_CHARS = 20;
/** Image coverage at which a page is treated as a scan. */
export const OCR_IMAGE_COVERAGE = 0.5;

/**
 * True when a page should be read by OCR instead of the text layer:
 * - text-poor with an image covering at least half the page, or
 * - an image covering more than half the page (mostly scanned, even if
 *   some typed text sits on top).
 * Blank pages (no text, no image) stay digital. When image coverage is
 * unknown, a text-poor page is assumed to be scanned.
 */
export function pageNeedsOcr(page: SpatialPage): boolean {
  const chars =
    page.textChars ?? page.textItems.map((i) => i.text).join('').replace(/\s+/g, '').length;
  const coverage = page.imageCoverage;
  if (coverage === undefined) return chars < MIN_PAGE_TEXT_CHARS;
  if (coverage > OCR_IMAGE_COVERAGE) return true;
  return chars < MIN_PAGE_TEXT_CHARS && coverage >= OCR_IMAGE_COVERAGE;
}
