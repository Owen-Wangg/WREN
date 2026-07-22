import type { AuthContext } from '@wren/types';

import { AuthorizationError, UsageLimitReachedError } from './errors';
import { FakeDb } from './fakeDb';
import {
  assertAskMessageAllowed,
  assertDocumentUploadAllowed,
  assertDraftCreateAllowed,
  getPlatformUsagePolicy,
  getPlatformUsagePolicyForAdmin,
  reserveDebriefGeneration,
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
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('blocks document upload at the lifetime cap', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ document_upload_limit: 1 });
    db.seedDocument({ id: 'doc-1', owner_user_id: 'student-1', document_type_id: 'dt-1' });
    await expect(assertDocumentUploadAllowed('student-1', db)).rejects.toBeInstanceOf(
      UsageLimitReachedError,
    );
  });

  it('blocks draft create at the lifetime cap', async () => {
    const db = new FakeDb();
    db.seedPlatformUsagePolicy({ drafts_per_document_limit: 1 });
    db.seedDocument({ id: 'doc-1', owner_user_id: 'student-1', document_type_id: 'dt-1' });
    db.seedDraft({ id: 'draft-1', document_id: 'doc-1', version_number: 1 });
    await expect(assertDraftCreateAllowed('doc-1', db)).rejects.toBeInstanceOf(
      UsageLimitReachedError,
    );
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
});
