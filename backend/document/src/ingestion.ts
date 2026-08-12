/**
 * Document ingestion (design "Document / Draft Service — Ingestion &
 * extraction"; REQ-DOC-SUBMIT-01 criteria 1–5).
 *
 * `ingestUpload` is the single entry point for turning a User-supplied source
 * (an uploaded file or pasted text) into ordered paragraph {@link Segment}s:
 *
 *   - Extension check FIRST: a filename that is neither `.docx` nor `.pdf`
 *     (case-insensitive) throws {@link UnsupportedFileFormatError} naming the
 *     accepted formats, before any extraction is attempted (Requirement 6.1).
 *   - `.docx`: extracted via the injected {@link DocxExtractor}.
 *   - `.pdf`: best-effort extraction via the injected {@link PdfExtractor}
 *     (Textract-backed — see `textractPdfExtractor.ts`).
 *     No-recoverable-text (empty/whitespace-only) or a thrown error both
 *     become a structured `fallback` result — never an uncaught exception
 *     (Requirement 6.1.4).
 *   - Pasted text: accepted directly, no extraction step.
 *
 * Extracted or pasted text is segmented through the SAME pure
 * `segmentParagraphs` function in every case — there is exactly ONE
 * segmentation code path (Requirements 6.2, 6.3, 6.5).
 */
import type { Segment, TipTapDoc } from '@wren/types';
import { tipTapContentToSegments } from '@wren/types';

import type { DocxExtractor } from './docxExtractor';
import { UnsupportedFileFormatError } from './errors';
import type { PdfExtractor, RichPdfExtractor } from './pdfExtractor';
import { segmentParagraphs } from './segmentation';

/** The two accepted upload extensions, named consistently in every message. */
export const ACCEPTED_FILE_FORMATS = ['.docx', '.pdf'] as const;

/** A file upload: its original filename (for extension detection) and bytes. */
export interface FileUploadSource {
  readonly kind: 'file';
  readonly fileName: string;
  readonly bytes: Buffer | Uint8Array;
}

/** Pasted text supplied directly by the User (no file, no extraction). */
export interface PastedTextSource {
  readonly kind: 'paste';
  readonly pastedText: string;
}

export type IngestSource = FileUploadSource | PastedTextSource;

/** Injectable collaborators for the two file-extraction formats. */
export interface IngestionDeps {
  readonly docxExtractor: DocxExtractor;
  readonly pdfExtractor: PdfExtractor | RichPdfExtractor;
}

/** Extraction produced usable paragraph segments. */
export interface IngestSuccess {
  readonly status: 'success';
  readonly segments: Segment[];
  /** TipTap JSON when PDF rich extraction succeeded (server source of truth). */
  readonly content?: TipTapDoc;
  readonly header?: TipTapDoc | null;
  readonly footer?: TipTapDoc | null;
  readonly ocrConfidence?: number;
}

/**
 * No recoverable text could be extracted (Requirement 6.1.4): informs the
 * caller and offers the `.docx`-upload / paste-text fallback rather than
 * throwing or silently producing an empty Draft.
 */
export interface IngestFallback {
  readonly status: 'fallback';
  readonly reason: string;
}

export type IngestResult = IngestSuccess | IngestFallback;

const FALLBACK_MESSAGE =
  'We could not extract readable text from this PDF. For best results upload a ' +
  '.docx file, try a clearer scan, or paste the text directly.';

function acceptedFormatsMessage(fileName: string): string {
  return (
    `Unsupported file format for "${fileName}". WREN accepts ` +
    `${ACCEPTED_FILE_FORMATS.join(' and ')} files.`
  );
}

/** Lower-cased file extension including the leading dot, or `''` if none. */
function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot < 0 || lastDot === fileName.length - 1) return '';
  return fileName.slice(lastDot).toLowerCase();
}

function toBuffer(bytes: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
}

function isRichPdfExtractor(
  extractor: PdfExtractor | RichPdfExtractor,
): extractor is RichPdfExtractor {
  return typeof (extractor as RichPdfExtractor).extractRich === 'function';
}

/**
 * Ingest a User-supplied source into ordered, stably-indexed paragraph
 * segments. See the module comment for the per-source-kind behavior.
 *
 * @throws {UnsupportedFileFormatError} if a file source's extension is not
 *   `.docx` or `.pdf`. This check happens before any extraction attempt.
 */
export async function ingestUpload(
  source: IngestSource,
  deps: IngestionDeps,
): Promise<IngestResult> {
  if (source.kind === 'paste') {
    return { status: 'success', segments: segmentParagraphs(source.pastedText) };
  }

  const extension = extensionOf(source.fileName);
  if (extension !== '.docx' && extension !== '.pdf') {
    throw new UnsupportedFileFormatError(acceptedFormatsMessage(source.fileName));
  }

  const bytes = toBuffer(source.bytes);

  if (extension === '.docx') {
    const text = await deps.docxExtractor.extract(bytes);
    return { status: 'success', segments: segmentParagraphs(text) };
  }

  // .pdf: rich TipTap when available; otherwise plain text.
  try {
    if (isRichPdfExtractor(deps.pdfExtractor)) {
      const rich = await deps.pdfExtractor.extractRich(bytes);
      const segmentsFromContent = tipTapContentToSegments(rich.content);
      const hasContentText = segmentsFromContent.some((s) => s.text.trim().length > 0);
      const hasPlainText = rich.text.trim().length > 0;
      if (!hasContentText && !hasPlainText) {
        return { status: 'fallback', reason: FALLBACK_MESSAGE };
      }
      return {
        status: 'success',
        segments: hasContentText ? segmentsFromContent : segmentParagraphs(rich.text),
        content: rich.content,
        ...(rich.header ? { header: rich.header } : {}),
        ...(rich.footer ? { footer: rich.footer } : {}),
        ...(typeof rich.ocrConfidence === 'number' ? { ocrConfidence: rich.ocrConfidence } : {}),
      };
    }

    const text = await deps.pdfExtractor.extract(bytes);
    if (text.trim().length === 0) {
      return { status: 'fallback', reason: FALLBACK_MESSAGE };
    }
    return { status: 'success', segments: segmentParagraphs(text) };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ingestUpload] PDF extraction threw:', err);
    return { status: 'fallback', reason: FALLBACK_MESSAGE };
  }
}
