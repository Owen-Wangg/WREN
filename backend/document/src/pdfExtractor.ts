/**
 * PDF extraction interfaces.
 *
 * The concrete implementation is {@link TextractPdfExtractor} (see
 * `textractPdfExtractor.ts`). LiteParse/Tesseract has been removed.
 */
import type { TipTapDoc } from '@wren/types';

/** Best-effort PDF text extraction. Implementations MAY throw on failure. */
export interface PdfExtractor {
  extract(bytes: Buffer): Promise<string>;
}

/** Rich extraction: plain text + TipTap JSON for draft.content. */
export interface RichPdfExtractor extends PdfExtractor {
  extractRich(bytes: Buffer): Promise<{ text: string; content: TipTapDoc }>;
}
