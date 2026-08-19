/**
 * PDF extractor factory — digital text layer first, Textract OCR fallback.
 */
import type { RichPdfExtractor } from './pdfExtractor.js';
import type { OcrEngineName } from './textractOcr.js';
import { HybridPdfExtractor } from './hybridPdfExtractor.js';
import { TextractPdfExtractor } from './textractPdfExtractor.js';

export interface PdfExtractorOptions {
  readonly engine?: string | null;
  readonly s3Bucket?: string;
  readonly s3Key?: string;
}

export function createPdfExtractor(options: PdfExtractorOptions = {}): {
  extractor: RichPdfExtractor;
  engine: OcrEngineName;
} {
  const ocr = new TextractPdfExtractor({
    s3Bucket: options.s3Bucket,
    s3Key: options.s3Key,
  });
  return {
    extractor: new HybridPdfExtractor(ocr),
    engine: 'textract',
  };
}
