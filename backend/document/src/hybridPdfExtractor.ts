/**
 * Read the PDF text layer first (exact text, fonts, alignment), and send only
 * scanned pages to Textract OCR.
 *
 * Routing is decided per page (`pageNeedsOcr`):
 * - every page digital → text layer only, no Textract call
 * - every page scanned → Textract for the whole document
 * - mixed → one Textract run, keep its output for the scanned pages, and
 *   splice them between digital pages in page order
 */
import type { TipTapDoc, TipTapNode } from '@wren/types';

import {
  digitalExtractionIsUseful,
  extractSpatialPagesFromPdf,
  pageNeedsOcr,
  type LoadPdfDocument,
} from './digitalPdfExtract.js';
import type {
  RichPdfExtractOptions,
  RichPdfExtraction,
  RichPdfExtractor,
  RichPdfPageGroupExtraction,
} from './pdfExtractor.js';
import { spatialPagesToTipTap, type SpatialPage } from './pdfToTipTap.js';
import { polishPdfTipTapNodes } from './promotePdfHeadings.js';
import { tipTapDocToPlainText } from './textractLayoutToTipTap.js';

export type ExtractSpatialPages = (
  bytes: Buffer,
  loadPdf?: LoadPdfDocument,
) => Promise<SpatialPage[]>;

type PageSource = 'digital' | 'ocr';

interface PageRun {
  readonly source: PageSource;
  /** 1-based page numbers, consecutive. */
  readonly pages: number[];
}

function polishDoc(doc: TipTapDoc): TipTapDoc {
  const content = polishPdfTipTapNodes(Array.isArray(doc.content) ? doc.content : []);
  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
}

function docNodes(doc: TipTapDoc): TipTapNode[] {
  return Array.isArray(doc.content) ? (doc.content as TipTapNode[]) : [];
}

/** Group consecutive pages by source. */
export function groupPageRuns(sources: readonly PageSource[]): PageRun[] {
  const runs: PageRun[] = [];
  sources.forEach((source, i) => {
    const last = runs[runs.length - 1];
    if (last && last.source === source) last.pages.push(i + 1);
    else runs.push({ source, pages: [i + 1] });
  });
  return runs;
}

function logRouting(details: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.info(JSON.stringify({ msg: '[HybridPdfExtractor] page routing', ...details }));
}

export class HybridPdfExtractor implements RichPdfExtractor {
  public constructor(
    private readonly ocrExtractor: RichPdfExtractor,
    private readonly extractDigital: ExtractSpatialPages = extractSpatialPagesFromPdf,
  ) {}

  public async extract(bytes: Buffer): Promise<string> {
    const rich = await this.extractRich(bytes);
    return rich.text;
  }

  public async extractRich(
    bytes: Buffer,
    _options?: RichPdfExtractOptions,
  ): Promise<RichPdfPageGroupExtraction> {
    let pages: SpatialPage[];
    try {
      pages = await this.extractDigital(bytes);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[HybridPdfExtractor] digital text-layer extract failed; using OCR', err);
      logRouting({ mode: 'ocr', reason: 'digital-extract-failed' });
      return this.ocrWholeDocument(bytes);
    }

    // Whole-document guard: vector-outlined or image-only PDFs with almost no
    // text layer anywhere go to OCR even if no single page shows an image.
    if (pages.length === 0 || !digitalExtractionIsUseful(pages)) {
      logRouting({ mode: 'ocr', reason: 'no-text-layer', pageCount: pages.length });
      return this.ocrWholeDocument(bytes);
    }

    const sources: PageSource[] = pages.map((p) => (pageNeedsOcr(p) ? 'ocr' : 'digital'));
    const ocrPages = sources.flatMap((s, i) => (s === 'ocr' ? [i + 1] : []));

    if (ocrPages.length === pages.length) {
      logRouting({ mode: 'ocr', reason: 'all-pages-scanned', pageCount: pages.length });
      return this.ocrWholeDocument(bytes);
    }

    if (ocrPages.length === 0) {
      const content = polishDoc(spatialPagesToTipTap(pages));
      const text = tipTapDocToPlainText(content);
      if (text.trim().length > 0) {
        logRouting({ mode: 'digital', pageCount: pages.length });
        return { text, content };
      }
      logRouting({ mode: 'ocr', reason: 'digital-empty', pageCount: pages.length });
      return this.ocrWholeDocument(bytes);
    }

    logRouting({ mode: 'mixed', pageCount: pages.length, ocrPages });
    return this.extractMixed(bytes, pages, sources);
  }

  private async ocrWholeDocument(bytes: Buffer): Promise<RichPdfExtraction> {
    const ocr = await this.ocrExtractor.extractRich(bytes);
    return {
      ...ocr,
      content: polishDoc(ocr.content),
    };
  }

  private async extractMixed(
    bytes: Buffer,
    pages: SpatialPage[],
    sources: PageSource[],
  ): Promise<RichPdfExtraction> {
    const runs = groupPageRuns(sources);
    const ocrRuns = runs.filter((r) => r.source === 'ocr');
    const ocr = await this.ocrExtractor.extractRich(bytes, {
      pageGroups: ocrRuns.map((r) => r.pages),
    });
    const ocrGroups = ocr.pageGroups ?? [];

    const nodes: TipTapNode[] = [];
    let ocrIndex = 0;
    for (const run of runs) {
      if (run.source === 'digital') {
        const doc = spatialPagesToTipTap(run.pages.map((n) => pages[n - 1]!));
        nodes.push(...docNodes(doc));
      } else {
        // Fall back to the whole OCR body if the extractor ignored page groups.
        const groupDoc =
          ocrGroups[ocrIndex] ?? (ocrGroups.length === 0 && ocrIndex === 0 ? ocr.content : null);
        ocrIndex += 1;
        if (groupDoc) nodes.push(...docNodes(groupDoc));
      }
    }

    const content = polishDoc({ type: 'doc', content: nodes });
    return {
      text: tipTapDocToPlainText(content),
      content,
      ...(typeof ocr.ocrConfidence === 'number' ? { ocrConfidence: ocr.ocrConfidence } : {}),
    };
  }
}
