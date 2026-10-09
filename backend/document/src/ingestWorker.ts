/**
 * SQS worker: download PDF from S3 → OCR via Textract → Draft.
 */
import { getDataAccess } from '@wren/db-node';
import type { TipTapDoc } from '@wren/types';
import {
  charCountFromTipTapContent,
  tipTapContentToSegments,
  wordCountFromTipTapContent,
} from '@wren/types';
import { getPlatformUsagePolicy } from '@wren/admin/lifetimeUsagePolicy';
import { validate as isUuid } from 'uuid';

import { createDraftRevision } from './draftVersioning.js';
import { DbDraftRepository, type QueryExecutor } from './draftRepository.js';
import { UnsupportedFileFormatError } from './errors.js';
import { ingestUpload } from './ingestion.js';
import {
  loadIngestJob,
  markIngestJobCompleted,
  markIngestJobFailed,
  markIngestJobProcessing,
} from './ingestJob.js';
import { MammothDocxExtractor } from './docxExtractor.js';
import { createPdfExtractor } from './ocrFactory.js';
import { countChars, effectiveCharLimit, enforceSizeLimit } from './sizeLimit.js';

const docxExtractor = new MammothDocxExtractor();

/**
 * The producer's SQS payload. The consumer trusts ONLY `jobId` from this
 * message — every other value is re-derived from the persisted job row and the
 * database, so the remaining fields are retained purely for the producer-side
 * contract and are never read on the consumer path.
 */
export interface IngestQueueMessage {
  readonly jobId: string;
  readonly documentId: string;
  readonly s3Key: string;
  readonly fileName: string;
  readonly userId: string;
  readonly sizeLimitWords: number | null;
  readonly platformSizeLimitWords?: number | null;
  readonly ocrEngine?: string;
}

/** The only field the consumer treats as authoritative from the queue. */
export interface IngestQueueTrigger {
  readonly jobId: string;
}

export type ReadS3Bytes = (key: string) => Promise<Buffer>;

/**
 * Parse and validate an SQS record body. The body is attacker-controllable by
 * any principal able to send to the ingest queue (or redrive its DLQ), so it is
 * reduced to the single value used as a database lookup key: a well-formed
 * `jobId`. Returns `null` for any malformed body so the caller can drop the
 * record instead of acting on unvalidated input.
 */
export function parseIngestQueueMessage(rawBody: string): IngestQueueTrigger | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const jobId = (body as { jobId?: unknown }).jobId;
  if (typeof jobId !== 'string' || jobId.trim() === '' || !isUuid(jobId)) {
    return null;
  }
  return { jobId };
}

/**
 * Re-derive the effective word caps for a document from the database, keyed off
 * the authoritative document id on the job row. Mirrors the producer: the
 * Document Type's `size_limit_words` (null → platform default) plus the
 * platform policy ceiling. Returns `null` when the document no longer exists.
 */
async function loadSizeLimitsForDocument(
  db: QueryExecutor,
  documentId: string,
): Promise<{ sizeLimitWords: number | null; platformSizeLimitWords: number | null } | null> {
  const rows = await db.query<{ size_limit_words: number | null }>(
    `SELECT dt.size_limit_words
     FROM document d
     JOIN document_type dt ON dt.id = d.document_type_id
     WHERE d.id = $1`,
    [documentId],
  );
  if (rows.length === 0) return null;
  const sizeLimitWords =
    typeof rows[0]!.size_limit_words === 'number' ? rows[0]!.size_limit_words : null;
  const policy = await getPlatformUsagePolicy(db);
  return { sizeLimitWords, platformSizeLimitWords: policy.maxWordCount };
}

export async function processIngestQueueMessage(
  message: IngestQueueTrigger,
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

  const bucket = process.env.DOCUMENTS_BUCKET_NAME;

  try {
    const limits = await loadSizeLimitsForDocument(db, job.documentId);
    if (!limits) {
      await markIngestJobFailed(db, message.jobId, 'Target document no longer exists');
      return;
    }

    const bytes = await readS3ObjectBytes(job.s3Key);

    const { extractor } = createPdfExtractor({
      s3Bucket: bucket,
      s3Key: job.s3Key,
    });

    const ingestResult = await ingestUpload(
      { kind: 'file', fileName: job.fileName, bytes },
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
      documentTypeSizeLimitWords: limits.sizeLimitWords,
      platformSizeLimitWords: limits.platformSizeLimitWords,
    });
    if (sizeResult.status === 'over-limit') {
      await markIngestJobFailed(db, message.jobId, sizeResult.message);
      return;
    }

    // Include header and footer in the total — they are stored in the draft
    // and fed to AI prompts just like body content. Gate on BOTH the word
    // count and the defense-in-depth character ceiling: a whitespace-free blob
    // in the header/footer measures as a few words but can be arbitrarily
    // large, so the word-only check would let oversized content through
    // (f-c5f5a972). Mirrors the body char ceiling in enforceSizeLimit and the
    // header/footer char gate in lambda-handler.ts.
    const headerFooterWords =
      (ingestResult.header ? wordCountFromTipTapContent(ingestResult.header as TipTapDoc) : 0) +
      (ingestResult.footer ? wordCountFromTipTapContent(ingestResult.footer as TipTapDoc) : 0);
    const headerFooterChars =
      (ingestResult.header ? charCountFromTipTapContent(ingestResult.header as TipTapDoc) : 0) +
      (ingestResult.footer ? charCountFromTipTapContent(ingestResult.footer as TipTapDoc) : 0);
    if (headerFooterWords > 0 || headerFooterChars > 0) {
      const effectiveLimit = sizeResult.effectiveLimitWords;
      const effectiveLimitChars = effectiveCharLimit(effectiveLimit);
      const bodyWords = storedContent
        ? wordCountFromTipTapContent(storedContent)
        : sizeResult.measuredWords;
      const bodyChars = storedContent
        ? charCountFromTipTapContent(storedContent)
        : countChars(segments);
      const totalWords = bodyWords + headerFooterWords;
      const totalChars = bodyChars + headerFooterChars;
      if (totalWords > effectiveLimit) {
        await markIngestJobFailed(
          db,
          message.jobId,
          `Document exceeds the ${effectiveLimit}-word limit (${totalWords} words including header and footer).`,
        );
        return;
      }
      if (totalChars > effectiveLimitChars) {
        await markIngestJobFailed(
          db,
          message.jobId,
          `Document exceeds the ${effectiveLimitChars}-character limit (${totalChars} characters including header and footer).`,
        );
        return;
      }
    }

    const draftRepo = new DbDraftRepository(db);
    const { draft } = await createDraftRevision(
      {
        documentId: job.documentId,
        segments,
        wordCount:
          (storedContent
            ? wordCountFromTipTapContent(storedContent)
            : sizeResult.measuredWords) + headerFooterWords,
        s3Key: job.s3Key,
        ...(storedContent ? { content: storedContent } : {}),
        ...(ingestResult.header ? { header: ingestResult.header } : {}),
        ...(ingestResult.footer ? { footer: ingestResult.footer } : {}),
        ...(typeof ingestResult.ocrConfidence === 'number'
          ? { ocrConfidence: ingestResult.ocrConfidence }
          : {}),
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
    await markIngestJobFailed(db, message.jobId, detail);
  }
}
