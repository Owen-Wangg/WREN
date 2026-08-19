/**
 * Try the PDF text layer first (fonts, alignment, TOC headings), then Textract OCR.
 */
import type { TipTapDoc } from '@wren/types';

import {
  digitalExtractionIsUseful,
  extractSpatialPagesFromPdf,
  type LoadPdfDocument,
} from './digitalPdfExtract.js';
import type { RichPdfExtraction, RichPdfExtractor } from './pdfExtractor.js';
import { spatialPagesToTipTap, type SpatialPage } from './pdfToTipTap.js';
import { polishPdfTipTapNodes } from './promotePdfHeadings.js';
import { tipTapDocToPlainText } from './textractLayoutToTipTap.js';

export type ExtractSpatialPages = (
  bytes: Buffer,
  loadPdf?: LoadPdfDocument,
) => Promise<SpatialPage[]>;

function polishDoc(doc: TipTapDoc): TipTapDoc {
  const content = polishPdfTipTapNodes(Array.isArray(doc.content) ? doc.content : []);
  return {
    type: 'doc',
    content: content.length > 0 ? content : [{ type: 'paragraph' }],
  };
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

  public async extractRich(bytes: Buffer): Promise<RichPdfExtraction> {
    try {
      const pages = await this.extractDigital(bytes);
      if (digitalExtractionIsUseful(pages)) {
        const content = polishDoc(spatialPagesToTipTap(pages));
        const text = tipTapDocToPlainText(content);
        if (text.trim().length > 0) {
          return { text, content };
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[HybridPdfExtractor] digital text-layer extract failed; using OCR', err);
    }

    const ocr = await this.ocrExtractor.extractRich(bytes);
    return {
      ...ocr,
      content: polishDoc(ocr.content),
    };
  }
}
