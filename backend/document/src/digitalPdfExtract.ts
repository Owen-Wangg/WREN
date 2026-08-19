/**
 * Extract spatial text items from a digital PDF text layer (pdf.js).
 *
 * Scanned PDFs with no text layer return empty pages; callers fall back to OCR.
 */
import type { SpatialPage, SpatialTextItem } from './pdfToTipTap.js';

export interface PdfjsTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PdfjsPageProxy {
  getViewport(opts: { scale: number }): { width: number; height: number };
  getTextContent(opts?: { includeMarkedContent?: boolean }): Promise<{
    items: Array<PdfjsTextItem | { type?: string }>;
    styles?: Record<string, { fontFamily?: string }>;
  }>;
}

export interface PdfjsDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPageProxy>;
  destroy?: () => Promise<void>;
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

/** Convert a pdf.js text item into a top-origin spatial item. */
export function pdfjsItemToSpatial(
  item: PdfjsTextItem,
  pageHeight: number,
  styles?: Record<string, { fontFamily?: string }>,
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
    fontName: resolveFontName(item.fontName, styles),
    fontSize,
  };
}

async function defaultLoadPdf(bytes: Uint8Array): Promise<PdfjsDocumentProxy> {
  // Worker polyfill for Node / Lambda before pdf.js loads. Dynamic Function
  // import keeps tsc from requiring package export types that Jest also skips.
  await (Function('return import("pdf-parse/worker")')() as Promise<unknown>);
  const pdfjs = (await (Function('return import("pdfjs-dist/legacy/build/pdf.mjs")')() as Promise<{
    getDocument: (opts: Record<string, unknown>) => { promise: Promise<PdfjsDocumentProxy> };
  }>)) as {
    getDocument: (opts: Record<string, unknown>) => { promise: Promise<PdfjsDocumentProxy> };
  };
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    verbosity: 0,
  });
  return task.promise;
}

const MAX_PAGES = 200;

export async function extractSpatialPagesFromPdf(
  bytes: Buffer | Uint8Array,
  loadPdf: LoadPdfDocument = defaultLoadPdf,
): Promise<SpatialPage[]> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc = await loadPdf(data);
  try {
    const pageCount = Math.min(Math.max(0, doc.numPages), MAX_PAGES);
    const pages: SpatialPage[] = [];
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ includeMarkedContent: false });
      const textItems: SpatialTextItem[] = [];
      for (const item of content.items) {
        if (!isTextItem(item)) continue;
        const spatial = pdfjsItemToSpatial(item, viewport.height, content.styles);
        if (spatial) textItems.push(spatial);
      }
      pages.push({ textItems });
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

/** Enough recoverable text-layer content to skip OCR. */
export const MIN_DIGITAL_CHARS = 80;

export function digitalExtractionIsUseful(pages: SpatialPage[]): boolean {
  return digitalTextCharCount(pages) >= MIN_DIGITAL_CHARS;
}
