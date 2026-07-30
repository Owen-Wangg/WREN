/**
 * SQS worker: download PDF from S3 → OCR (Tesseract and/or Textract) → Draft.
 */
import { getDataAccess } from '@wren/db-node';
import type { TipTapDoc } from '@wren/types';
import { tipTapContentToSegments, wordCountFromTipTapContent } from '@wren/types';

import { createDraftRevision } from './draftVersioning.js';
import { DbDraftRepository } from './draftRepository.js';
import { UnsupportedFileFormatError } from './errors.js';
import { ingestUpload } from './ingestion.js';
import {
  loadIngestJob,
  markIngestJobCompleted,
  markIngestJobFailed,
  markIngestJobProcessing,
  type OcrComparisonResult,
} from './ingestJob.js';
import { MammothDocxExtractor } from './docxExtractor.js';
import { LiteParsePdfExtractor } from './pdfExtractor.js';
import { createPdfExtractor } from './ocrFactory.js';
import { enforceSizeLimit } from './sizeLimit.js';
import { extractWithTextract, resolveOcrEngine } from './textractOcr.js';

const docxExtractor = new MammothDocxExtractor();

export interface IngestQueueMessage {
  readonly jobId: string;
  readonly documentId: string;
  readonly s3Key: string;
  readonly fileName: string;
  readonly userId: string;
  readonly sizeLimitWords: number | null;
  readonly ocrEngine?: string;
}

export type ReadS3Bytes = (key: string) => Promise<Buffer>;

export async function processIngestQueueMessage(
  message: IngestQueueMessage,
  readS3ObjectBytes: ReadS3Bytes,
): Promise<void> {
  const db = await getDataAccess();
  const job = await loadIngestJob(db, message.jobId);
  if (!job) {
    console.warn(`Ingest job ${message.jobId} not found — skipping`);
    return;
  }
  if (job.status === 'completed') {
    return;
  }

  const claimed = await markIngestJobProcessing(db, message.jobId);
  if (!claimed) {
    console.warn(`Ingest job ${message.jobId} could not be claimed`);
    return;
  }

  const engine = resolveOcrEngine(message.ocrEngine ?? job.ocrEngine);
  const bucket = process.env.DOCUMENTS_BUCKET_NAME;
  let comparison: OcrComparisonResult | null = null;

  try {
    const bytes = await readS3ObjectBytes(message.s3Key);

    if (engine === 'compare') {
      const tesseractExtractor = new LiteParsePdfExtractor();
      const t0 = Date.now();
      let tesseractText = '';
      let tesseractMs = 0;
      let tesseractContent: TipTapDoc | undefined;
      try {
        const rich = await tesseractExtractor.extractRich(bytes);
        tesseractText = rich.text;
        tesseractContent = rich.content;
        tesseractMs = Date.now() - t0;
      } catch (error) {
        tesseractMs = Date.now() - t0;
        tesseractText = error instanceof Error ? `[tesseract error] ${error.message}` : '[tesseract error]';
      }

      let textractText = '';
      let textractMs = 0;
      let textractContent: TipTapDoc | undefined;
      try {
        const textract = await extractWithTextract({
          bytes,
          ...(bucket ? { s3Bucket: bucket, s3Key: message.s3Key } : {}),
        });
        textractText = textract.text;
        textractContent = textract.content;
        textractMs = textract.durationMs;
      } catch (error) {
        textractText = error instanceof Error ? `[textract error] ${error.message}` : '[textract error]';
      }

      comparison = {
        tesseract: {
          text: tesseractText,
          durationMs: tesseractMs,
          textLength: tesseractText.length,
        },
        textract: {
          text: textractText,
          durationMs: textractMs,
          textLength: textractText.length,
        },
        primaryEngine: 'tesseract',
      };

      // Prefer Tesseract for the persisted draft when compare succeeds;
      // fall back to Textract content if Tesseract failed.
      const storedContent = tesseractContent ?? textractContent;
      if (!storedContent) {
        await markIngestJobFailed(
          db,
          message.jobId,
          'Both OCR engines failed during comparison',
          comparison,
        );
        return;
      }

      const segments = tipTapContentToSegments(storedContent);
      const sizeResult = enforceSizeLimit(segments, {
        documentTypeSizeLimitWords: message.sizeLimitWords,
      });
      if (sizeResult.status === 'over-limit') {
        await markIngestJobFailed(db, message.jobId, sizeResult.message, comparison);
        return;
      }

      const draftRepo = new DbDraftRepository(db);
      const { draft } = await createDraftRevision(
        {
          documentId: message.documentId,
          segments,
          wordCount: wordCountFromTipTapContent(storedContent),
          s3Key: message.s3Key,
          content: storedContent,
        },
        draftRepo,
      );
      await markIngestJobCompleted(db, message.jobId, draft.id, comparison);
      return;
    }

    const { extractor } = createPdfExtractor({
      engine,
      s3Bucket: bucket,
      s3Key: message.s3Key,
    });

    const ingestResult = await ingestUpload(
      { kind: 'file', fileName: message.fileName, bytes },
      { docxExtractor, pdfExtractor: extractor },
    );

    if (ingestResult.status === 'fallback') {
      await markIngestJobFailed(db, message.jobId, ingestResult.reason);
      return;
    }

    const storedContent = ingestResult.content as TipTapDoc | undefined;
    const segments = storedContent
      ? tipTapContentToSegments(storedContent)
      : ingestResult.segments;
    const sizeResult = enforceSizeLimit(segments, {
      documentTypeSizeLimitWords: message.sizeLimitWords,
    });
    if (sizeResult.status === 'over-limit') {
      await markIngestJobFailed(db, message.jobId, sizeResult.message);
      return;
    }

    const draftRepo = new DbDraftRepository(db);
    const { draft } = await createDraftRevision(
      {
        documentId: message.documentId,
        segments,
        wordCount: storedContent
          ? wordCountFromTipTapContent(storedContent)
          : sizeResult.measuredWords,
        s3Key: message.s3Key,
        ...(storedContent ? { content: storedContent } : {}),
      },
      draftRepo,
    );

    await markIngestJobCompleted(db, message.jobId, draft.id);
  } catch (error) {
    const detail =
      error instanceof UnsupportedFileFormatError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Ingest failed';
    await markIngestJobFailed(db, message.jobId, detail, comparison);
  }
}
