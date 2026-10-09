/**
 * The ingest SQS consumer must treat the persisted job row and the database as
 * the sole source of authority. The queue body is reduced to a validated
 * `jobId`; every other value (s3Key, documentId, fileName, word caps) is
 * re-derived server-side, so a crafted or forged message cannot redirect a
 * student's extracted text onto another student's document or lift the word
 * cap.
 */
import { jest } from '@jest/globals';

const query = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>();
jest.mock('@wren/db-node', () => ({
  getDataAccess: jest.fn(async () => ({ query })),
}));

const getPlatformUsagePolicy = jest.fn(async () => ({
  messageLimit: 100,
  debriefGenerationLimit: 15,
  documentUploadLimit: 30,
  draftsPerDocumentLimit: 15,
  maxUploadFileSizeBytes: 30 * 1024 * 1024,
  maxWordCount: 10_000,
}));
jest.mock('@wren/admin/lifetimeUsagePolicy', () => ({ getPlatformUsagePolicy }));

const loadIngestJob = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const markIngestJobProcessing = jest.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
const markIngestJobCompleted = jest.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const markIngestJobFailed = jest.fn<(...args: unknown[]) => Promise<void>>(async () => {});
jest.mock('./ingestJob.js', () => ({
  loadIngestJob,
  markIngestJobProcessing,
  markIngestJobCompleted,
  markIngestJobFailed,
}));

const ingestUpload = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock('./ingestion.js', () => ({ ingestUpload }));

const createPdfExtractor = jest.fn(() => ({ extractor: {} }));
jest.mock('./ocrFactory.js', () => ({ createPdfExtractor }));

const createDraftRevision = jest.fn<(...args: unknown[]) => Promise<{ draft: { id: string } }>>(
  async () => ({ draft: { id: 'draft-1' } }),
);
jest.mock('./draftVersioning.js', () => ({ createDraftRevision }));

jest.mock('./draftRepository.js', () => ({ DbDraftRepository: jest.fn() }));

import { processIngestQueueMessage, parseIngestQueueMessage } from './ingestWorker.js';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
// Values the attacker would have put in the message; the row carries different,
// authoritative values below.
const ROW = {
  id: JOB_ID,
  documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  s3Key: 'documents/owner-user/real.pdf',
  fileName: 'real.pdf',
  status: 'queued' as const,
  errorMessage: null,
  draftId: null,
  ocrEngine: 'textract',
  comparison: null,
};

const readS3 = jest.fn(async () => Buffer.from('pdf-bytes'));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DOCUMENTS_BUCKET_NAME = 'test-bucket';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  markIngestJobProcessing.mockResolvedValue(true);
});

describe('parseIngestQueueMessage', () => {
  it('drops bodies that are not valid JSON', () => {
    expect(parseIngestQueueMessage('{not json')).toBeNull();
  });

  it('drops bodies that are not an object', () => {
    expect(parseIngestQueueMessage('"a string"')).toBeNull();
    expect(parseIngestQueueMessage('42')).toBeNull();
  });

  it('drops bodies with a missing or non-UUID jobId', () => {
    expect(parseIngestQueueMessage(JSON.stringify({ documentId: 'x' }))).toBeNull();
    expect(parseIngestQueueMessage(JSON.stringify({ jobId: '' }))).toBeNull();
    expect(parseIngestQueueMessage(JSON.stringify({ jobId: 'not-a-uuid' }))).toBeNull();
    expect(parseIngestQueueMessage(JSON.stringify({ jobId: 123 }))).toBeNull();
  });

  it('accepts a well-formed jobId and returns only that field', () => {
    const extra = { jobId: JOB_ID, documentId: 'forged', s3Key: 'forged', userId: 'forged' };
    expect(parseIngestQueueMessage(JSON.stringify(extra))).toEqual({ jobId: JOB_ID });
  });
});

describe('processIngestQueueMessage uses the job row, not the message', () => {
  it('reads S3 and writes the draft against the row values', async () => {
    loadIngestJob.mockResolvedValue(ROW);
    query.mockResolvedValue([{ size_limit_words: null }]);
    ingestUpload.mockResolvedValue({
      status: 'success',
      segments: [{ index: 0, text: 'hello world' }],
    });

    await processIngestQueueMessage({ jobId: JOB_ID }, readS3);

    // S3 byte fetch and Textract both key off the row's s3Key.
    expect(readS3).toHaveBeenCalledWith(ROW.s3Key);
    expect(createPdfExtractor).toHaveBeenCalledWith(
      expect.objectContaining({ s3Key: ROW.s3Key }),
    );
    // The immutable draft is committed against the row's documentId + s3Key.
    expect(createDraftRevision).toHaveBeenCalledTimes(1);
    const draftInput = createDraftRevision.mock.calls[0]![0] as unknown as {
      documentId: string;
      s3Key: string;
    };
    expect(draftInput.documentId).toBe(ROW.documentId);
    expect(draftInput.s3Key).toBe(ROW.s3Key);
    expect(markIngestJobCompleted).toHaveBeenCalledWith(expect.anything(), JOB_ID, 'draft-1');
  });

  it('re-derives size limits from the DB and ignores any claimed cap', async () => {
    loadIngestJob.mockResolvedValue(ROW);
    // DB-derived Document Type cap is small; the platform cap is large.
    query.mockResolvedValue([{ size_limit_words: 3 }]);
    ingestUpload.mockResolvedValue({
      status: 'success',
      segments: [{ index: 0, text: 'one two three four five' }],
    });

    await processIngestQueueMessage({ jobId: JOB_ID }, readS3);

    // The 5-word document exceeds the DB cap of 3 → failed, no draft written.
    expect(createDraftRevision).not.toHaveBeenCalled();
    expect(markIngestJobFailed).toHaveBeenCalledTimes(1);
    expect(markIngestJobCompleted).not.toHaveBeenCalled();
  });

  it('fails closed when the target document no longer exists', async () => {
    loadIngestJob.mockResolvedValue(ROW);
    query.mockResolvedValue([]);

    await processIngestQueueMessage({ jobId: JOB_ID }, readS3);

    expect(readS3).not.toHaveBeenCalled();
    expect(createDraftRevision).not.toHaveBeenCalled();
    expect(markIngestJobFailed).toHaveBeenCalledWith(
      expect.anything(),
      JOB_ID,
      'Target document no longer exists',
    );
  });
});
