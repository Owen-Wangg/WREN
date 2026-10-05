/**
 * Async PDF create paths (document + draft): the orphan-upload tag is cleared
 * before the create transaction and again after commit — never while a DB
 * transaction is open — and any failure out of that transaction re-tags the
 * upload for lifecycle expiry so a rejected upload is never left untagged and
 * unreferenced. The re-tag re-checks references afterwards and removes its own
 * tag if a concurrent attach committed in between.
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
}));

// Ordered log of S3 commands and transaction boundaries.
const events: string[] = [];
const s3Send = jest.fn(async (command: unknown) => {
  events.push((command as { __command: string }).__command);
  return {};
});
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

/** Transaction mock: runs `fn` against `tx`; a throw models a rollback. */
function useTransaction(txQuery: (sql: string) => unknown[]) {
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    events.push('tx:begin');
    try {
      const out = await fn({ query: async (sql: string) => txQuery(sql), execute: async () => 0 });
      events.push('tx:commit');
      return out;
    } catch (error) {
      events.push('tx:rollback');
      throw error;
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  events.length = 0;
  process.env.DOCUMENTS_BUCKET_NAME = 'test-bucket';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('create-document async PDF path', () => {
  const event = {
    httpMethod: 'POST',
    resource: '/v1/documents',
    requestContext: { authorizer },
    body: JSON.stringify({
      documentTypeId: 'dt-1',
      name: 'Test Doc',
      source: { kind: 'file', key: UPLOAD_KEY },
    }),
  };

  beforeEach(() => {
    query.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('FROM document_type dt')) {
        return [{ id: 'dt-1', access_state: 'OPEN', size_limit_words: null, archived_at: null }];
      }
      if (sql.includes('FROM content_type')) return [{ id: 'ct-1' }];
      return [];
    });
    useTransaction((sql) =>
      sql.includes('INSERT INTO document')
        ? [{ id: 'doc-1', owner_user_id: 'user-1', document_type_id: 'dt-1', name: 'Test Doc', metadata: {}, status: 'Still Drafting', created_at: new Date() }]
        : [],
    );
  });

  it('on reservation failure: returns 429 and re-tags after rollback', async () => {
    reserveDocumentUpload.mockRejectedValue(new TestUsageLimitReachedError());

    const res = (await handler(event)) as { statusCode: number };

    expect(res.statusCode).toBe(429);
    expect(events).toEqual(['DeleteObjectTagging', 'tx:begin', 'tx:rollback', 'PutObjectTagging']);
    expect(enqueueIngestJob).not.toHaveBeenCalled();
  });

  it('on success: clears before and after the transaction, never inside it', async () => {
    reserveDocumentUpload.mockResolvedValue(1);

    const res = (await handler(event)) as { statusCode: number };

    expect(res.statusCode).toBe(201);
    expect(events).toEqual(['DeleteObjectTagging', 'tx:begin', 'tx:commit', 'DeleteObjectTagging']);
    expect(insertQueuedIngestJob).toHaveBeenCalledTimes(1);
  });

  it('removes its own tag when a concurrent attach commits between check and tag', async () => {
    reserveDocumentUpload.mockRejectedValue(new TestUsageLimitReachedError());
    let referenceChecks = 0;
    query.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('FROM document_type dt')) {
        return [{ id: 'dt-1', access_state: 'OPEN', size_limit_words: null, archived_at: null }];
      }
      if (sql.includes('FROM content_type')) return [{ id: 'ct-1' }];
      if (sql.includes('document_ingest_job WHERE s3_key')) {
        // Unreferenced at the first check, referenced at the post-tag re-check.
        referenceChecks += 1;
        return referenceChecks === 1 ? [] : [{ s3_key: UPLOAD_KEY }];
      }
      return [];
    });

    const res = (await handler(event)) as { statusCode: number };

    expect(res.statusCode).toBe(429);
    expect(events).toEqual([
      'DeleteObjectTagging',
      'tx:begin',
      'tx:rollback',
      'PutObjectTagging',
      'DeleteObjectTagging',
    ]);
  });

  it('does not re-tag a key that another row still references', async () => {
    reserveDocumentUpload.mockRejectedValue(new TestUsageLimitReachedError());
    query.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('FROM document_type dt')) {
        return [{ id: 'dt-1', access_state: 'OPEN', size_limit_words: null, archived_at: null }];
      }
      if (sql.includes('FROM content_type')) return [{ id: 'ct-1' }];
      if (sql.includes('document_ingest_job WHERE s3_key')) return [{ s3_key: UPLOAD_KEY }];
      return [];
    });

    const res = (await handler(event)) as { statusCode: number };

    expect(res.statusCode).toBe(429);
    expect(events).not.toContain('PutObjectTagging');
  });
});

describe('create-draft async PDF path', () => {
  const event = {
    httpMethod: 'POST',
    resource: '/v1/documents/{documentId}/drafts',
    pathParameters: { documentId: 'doc-1' },
    requestContext: { authorizer },
    body: JSON.stringify({ source: { kind: 'file', key: UPLOAD_KEY } }),
  };

  beforeEach(() => {
    query.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('SELECT owner_user_id, document_type_id FROM document')) {
        return [{ owner_user_id: 'user-1', document_type_id: 'dt-1' }];
      }
      if (sql.includes('size_limit_words FROM document_type')) return [{ size_limit_words: null }];
      return [];
    });
  });

  it('on reservation failure: returns 429 and re-tags after rollback', async () => {
    useTransaction((sql) => (sql.includes('FOR UPDATE') ? [{ owner_user_id: 'user-1' }] : []));
    reserveDraftCreate.mockRejectedValue(new TestUsageLimitReachedError());

    const res = (await handler(event)) as { statusCode: number };

    expect(res.statusCode).toBe(429);
    expect(events).toEqual(['DeleteObjectTagging', 'tx:begin', 'tx:rollback', 'PutObjectTagging']);
  });

  it('on ownership 404 inside the transaction: re-tags', async () => {
    useTransaction(() => []);
    reserveDraftCreate.mockResolvedValue(1);

    const res = (await handler(event)) as { statusCode: number };

    expect(res.statusCode).toBe(404);
    expect(events).toEqual(['DeleteObjectTagging', 'tx:begin', 'tx:rollback', 'PutObjectTagging']);
    expect(reserveDraftCreate).not.toHaveBeenCalled();
  });

  it('on success: clears before and after the transaction, never inside it', async () => {
    useTransaction((sql) => (sql.includes('FOR UPDATE') ? [{ owner_user_id: 'user-1' }] : []));
    reserveDraftCreate.mockResolvedValue(1);

    const res = (await handler(event)) as { statusCode: number };

    expect(res.statusCode).toBe(202);
    expect(events).toEqual(['DeleteObjectTagging', 'tx:begin', 'tx:commit', 'DeleteObjectTagging']);
  });
});
