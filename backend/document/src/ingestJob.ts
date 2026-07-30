/**
 * Async PDF ingest jobs — enqueue + status + worker completion.
 * Keeps sync API responses under API Gateway’s ~29s limit while LiteParse/OCR
 * may run up to the Document Lambda timeout (~3 min).
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuid } from 'uuid';

import type { QueryExecutor } from './draftRepository.js';

export type IngestJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface DocumentIngestJob {
  readonly id: string;
  readonly documentId: string;
  readonly s3Key: string;
  readonly fileName: string;
  readonly status: IngestJobStatus;
  readonly errorMessage: string | null;
  readonly draftId: string | null;
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
  input: { documentId: string; s3Key: string; fileName: string },
): Promise<DocumentIngestJob> {
  const id = uuid();
  const rows = await db.query<{
    id: string;
    document_id: string;
    s3_key: string;
    file_name: string;
    status: IngestJobStatus;
    error_message: string | null;
    draft_id: string | null;
  }>(
    `INSERT INTO document_ingest_job (id, document_id, s3_key, file_name, status)
     VALUES ($1, $2, $3, $4, 'queued')
     RETURNING id, document_id, s3_key, file_name, status, error_message, draft_id`,
    [id, input.documentId, input.s3Key, input.fileName],
  );
  const row = rows[0]!;
  return {
    id: row.id,
    documentId: row.document_id,
    s3Key: row.s3_key,
    fileName: row.file_name,
    status: row.status,
    errorMessage: row.error_message,
    draftId: row.draft_id,
  };
}

export async function enqueueIngestJob(job: {
  jobId: string;
  documentId: string;
  s3Key: string;
  fileName: string;
  userId: string;
  sizeLimitWords: number | null;
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
): Promise<void> {
  await db.query(
    `UPDATE document_ingest_job
     SET status = 'completed', draft_id = $2, error_message = NULL, updated_at = NOW()
     WHERE id = $1`,
    [jobId, draftId],
  );
}

export async function markIngestJobFailed(
  db: QueryExecutor,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  await db.query(
    `UPDATE document_ingest_job
     SET status = 'failed', error_message = $2, updated_at = NOW()
     WHERE id = $1`,
    [jobId, errorMessage.slice(0, 2000)],
  );
}

export async function getLatestIngestStatus(
  db: QueryExecutor,
  documentId: string,
): Promise<{
  status: IngestJobStatus | 'pending';
  jobId?: string;
  draftId?: string;
  errorMessage?: string;
}> {
  const rows = await db.query<{
    id: string;
    status: IngestJobStatus;
    draft_id: string | null;
    error_message: string | null;
  }>(
    `SELECT id, status, draft_id, error_message
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
  return {
    status: row.status,
    jobId: row.id,
    ...(row.draft_id ? { draftId: row.draft_id } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
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
  }>(
    `SELECT id, document_id, s3_key, file_name, status, error_message, draft_id
     FROM document_ingest_job WHERE id = $1`,
    [jobId],
  );
  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    id: row.id,
    documentId: row.document_id,
    s3Key: row.s3_key,
    fileName: row.file_name,
    status: row.status,
    errorMessage: row.error_message,
    draftId: row.draft_id,
  };
}
