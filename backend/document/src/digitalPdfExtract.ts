/**
 * Extract spatial text items from a digital PDF text layer (pdf.js).
 *
 * Per page we also resolve real font names (for bold / italic marks) and
 * measure how much of the page is painted by images, so callers can route
 * scanned pages to OCR while keeping exact text for born-digital pages.
 */
import { isCanliiOverlayStamp } from './pdfHeadingHeuristics.js';
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

      pages.push({
        textItems,
        textChars: countTextChars(textItems),
        ...(imageCoverage !== undefined ? { imageCoverage } : {}),
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
