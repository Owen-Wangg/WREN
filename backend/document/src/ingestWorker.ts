/**
 * SQS worker: download PDF from S3 → LiteParse/OCR → create immutable Draft.
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
} from './ingestJob.js';
import { MammothDocxExtractor } from './docxExtractor.js';
import { LiteParsePdfExtractor } from './pdfExtractor.js';
import { enforceSizeLimit } from './sizeLimit.js';

const docxExtractor = new MammothDocxExtractor();
const pdfExtractor = new LiteParsePdfExtractor();

export interface IngestQueueMessage {
  readonly jobId: string;
  readonly documentId: string;
  readonly s3Key: string;
  readonly fileName: string;
  readonly userId: string;
  readonly sizeLimitWords: number | null;
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

  try {
    const bytes = await readS3ObjectBytes(message.s3Key);
    const ingestResult = await ingestUpload(
      { kind: 'file', fileName: message.fileName, bytes },
      { docxExtractor, pdfExtractor },
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
          : 'PDF extraction failed';
    console.error(`Ingest job ${message.jobId} failed:`, error);
    await markIngestJobFailed(db, message.jobId, detail);
    // Do not rethrow after recording failure — avoid endless SQS retries for
    // permanent extraction errors. Transient S3/DB errors that happen before
    // markIngestJobFailed will still retry via SQS.
  }
}
