/**
 * PDF extraction interfaces.
 *
 * The concrete implementation is {@link HybridPdfExtractor} (digital text
 * layer via pdf.js, with {@link TextractPdfExtractor} as the OCR fallback).
 */
import type { TipTapDoc } from '@wren/types';

/** Best-effort PDF text extraction. Implementations MAY throw on failure. */
export interface PdfExtractor {
  extract(bytes: Buffer): Promise<string>;
}

/** Rich extraction: TipTap body plus optional reconstruction metadata. */
export interface RichPdfExtraction {
  readonly text: string;
  readonly content: TipTapDoc;
  readonly header?: TipTapDoc | null;
  readonly footer?: TipTapDoc | null;
  readonly ocrConfidence?: number;
}

/** Rich extraction: plain text + TipTap JSON for draft.content. */
export interface RichPdfExtractor extends PdfExtractor {
  extractRich(bytes: Buffer): Promise<RichPdfExtraction>;
}
