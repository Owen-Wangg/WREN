/**
 * Unit tests for temporary, Document-Type-scoped usage overrides
 * (REQ-TOKEN-LIMIT-01 / Requirement 54 criteria 5-8; Task 13.4).
 */
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import {
  getActiveOverrideBounds,
  getOverride,
  grantOverride,
  isOverrideActive,
  listOverridesForUserAndDocumentType,
} from './overrideService';

const DEPT = 'dept-1';
const OTHER_DEPT = 'dept-2';
const DT = 'dt-1';
const STUDENT_ID = 'student-1';

function seed(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard Law' });
  db.seedDepartment({ id: OTHER_DEPT, name: 'Sauder Business' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Memo' });
}

describe('grantOverride (Requirement 54.5)', () => {
  it('lets a DeptAdmin administering the Document Type\'s Department grant an override', async () => {
    const db = new FakeDb();
    seed(db);

    const override = await grantOverride(
      deptAdminContext([DEPT]),
      {
        userId: STUDENT_ID,
        documentTypeId: DT,
        bounds: { additionalActions: 5 },
        reason: 'Extension granted for final exam prep.',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
      db,
    );

    expect(override).toMatchObject({
      userId: STUDENT_ID,
      documentTypeId: DT,
      bounds: { additionalActions: 5 },
      reason: 'Extension granted for final exam prep.',
    });
    expect(override.grantedBy).toBeTruthy();
  });

  it('lets a TechnicalAdmin grant an override for any Document Type', async () => {
    const db = new FakeDb();
    seed(db);

    const override = await grantOverride(
      techAdminContext(),
      {
        userId: STUDENT_ID,
        documentTypeId: DT,
        bounds: { additionalActions: 3 },
        reason: 'Platform-level accommodation.',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
      db,
    );

    expect(override.documentTypeId).toBe(DT);
  });

  it('records the granting actor\'s userId as grantedBy (Requirement 54.6)', async () => {
    const db = new FakeDb();
    seed(db);
    const actor = deptAdminContext([DEPT]);

    const override = await grantOverride(
      actor,
      {
        userId: STUDENT_ID,
        documentTypeId: DT,
        bounds: { additionalActions: 5 },
        reason: 'Accommodation.',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
      db,
    );

    expect(override.grantedBy).toBe(actor.userId);
  });

  it('denies a DeptAdmin who does not administer the Document Type\'s Department', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      grantOverride(
        deptAdminContext([OTHER_DEPT]),
        {
          userId: STUDENT_ID,
          documentTypeId: DT,
          bounds: { additionalActions: 5 },
          reason: 'X',
          expiresAt: '2026-08-01T00:00:00.000Z',
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      grantOverride(
        studentContext(),
        {
          userId: STUDENT_ID,
          documentTypeId: DT,
          bounds: { additionalActions: 5 },
          reason: 'X',
          expiresAt: '2026-08-01T00:00:00.000Z',
        },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      grantOverride(
        deptAdminContext([DEPT]),
        {
          userId: STUDENT_ID,
          documentTypeId: 'missing',
          bounds: { additionalActions: 5 },
          reason: 'X',
          expiresAt: '2026-08-01T00:00:00.000Z',
        },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('isOverrideActive / getActiveOverrideBounds (Requirement 54.7, 54.8)', () => {
  it('an override with a future expiresAt is active', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedOverride({
      id: 'o1',
      user_id: STUDENT_ID,
      document_type_id: DT,
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
    });

    const override = await getOverride('o1', db);
    expect(isOverrideActive(override!, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('an override with a past expiresAt is NOT active (expired at period reset)', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedOverride({
      id: 'o1',
      user_id: STUDENT_ID,
      document_type_id: DT,
      expires_at: new Date('2020-01-01T00:00:00.000Z'),
    });

    const override = await getOverride('o1', db);
    expect(isOverrideActive(override!, new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('getActiveOverrideBounds returns null when no override exists', async () => {
    const db = new FakeDb();
    seed(db);

    const bounds = await getActiveOverrideBounds(STUDENT_ID, DT, new Date(), db);

    expect(bounds).toBeNull();
  });

  it('getActiveOverrideBounds returns null when the only override has expired', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedOverride({
      id: 'o1',
      user_id: STUDENT_ID,
      document_type_id: DT,
      expires_at: new Date('2020-01-01T00:00:00.000Z'),
      bounds: { additionalActions: 10 },
    });

    const bounds = await getActiveOverrideBounds(STUDENT_ID, DT, new Date('2026-01-01T00:00:00.000Z'), db);

    expect(bounds).toBeNull();
  });

  it('getActiveOverrideBounds returns the active override\'s bounds', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedOverride({
      id: 'o1',
      user_id: STUDENT_ID,
      document_type_id: DT,
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      bounds: { additionalActions: 7 },
    });

    const bounds = await getActiveOverrideBounds(STUDENT_ID, DT, new Date('2026-01-01T00:00:00.000Z'), db);

    expect(bounds).toEqual({ additionalActions: 7 });
  });

  it('when multiple active overrides exist, the one with the latest expiry wins', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedOverride({
      id: 'o1',
      user_id: STUDENT_ID,
      document_type_id: DT,
      expires_at: new Date('2026-06-01T00:00:00.000Z'),
      bounds: { additionalActions: 3 },
    });
    db.seedOverride({
      id: 'o2',
      user_id: STUDENT_ID,
      document_type_id: DT,
      expires_at: new Date('2026-09-01T00:00:00.000Z'),
      bounds: { additionalActions: 10 },
    });

    const bounds = await getActiveOverrideBounds(STUDENT_ID, DT, new Date('2026-01-01T00:00:00.000Z'), db);

    expect(bounds).toEqual({ additionalActions: 10 });
  });

  it('does not mix up overrides for different Document Types', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedDocumentType({ id: 'dt-2', department_id: DEPT, name: 'Other Type' });
    db.seedOverride({
      id: 'o1',
      user_id: STUDENT_ID,
      document_type_id: 'dt-2',
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      bounds: { additionalActions: 99 },
    });

    const bounds = await getActiveOverrideBounds(STUDENT_ID, DT, new Date('2026-01-01T00:00:00.000Z'), db);

    expect(bounds).toBeNull();
  });

  it('does not mix up overrides for different Students', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedOverride({
      id: 'o1',
      user_id: 'other-student',
      document_type_id: DT,
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      bounds: { additionalActions: 99 },
    });

    const bounds = await getActiveOverrideBounds(STUDENT_ID, DT, new Date('2026-01-01T00:00:00.000Z'), db);

    expect(bounds).toBeNull();
  });
});

describe('listOverridesForUserAndDocumentType', () => {
  it('lists every override, including expired ones, newest expiry first', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedOverride({
      id: 'o1',
      user_id: STUDENT_ID,
      document_type_id: DT,
      expires_at: new Date('2020-01-01T00:00:00.000Z'),
    });
    db.seedOverride({
      id: 'o2',
      user_id: STUDENT_ID,
      document_type_id: DT,
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
    });

    const overrides = await listOverridesForUserAndDocumentType(STUDENT_ID, DT, db);

    expect(overrides.map((o) => o.id)).toEqual(['o2', 'o1']);
  });
});
