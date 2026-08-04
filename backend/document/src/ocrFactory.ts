/**
 * PDF extractor factory — always returns the Textract-backed extractor.
 * (LiteParse/Tesseract removed; Textract is the sole OCR engine.)
 */
import type { RichPdfExtractor } from './pdfExtractor.js';
import type { OcrEngineName } from './textractOcr.js';
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
  return {
    extractor: new TextractPdfExtractor({
      s3Bucket: options.s3Bucket,
      s3Key: options.s3Key,
    }),
    engine: 'textract',
  };
}
