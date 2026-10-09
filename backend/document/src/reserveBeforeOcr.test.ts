/**
 * Guards the security fix: on the synchronous create-document and create-draft
 * file paths, the lifetime slot is reserved BEFORE any paid extraction. When the
 * reservation throws (user over quota), `ingestUpload` (pdf.js/Textract) MUST NOT
 * run, the request returns 429, and the upload is re-tagged for lifecycle expiry
 * so the key cannot be replayed to force repeated OCR.
 */
import { jest } from '@jest/globals';

// --- Reservation helpers: real UsageLimitReachedError class so `instanceof`
// works in both the handler and this test; reserve fns are controllable spies.
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

// --- ingestUpload is the expensive pdf.js/Textract seam we must not reach.
const ingestUpload = jest.fn();
jest.mock('./ingestion.js', () => ({ ingestUpload }));

// --- Auth seam: authenticated Student with OPEN access.
jest.mock('@wren/auth', () => ({
  resolveAccess: jest.fn(async () => 'OPEN'),
  bindCorsOrigin: jest.fn(),
  withCorsHeaders: (res: unknown) => res,
  // Signed-context guard: allow through in this unit test.
  rejectIfForgedAuthContext: jest.fn(async () => null),
  // Real submission gate so it runs against the DB seam below.
  ...jest.requireActual<object>('../../auth/src/submissionAccess'),
}));

// --- S3 seam: capture commands so we can assert no GetObject and a re-tag PUT.
const s3Send = jest.fn(async () => ({}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: s3Send })),
  GetObjectCommand: jest.fn((input: unknown) => ({ __command: 'GetObject', input })),
  DeleteObjectsCommand: jest.fn((input: unknown) => ({ __command: 'DeleteObjects', input })),
  DeleteObjectTaggingCommand: jest.fn((input: unknown) => ({ __command: 'DeleteObjectTagging', input })),
  PutObjectTaggingCommand: jest.fn((input: unknown) => ({ __command: 'PutObjectTagging', input })),
}));

// --- DB seam.
const query = jest.fn<(sql: string, params?: unknown[]) => Promise<unknown[]>>();
const transaction = jest.fn<(fn: (tx: unknown) => unknown) => Promise<unknown>>();
jest.mock('@wren/db-node', () => ({
  getDataAccess: jest.fn(async () => ({ query, transaction })),
  freezeEventLoopOnReturn: jest.fn(),
}));

// Import AFTER mocks are registered.
import { handler } from './lambda-handler.js';

const authorizer = {
  userId: 'user-1',
  idpSubject: 'idp-1',
  email: 'student@example.com',
  roles: JSON.stringify(['Student']),
  administeredDepartmentIds: '[]',
  grants: '[]',
};

const UPLOAD_KEY = 'documents/user-1/uploads/file.docx';

function commandTypes(): string[] {
  return s3Send.mock.calls.map((c) => ((c as unknown[])[0] as { __command: string }).__command);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DOCUMENTS_BUCKET_NAME = 'test-bucket';
  reserveDocumentUpload.mockRejectedValue(new TestUsageLimitReachedError());
  reserveDraftCreate.mockRejectedValue(new TestUsageLimitReachedError());
});

describe('create-document sync file path: reserve before OCR', () => {
  beforeEach(() => {
    query.mockImplementation(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('FROM document_type dt')) {
        return [{ id: 'dt-1', access_state: 'OPEN', size_limit_words: null, archived_at: null }];
      }
      if (sql.includes('FROM access_grant')) return [];
      if (sql.includes('FROM custom_metadata_field')) return [];
      if (sql.includes('FROM content_type')) return [{ id: 'ct-1' }];
      return [];
    });
  });

  it('does not call ingestUpload when reserveDocumentUpload throws; returns 429 and re-tags', async () => {
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

    const res = (await handler(event)) as { statusCode: number };

    expect(reserveDocumentUpload).toHaveBeenCalledTimes(1);
    expect(ingestUpload).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    // No byte fetch happened, and the upload was re-tagged for lifecycle expiry.
    expect(commandTypes()).not.toContain('GetObject');
    expect(commandTypes()).toContain('PutObjectTagging');
  });
});

describe('create-draft sync file path: reserve before OCR', () => {
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
    // The reserve runs inside a committed transaction: lock row, then reserve.
    transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        query: async (sql: string): Promise<unknown[]> =>
          sql.includes('FOR UPDATE') ? [{ owner_user_id: 'user-1' }] : [],
      }),
    );
  });

  it('does not call ingestUpload when reserveDraftCreate throws; returns 429 and re-tags', async () => {
    const event = {
      httpMethod: 'POST',
      resource: '/v1/documents/{documentId}/drafts',
      pathParameters: { documentId: 'doc-1' },
      requestContext: { authorizer },
      body: JSON.stringify({ source: { kind: 'file', key: UPLOAD_KEY } }),
    };

    const res = (await handler(event)) as { statusCode: number };

    expect(reserveDraftCreate).toHaveBeenCalledTimes(1);
    expect(ingestUpload).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(commandTypes()).not.toContain('GetObject');
    expect(commandTypes()).toContain('PutObjectTagging');
  });
});
