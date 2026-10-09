import type { AuthContext } from '@wren/types';

import { AuthorizationError, UsageLimitReachedError } from './errors';
import { FakeDb } from './fakeDb';
import {
  assertAskMessageAllowed,
  assertDocumentUploadAllowed,
  assertDraftCreateAllowed,
  getPlatformUsagePolicy,
  getPlatformUsagePolicyForAdmin,
  reserveAskMessage,
  reserveDebriefGeneration,
  reserveDocumentUpload,
  reserveDraftCreate,
  updatePlatformUsagePolicy,
} from './lifetimeUsagePolicy';

function techAdmin(): AuthContext {
  return {
    userId: 'tech-1',
    idpSubject: 'idp-tech',
    email: 'tech@example.com',
    roles: ['TechnicalAdmin'],
    administeredDepartmentIds: [],
    grants: [],
  };
}

function student(): AuthContext {
  return {
    userId: 'student-1',
    idpSubject: 'idp-student',
    email: 'student@example.com',
    roles: ['Student'],
    administeredDepartmentIds: [],
    grants: [],
  };
}

describe('platform lifetime usage policy', () => {
  it('returns defaults when no row is present', async () => {
    const db = new FakeDb();
    const policy = await getPlatformUsagePolicy(db);
    expect(policy).toEqual({
      messageLimit: 100,
      debriefGenerationLimit: 15,
      documentUploadLimit: 30,
      draftsPerDocumentLimit: 15,
      maxUploadFileSizeBytes: 30 * 1024 * 1024,
      maxWordCount: 10_000,
    });
  });

  it('lets TechnicalAdmin update the policy', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy();
    const updated = await updatePlatformUsagePolicy(
      techAdmin(),
      {
        messageLimit: 50,
        debriefGenerationLimit: 5,
        documentUploadLimit: 10,
        draftsPerDocumentLimit: 8,
        maxUploadFileSizeBytes: 30 * 1024 * 1024,
        maxWordCount: 10_000,
      },
      db,
    );
    expect(updated.messageLimit).toBe(50);
    expect(updated.debriefGenerationLimit).toBe(5);
    const reread = await getPlatformUsagePolicyForAdmin(techAdmin(), db);
    expect(reread).toEqual(updated);
  });

  it('denies Student update with no mutation', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy();
    await expect(
      updatePlatformUsagePolicy(
        student(),
        {
          messageLimit: 1,
          debriefGenerationLimit: 1,
          documentUploadLimit: 1,
          draftsPerDocumentLimit: 1,
          maxUploadFileSizeBytes: 1024 * 1024,
          maxWordCount: 100,
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('blocks document upload at the lifetime cap', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ document_upload_limit: 1 });
    db.userLifetimeUsage.set('student-1', { document_upload_count: 1 });
    await expect(assertDocumentUploadAllowed('student-1', db)).rejects.toBeInstanceOf(
      UsageLimitReachedError,
    );
  });

  it('reserves document uploads until the lifetime cap and is not reset by live-row count', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ document_upload_limit: 2 });
    expect(await reserveDocumentUpload('student-1', db)).toBe(1);
    expect(await reserveDocumentUpload('student-1', db)).toBe(2);
    await expect(reserveDocumentUpload('student-1', db)).rejects.toBeInstanceOf(
      UsageLimitReachedError,
    );
  });

  it('blocks draft create at the lifetime cap', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ drafts_per_document_limit: 1 });
    db.seedDocument({
      id: 'doc-1',
      owner_user_id: 'student-1',
      document_type_id: 'dt-1',
      draft_create_count: 1,
    });
    await expect(assertDraftCreateAllowed('doc-1', db)).rejects.toBeInstanceOf(
      UsageLimitReachedError,
    );
  });

  it('reserves draft creates until the lifetime cap', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ drafts_per_document_limit: 2 });
    db.seedDocument({ id: 'doc-1', owner_user_id: 'student-1', document_type_id: 'dt-1' });
    expect(await reserveDraftCreate('doc-1', db)).toBe(1);
    expect(await reserveDraftCreate('doc-1', db)).toBe(2);
    await expect(reserveDraftCreate('doc-1', db)).rejects.toBeInstanceOf(UsageLimitReachedError);
  });

  it('blocks Ask messages at the lifetime cap', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ message_limit: 2 });
    await expect(assertAskMessageAllowed(2, db)).rejects.toBeInstanceOf(UsageLimitReachedError);
    await expect(assertAskMessageAllowed(1, db)).resolves.toBeUndefined();
  });

  it('reserves debrief generations until the lifetime cap', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ debrief_generation_limit: 2 });
    db.seedDocument({
      id: 'doc-1',
      owner_user_id: 'student-1',
      document_type_id: 'dt-1',
      debrief_generation_count: 0,
    });
    expect(await reserveDebriefGeneration('doc-1', db)).toBe(1);
    expect(await reserveDebriefGeneration('doc-1', db)).toBe(2);
    await expect(reserveDebriefGeneration('doc-1', db)).rejects.toBeInstanceOf(
      UsageLimitReachedError,
    );
  });

  it('reserves Ask WREN messages atomically until the lifetime cap', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ message_limit: 2 });
    db.seedDocument({
      id: 'doc-1',
      owner_user_id: 'student-1',
      document_type_id: 'dt-1',
      ask_message_count: 0,
    });
    expect(await reserveAskMessage('doc-1', db)).toBe(1);
    expect(await reserveAskMessage('doc-1', db)).toBe(2);
    await expect(reserveAskMessage('doc-1', db)).rejects.toBeInstanceOf(
      UsageLimitReachedError,
    );
  });

  it('does not mutate the Ask WREN counter once the lifetime cap is reached', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ message_limit: 1 });
    db.seedDocument({
      id: 'doc-1',
      owner_user_id: 'student-1',
      document_type_id: 'dt-1',
      ask_message_count: 1,
    });
    const before = db.mutationCount;
    await expect(reserveAskMessage('doc-1', db)).rejects.toBeInstanceOf(
      UsageLimitReachedError,
    );
    // The capped UPDATE matched no row, so the counter is unchanged.
    expect(await getPlatformUsagePolicy(db)).toMatchObject({ messageLimit: 1 });
    // A capped reservation still issues one (no-op) UPDATE; the count stays at 1.
    expect(db.mutationCount).toBe(before + 1);
  });
});
