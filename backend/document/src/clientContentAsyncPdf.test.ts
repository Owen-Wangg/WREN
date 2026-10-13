/**
 * Regression guard: a PDF file upload is ALWAYS ingested off the request path,
 * even when the caller supplies client TipTap `content`. Previously a crafted
 * request carrying a bare `{type:'doc'}` flipped the PDF onto the synchronous
 * branch, which ran in-request Textract OCR (holding a Lambda slot for the
 * ~120s poll loop) and then discarded the result. The async/sync decision now
 * depends only on the server-known file type, so `ingestUpload` (pdf.js/
 * Textract) MUST NOT run in-request and no object bytes are fetched; the
 * request returns the async "queued" response instead.
 */
import { jest } from '@jest/globals';

class TestUsageLimitReachedError extends Error {
  readonly code = 'USAGE_LIMIT_REACHED';
  constructor(message = 'limit reached') {
    super(message);
    this.name = 'UsageLimitReachedError';
  }
}
const reserveDocumentUpload = jest.fn<() => Promise<number>>();
const reserveDraftCreate = jest.fn<() => Promise<number>>();
const getPlatformUsagePolicy = jest.fn(async () => ({
  messageLimit: 100,
  debriefGenerationLimit: 15,
  documentUploadLimit: 30,
  draftsPerDocumentLimit: 15,
  maxUploadFileSizeBytes: 30 * 1024 * 1024,
  maxWordCount: 10_000,
}));

jest.mock('@wren/admin/lifetimeUsagePolicy', () => ({
  UsageLimitReachedError: TestUsageLimitReachedError,
  getPlatformUsagePolicy,
  reserveDocumentUpload,
  reserveDraftCreate,
  assertDocumentUploadAllowed: jest.fn(async () => {}),
}));

// The expensive pdf.js/Textract seam that must NOT be reached in-request.
const ingestUpload = jest.fn();
jest.mock('./ingestion.js', () => ({ ingestUpload }));

// Keep shouldIngestPdfAsync real; stub the DB insert and SQS enqueue seams.
const insertQueuedIngestJob = jest.fn(async () => ({ id: 'job-1' }));
const enqueueIngestJob = jest.fn(async () => {});
jest.mock('./ingestJob.js', () => {
  const actual = jest.requireActual<typeof import('./ingestJob.js')>('./ingestJob.js');
  return {
    ...actual,
    insertQueuedIngestJob,
    enqueueIngestJob,
    markIngestJobFailed: jest.fn(async () => {}),
  };
});

jest.mock('@wren/auth', () => ({
  resolveAccess: jest.fn(async () => 'OPEN'),
  bindCorsOrigin: jest.fn(),
  withCorsHeaders: (res: unknown) => res,
  rejectIfForgedAuthContext: jest.fn(async () => null),
  // Real submission gate so it runs against the DB seam below.
  ...jest.requireActual<object>('../../auth/src/submissionAccess'),
}));

// Capture S3 commands so we can assert no GetObject (no byte fetch) happens.
const s3Send = jest.fn(async () => ({}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: s3Send })),
  GetObjectCommand: jest.fn((input: unknown) => ({ __command: 'GetObject', input })),
  DeleteObjectsCommand: jest.fn((input: unknown) => ({ __command: 'DeleteObjects', input })),
  DeleteObjectTaggingCommand: jest.fn((input: unknown) => ({ __command: 'DeleteObjectTagging', input })),
  PutObjectTaggingCommand: jest.fn((input: unknown) => ({ __command: 'PutObjectTagging', input })),
}));

const query = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>();
const transaction = jest.fn<(fn: (tx: unknown) => unknown) => Promise<unknown>>();
jest.mock('@wren/db-node', () => ({
  getDataAccess: jest.fn(async () => ({ query, transaction })),
  freezeEventLoopOnReturn: jest.fn(),
  recordActivityEventRow: jest.fn(),
}));

import { handler } from './lambda-handler.js';

const authorizer = {
  userId: 'user-1',
  idpSubject: 'idp-1',
  email: 'student@example.com',
  roles: JSON.stringify(['Student']),
  administeredDepartmentIds: '[]',
  grants: '[]',
};
const UPLOAD_KEY = 'documents/user-1/uploads/uuid-file.pdf';
// The exact payload the finding used to flip the PDF onto the sync OCR branch.
const CLIENT_CONTENT = { type: 'doc' };

function commandTypes(): string[] {
  return s3Send.mock.calls.map((c) => ((c as unknown[])[0] as { __command: string }).__command);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DOCUMENTS_BUCKET_NAME = 'test-bucket';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('create-document: PDF with client content is still ingested async', () => {
  beforeEach(() => {
    query.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('FROM document_type dt')) {
        return [{ id: 'dt-1', access_state: 'OPEN', size_limit_words: null, archived_at: null }];
      }
      if (sql.includes('FROM content_type')) return [{ id: 'ct-1' }];
      return [];
    });
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        query: async (sql: string): Promise<unknown[]> =>
          sql.includes('INSERT INTO document')
            ? [{ id: 'doc-1', owner_user_id: 'user-1', document_type_id: 'dt-1', name: 'Test Doc', metadata: {}, status: 'Still Drafting', created_at: new Date() }]
            : [],
        execute: async () => 0,
      }),
    );
    reserveDocumentUpload.mockResolvedValue(1);
  });

  it('takes the async branch — no in-request OCR, no byte fetch', async () => {
    const event = {
      httpMethod: 'POST',
      resource: '/v1/documents',
      requestContext: { authorizer },
      body: JSON.stringify({
        documentTypeId: 'dt-1',
        name: 'Test Doc',
        source: { kind: 'file', key: UPLOAD_KEY },
        content: CLIENT_CONTENT,
      }),
    };

    const res = (await handler(event)) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).ingestStatus).toBe('queued');
    // The exploit payload no longer runs OCR in the request path.
    expect(ingestUpload).not.toHaveBeenCalled();
    expect(commandTypes()).not.toContain('GetObject');
    // The upload was enqueued for the bounded async worker instead.
    expect(insertQueuedIngestJob).toHaveBeenCalledTimes(1);
    expect(enqueueIngestJob).toHaveBeenCalledTimes(1);
  });
});

describe('create-draft: PDF with client content is still ingested async', () => {
  beforeEach(() => {
    query.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('SELECT owner_user_id, document_type_id FROM document')) {
        return [{ owner_user_id: 'user-1', document_type_id: 'dt-1' }];
      }
      if (sql.includes('FROM document_type dt')) {
        return [{ id: 'dt-1', access_state: 'OPEN', size_limit_words: null, archived_at: null }];
      }
      return [];
    });
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        query: async (sql: string): Promise<unknown[]> =>
          sql.includes('FOR UPDATE') ? [{ owner_user_id: 'user-1' }] : [],
        execute: async () => 0,
      }),
    );
    reserveDraftCreate.mockResolvedValue(1);
  });

  it('takes the async branch — no in-request OCR, no byte fetch', async () => {
    const event = {
      httpMethod: 'POST',
      resource: '/v1/documents/{documentId}/drafts',
      pathParameters: { documentId: 'doc-1' },
      requestContext: { authorizer },
      body: JSON.stringify({
        source: { kind: 'file', key: UPLOAD_KEY },
        content: CLIENT_CONTENT,
      }),
    };

    const res = (await handler(event)) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).ingestStatus).toBe('queued');
    expect(ingestUpload).not.toHaveBeenCalled();
    expect(commandTypes()).not.toContain('GetObject');
    expect(insertQueuedIngestJob).toHaveBeenCalledTimes(1);
    expect(enqueueIngestJob).toHaveBeenCalledTimes(1);
  });
});
