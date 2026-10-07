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

export interface RichPdfExtractOptions {
  /**
   * Convert only these runs of consecutive (1-based) pages. The result then
   * carries `pageGroups` (one doc per run) for splicing into a mixed
   * digital / scanned document.
   */
  readonly pageGroups?: ReadonlyArray<ReadonlyArray<number>>;
}

/** Page-group extraction result for mixed documents. */
export interface RichPdfPageGroupExtraction extends RichPdfExtraction {
  readonly pageGroups?: readonly TipTapDoc[];
}

/** Rich extraction: plain text + TipTap JSON for draft.content. */
export interface RichPdfExtractor extends PdfExtractor {
  extractRich(bytes: Buffer, options?: RichPdfExtractOptions): Promise<RichPdfPageGroupExtraction>;
}
