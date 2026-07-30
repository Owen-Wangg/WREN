/**
 * Async PDF ingest jobs — enqueue + status + worker completion.
 * Keeps sync API responses under API Gateway’s ~29s limit while LiteParse/OCR
 * may run up to the Document Lambda timeout (~3 min).
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuid } from 'uuid';

import type { QueryExecutor } from './draftRepository.js';
import { resolveOcrEngine } from './textractOcr.js';

export type IngestJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface OcrComparisonResult {
  readonly tesseract?: { readonly text: string; readonly durationMs: number; readonly textLength: number };
  readonly textract?: { readonly text: string; readonly durationMs: number; readonly textLength: number };
  readonly primaryEngine: string;
}

export interface DocumentIngestJob {
  readonly id: string;
  readonly documentId: string;
  readonly s3Key: string;
  readonly fileName: string;
  readonly status: IngestJobStatus;
  readonly errorMessage: string | null;
  readonly draftId: string | null;
  readonly ocrEngine: string;
  readonly comparison: OcrComparisonResult | null;
}

const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'ca-central-1' });

export function isPdfFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.pdf');
}

/** True when this upload should run off the HTTP request path. */
export function shouldIngestPdfAsync(fileName: string, hasClientTipTap: boolean): boolean {
  return isPdfFileName(fileName) && !hasClientTipTap;
}

export async function insertQueuedIngestJob(
  db: QueryExecutor,
  input: {
    documentId: string;
    s3Key: string;
    fileName: string;
    ocrEngine?: string | null;
  },
): Promise<DocumentIngestJob> {
  const id = uuid();
  const ocrEngine = resolveOcrEngine(input.ocrEngine);
  const rows = await db.query<{
    id: string;
    document_id: string;
    s3_key: string;
    file_name: string;
    status: IngestJobStatus;
    error_message: string | null;
    draft_id: string | null;
    ocr_engine: string;
    comparison: unknown;
  }>(
    `INSERT INTO document_ingest_job (id, document_id, s3_key, file_name, status, ocr_engine)
     VALUES ($1, $2, $3, $4, 'queued', $5)
     RETURNING id, document_id, s3_key, file_name, status, error_message, draft_id, ocr_engine, comparison`,
    [id, input.documentId, input.s3Key, input.fileName, ocrEngine],
  );
  return mapJobRow(rows[0]!);
}

export async function enqueueIngestJob(job: {
  jobId: string;
  documentId: string;
  s3Key: string;
  fileName: string;
  userId: string;
  sizeLimitWords: number | null;
  ocrEngine?: string | null;
}): Promise<void> {
  const queueUrl = process.env.DOCUMENT_INGEST_QUEUE_URL;
  if (!queueUrl) {
    throw new Error('DOCUMENT_INGEST_QUEUE_URL is not configured');
  }
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({
        jobId: job.jobId,
        documentId: job.documentId,
        s3Key: job.s3Key,
        fileName: job.fileName,
        userId: job.userId,
        sizeLimitWords: job.sizeLimitWords,
        ocrEngine: resolveOcrEngine(job.ocrEngine),
        enqueuedAt: new Date().toISOString(),
      }),
    }),
  );
}

export async function markIngestJobProcessing(
  db: QueryExecutor,
  jobId: string,
): Promise<boolean> {
  const rows = await db.query(
    `UPDATE document_ingest_job
     SET status = 'processing', updated_at = NOW()
     WHERE id = $1 AND status IN ('queued', 'processing')
     RETURNING id`,
    [jobId],
  );
  return rows.length > 0;
}

export async function markIngestJobCompleted(
  db: QueryExecutor,
  jobId: string,
  draftId: string,
  comparison?: OcrComparisonResult | null,
): Promise<void> {
  await db.query(
    `UPDATE document_ingest_job
     SET status = 'completed',
         draft_id = $2,
         error_message = NULL,
         comparison = $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [jobId, draftId, comparison ? JSON.stringify(comparison) : null],
  );
}

export async function markIngestJobFailed(
  db: QueryExecutor,
  jobId: string,
  errorMessage: string,
  comparison?: OcrComparisonResult | null,
): Promise<void> {
  await db.query(
    `UPDATE document_ingest_job
     SET status = 'failed',
         error_message = $2,
         comparison = $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [jobId, errorMessage.slice(0, 2000), comparison ? JSON.stringify(comparison) : null],
  );
}

function parseComparison(value: unknown): OcrComparisonResult | null {
  if (!value || typeof value !== 'object') return null;
  return value as OcrComparisonResult;
}

function mapJobRow(row: {
  id: string;
  document_id: string;
  s3_key: string;
  file_name: string;
  status: IngestJobStatus;
  error_message: string | null;
  draft_id: string | null;
  ocr_engine?: string | null;
  comparison?: unknown;
}): DocumentIngestJob {
  return {
    id: row.id,
    documentId: row.document_id,
    s3Key: row.s3_key,
    fileName: row.file_name,
    status: row.status,
    errorMessage: row.error_message,
    draftId: row.draft_id,
    ocrEngine: row.ocr_engine ?? 'tesseract',
    comparison: parseComparison(row.comparison),
  };
}

export async function getLatestIngestStatus(
  db: QueryExecutor,
  documentId: string,
): Promise<{
  status: IngestJobStatus | 'pending';
  jobId?: string;
  draftId?: string;
  errorMessage?: string;
  ocrEngine?: string;
  comparison?: OcrComparisonResult;
}> {
  const rows = await db.query<{
    id: string;
    status: IngestJobStatus;
    draft_id: string | null;
    error_message: string | null;
    ocr_engine: string | null;
    comparison: unknown;
  }>(
    `SELECT id, status, draft_id, error_message, ocr_engine, comparison
     FROM document_ingest_job
     WHERE document_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [documentId],
  );
  if (rows.length === 0) {
    return { status: 'pending' };
  }
  const row = rows[0]!;
  const comparison = parseComparison(row.comparison);
  return {
    status: row.status,
    jobId: row.id,
    ...(row.draft_id ? { draftId: row.draft_id } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
    ...(row.ocr_engine ? { ocrEngine: row.ocr_engine } : {}),
    ...(comparison ? { comparison } : {}),
  };
}

export async function loadIngestJob(
  db: QueryExecutor,
  jobId: string,
): Promise<DocumentIngestJob | null> {
  const rows = await db.query<{
    id: string;
    document_id: string;
    s3_key: string;
    file_name: string;
    status: IngestJobStatus;
    error_message: string | null;
    draft_id: string | null;
    ocr_engine: string | null;
    comparison: unknown;
  }>(
    `SELECT id, document_id, s3_key, file_name, status, error_message, draft_id, ocr_engine, comparison
     FROM document_ingest_job WHERE id = $1`,
    [jobId],
  );
  if (rows.length === 0) return null;
  return mapJobRow(rows[0]!);
}
