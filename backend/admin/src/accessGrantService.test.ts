/**
 * Unit tests for Access Grant management (REQ-DOMAIN-ACCESS-01 / Requirement
 * 4.4, 4.6).
 *
 * Covers create/list/revoke with capability enforcement (deny with no
 * mutation), that a grant never transfers User ownership (Users stay global —
 * no ownership FK is written anywhere), and that access-request approval
 * creates EXACTLY one grant via the same code path as direct creation.
 *
 * V4: Access Grants are flat — `{userId, documentTypeId}` — no org-level
 * grants. The owning Department for auth is resolved from the Document Type's
 * department_id. No superuser fallback — TechnicalAdmin CANNOT perform
 * educational operations.
 */
import {
  approveAccessRequest,
  createAccessGrant,
  getAccessGrant,
  listAccessGrants,
  revokeAccessGrant,
} from './accessGrantService';
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPT = 'dept-1';
const OTHER_DEPT = 'dept-2';
const DT = 'dt-1';
const USER = 'user-target';

function seedDocumentType(db: FakeDb, id: string, departmentId: string): void {
  db.seedDepartment({ id: departmentId, name: 'Dept' });
  db.seedDocumentType({ id, department_id: departmentId, name: 'Type' });
}

describe('createAccessGrant (Requirement 4.4) — documentTypeId scope', () => {
  it('lets a DeptAdmin create a grant for a Document Type in an administered dept', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);

    const grant = await createAccessGrant(
      deptAdminContext([DEPT]),
      { userId: USER, documentTypeId: DT },
      db,
    );

    expect(grant).toMatchObject({
      userId: USER,
      documentTypeId: DT,
      grantedBy: deptAdminContext([DEPT]).userId,
    });
    expect(grant.revokedAt).toBeUndefined();
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    await expect(
      createAccessGrant(
        deptAdminContext([DEPT]),
        { userId: USER, documentTypeId: 'missing' },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('DENIES a DeptAdmin creating a grant for a Document Type in a NON-administered dept, no mutation', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, OTHER_DEPT);

    await expect(
      createAccessGrant(
        deptAdminContext([DEPT]),
        { userId: USER, documentTypeId: DT },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.accessGrants.size).toBe(0);
  });

  it('does NOT introduce any ownership association — the grant carries no Department/User FK beyond documentTypeId', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    const grant = await createAccessGrant(
      deptAdminContext([DEPT]),
      { userId: USER, documentTypeId: DT },
      db,
    );
    const row = db.accessGrants.get(grant.id)!;
    expect(Object.keys(row).sort()).toEqual(
      ['document_type_id', 'granted_at', 'granted_by', 'id', 'revoked_at', 'user_id'].sort(),
    );
  });
});

describe('createAccessGrant — denied roles', () => {
  it('denies a TechnicalAdmin (not a grant-management authority), no mutation', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    await expect(
      createAccessGrant(
        techAdminContext(),
        { userId: USER, documentTypeId: DT },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Student, no mutation', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    await expect(
      createAccessGrant(studentContext(), { userId: USER, documentTypeId: DT }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('listAccessGrants', () => {
  it('lists active grants for a Document Type, excluding revoked ones', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    db.seedAccessGrant({ id: 'g-1', user_id: 'u-1', document_type_id: DT });
    db.seedAccessGrant({
      id: 'g-2',
      user_id: 'u-2',
      document_type_id: DT,
      revoked_at: new Date(),
    });
    db.seedAccessGrant({ id: 'g-3', user_id: 'u-3', document_type_id: 'dt-other' });

    const grants = await listAccessGrants(deptAdminContext([DEPT]), DT, db);
    expect(grants.map((g) => g.userId)).toEqual(['u-1']);
  });

  it('denies a DeptAdmin listing grants for a Document Type in a non-administered dept', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, OTHER_DEPT);
    await expect(
      listAccessGrants(deptAdminContext([DEPT]), DT, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    await expect(
      listAccessGrants(deptAdminContext([DEPT]), 'missing', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('revokeAccessGrant (Requirement 4.4)', () => {
  it('lets a DeptAdmin revoke a grant within an administered Document Type', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    db.seedAccessGrant({ id: 'g-1', user_id: USER, document_type_id: DT });

    expect(await revokeAccessGrant(deptAdminContext([DEPT]), 'g-1', db)).toBe(true);
    const grant = await getAccessGrant('g-1', db);
    expect(grant!.revokedAt).toBeDefined();
  });

  it('is idempotent — revoking an already-revoked grant returns false, no mutation', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    db.seedAccessGrant({
      id: 'g-1',
      user_id: USER,
      document_type_id: DT,
      revoked_at: new Date(),
    });

    expect(await revokeAccessGrant(deptAdminContext([DEPT]), 'g-1', db)).toBe(false);
    expect(db.mutationCount).toBe(0);
  });

  it('returns false for an unknown grant id', async () => {
    const db = new FakeDb();
    expect(await revokeAccessGrant(deptAdminContext([DEPT]), 'missing', db)).toBe(false);
  });

  it('DENIES a DeptAdmin revoking a grant for a Document Type in a NON-administered dept, no mutation', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, OTHER_DEPT);
    db.seedAccessGrant({ id: 'g-1', user_id: USER, document_type_id: DT });

    await expect(
      revokeAccessGrant(deptAdminContext([DEPT]), 'g-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    const grant = await getAccessGrant('g-1', db);
    expect(grant!.revokedAt).toBeUndefined();
  });

  it('denies a Student revoking a grant', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    db.seedAccessGrant({ id: 'g-1', user_id: USER, document_type_id: DT });
    await expect(revokeAccessGrant(studentContext(), 'g-1', db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(db.mutationCount).toBe(0);
  });
});

describe('approveAccessRequest (Requirement 4.6) — single grant-creation path', () => {
  it('creates EXACTLY ONE Access Grant on approval', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);

    const grant = await approveAccessRequest(
      deptAdminContext([DEPT]),
      { userId: USER, documentTypeId: DT },
      db,
    );

    expect(db.accessGrants.size).toBe(1);
    expect(grant.documentTypeId).toBe(DT);
    expect(grant.userId).toBe(USER);
  });

  it('approving twice creates two separate grants (each approval == one createAccessGrant call)', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);

    await approveAccessRequest(
      deptAdminContext([DEPT]),
      { userId: USER, documentTypeId: DT },
      db,
    );
    await approveAccessRequest(
      deptAdminContext([DEPT]),
      { userId: USER, documentTypeId: DT },
      db,
    );

    expect(db.accessGrants.size).toBe(2);
  });

  it('enforces the SAME capability as direct grant creation (denies with no mutation)', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    await expect(
      approveAccessRequest(
        deptAdminContext([OTHER_DEPT]),
        { userId: USER, documentTypeId: DT },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.accessGrants.size).toBe(0);
  });

  it('denies a TechnicalAdmin approving an access request', async () => {
    const db = new FakeDb();
    seedDocumentType(db, DT, DEPT);
    await expect(
      approveAccessRequest(
        techAdminContext(),
        { userId: USER, documentTypeId: DT },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});
