/**
 * Unit tests for Access Grant management (REQ-DOMAIN-ACCESS-01 / Requirement
 * 4.4, 4.6; REQ-ORG-02 / Requirement 29.2).
 *
 * Covers create/list/revoke with capability enforcement (deny with no
 * mutation), that a grant never transfers User ownership (Users stay global —
 * no ownership FK is written anywhere), and that access-request approval
 * creates EXACTLY one grant via the same code path as direct creation.
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
import { adminContext, fieldExpertContext, orgOwnerContext, userContext } from './testContexts';

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const WT = 'wt-1';
const USER = 'user-target';

function seedWritingType(db: FakeDb, id: string, organizationId: string): void {
  db.seedOrganization({ id: organizationId, name: 'Org' });
  db.seedWritingType({ id, organization_id: organizationId, name: 'Type' });
}

describe('createAccessGrant (Requirement 4.4) — organization scope', () => {
  it('lets an Org Owner create a grant scoped to their OWNED organization', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });

    const grant = await createAccessGrant(
      orgOwnerContext(ORG),
      { userId: USER, scope: { organizationId: ORG } },
      db,
    );

    expect(grant).toMatchObject({
      userId: USER,
      scope: { organizationId: ORG },
      grantedBy: orgOwnerContext(ORG).userId,
    });
    expect(grant.revokedAt).toBeUndefined();
  });

  it('lets an Admin create a grant scoped to any organization', async () => {
    const db = new FakeDb();
    const grant = await createAccessGrant(
      adminContext(),
      { userId: USER, scope: { organizationId: OTHER_ORG } },
      db,
    );
    expect(grant.scope).toEqual({ organizationId: OTHER_ORG });
  });

  it('DENIES an Org Owner creating a grant for a NON-owned organization, no mutation', async () => {
    const db = new FakeDb();
    await expect(
      createAccessGrant(
        orgOwnerContext(ORG),
        { userId: USER, scope: { organizationId: OTHER_ORG } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.accessGrants.size).toBe(0);
  });

  it('does NOT introduce any ownership association — the grant carries no Organization/User FK beyond scope', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });
    const grant = await createAccessGrant(
      orgOwnerContext(ORG),
      { userId: USER, scope: { organizationId: ORG } },
      db,
    );
    // The stored row is exactly {id, user_id, scope, granted_by, granted_at,
    // revoked_at} — no separate "owner"/"member" column exists anywhere.
    const row = db.accessGrants.get(grant.id)!;
    expect(Object.keys(row).sort()).toEqual(
      ['granted_at', 'granted_by', 'id', 'revoked_at', 'scope', 'user_id'].sort(),
    );
  });
});

describe('createAccessGrant — writingType scope', () => {
  it('lets an Org Owner create a grant scoped to a Writing Type they own via Organization', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);

    const grant = await createAccessGrant(
      orgOwnerContext(ORG),
      { userId: USER, scope: { writingTypeId: WT } },
      db,
    );
    expect(grant.scope).toEqual({ writingTypeId: WT });
  });

  it('DENIES creating a grant for a Writing Type owned by a DIFFERENT organization', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, OTHER_ORG);
    await expect(
      createAccessGrant(orgOwnerContext(ORG), { userId: USER, scope: { writingTypeId: WT } }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('throws NotFoundError for an unknown Writing Type', async () => {
    const db = new FakeDb();
    await expect(
      createAccessGrant(
        adminContext(),
        { userId: USER, scope: { writingTypeId: 'missing' } },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('createAccessGrant — denied roles', () => {
  it('denies a Field Expert (not a grant-management authority), no mutation', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });
    await expect(
      createAccessGrant(
        fieldExpertContext(WT),
        { userId: USER, scope: { organizationId: ORG } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a plain User, no mutation', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });
    await expect(
      createAccessGrant(userContext(), { userId: USER, scope: { organizationId: ORG } }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('listAccessGrants', () => {
  it('lists active grants for an organization scope, excluding revoked ones', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });
    db.seedAccessGrant({ id: 'g-1', user_id: 'u-1', scope: { organizationId: ORG } });
    db.seedAccessGrant({
      id: 'g-2',
      user_id: 'u-2',
      scope: { organizationId: ORG },
      revoked_at: new Date(),
    });
    db.seedAccessGrant({ id: 'g-3', user_id: 'u-3', scope: { organizationId: OTHER_ORG } });

    const grants = await listAccessGrants(
      orgOwnerContext(ORG),
      { organizationId: ORG },
      db,
    );
    expect(grants.map((g) => g.userId)).toEqual(['u-1']);
  });

  it('denies an Org Owner listing grants for a non-owned organization', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });
    await expect(
      listAccessGrants(orgOwnerContext(OTHER_ORG), { organizationId: ORG }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('revokeAccessGrant (Requirement 4.4)', () => {
  it('lets an Org Owner revoke a grant within an owned organization', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });
    db.seedAccessGrant({ id: 'g-1', user_id: USER, scope: { organizationId: ORG } });

    expect(await revokeAccessGrant(orgOwnerContext(ORG), 'g-1', db)).toBe(true);
    const grant = await getAccessGrant('g-1', db);
    expect(grant!.revokedAt).toBeDefined();
  });

  it('is idempotent — revoking an already-revoked grant returns false, no mutation', async () => {
    const db = new FakeDb();
    db.seedAccessGrant({
      id: 'g-1',
      user_id: USER,
      scope: { organizationId: ORG },
      revoked_at: new Date(),
    });

    expect(await revokeAccessGrant(adminContext(), 'g-1', db)).toBe(false);
    expect(db.mutationCount).toBe(0);
  });

  it('returns false for an unknown grant id', async () => {
    const db = new FakeDb();
    expect(await revokeAccessGrant(adminContext(), 'missing', db)).toBe(false);
  });

  it('DENIES an Org Owner revoking a grant for a NON-owned organization, no mutation', async () => {
    const db = new FakeDb();
    db.seedAccessGrant({ id: 'g-1', user_id: USER, scope: { organizationId: OTHER_ORG } });

    await expect(
      revokeAccessGrant(orgOwnerContext(ORG), 'g-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    const grant = await getAccessGrant('g-1', db);
    expect(grant!.revokedAt).toBeUndefined();
  });

  it('denies a plain User revoking a grant', async () => {
    const db = new FakeDb();
    db.seedAccessGrant({ id: 'g-1', user_id: USER, scope: { organizationId: ORG } });
    await expect(revokeAccessGrant(userContext(), 'g-1', db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(db.mutationCount).toBe(0);
  });
});

describe('approveAccessRequest (Requirement 4.6) — single grant-creation path', () => {
  it('creates EXACTLY ONE Access Grant on approval', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });

    const grant = await approveAccessRequest(
      orgOwnerContext(ORG),
      { userId: USER, scope: { organizationId: ORG } },
      db,
    );

    expect(db.accessGrants.size).toBe(1);
    expect(grant.scope).toEqual({ organizationId: ORG });
    expect(grant.userId).toBe(USER);
  });

  it('approving twice creates two separate grants (each approval == one createAccessGrant call)', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });

    await approveAccessRequest(
      orgOwnerContext(ORG),
      { userId: USER, scope: { organizationId: ORG } },
      db,
    );
    await approveAccessRequest(
      orgOwnerContext(ORG),
      { userId: USER, scope: { organizationId: ORG } },
      db,
    );

    expect(db.accessGrants.size).toBe(2);
  });

  it('enforces the SAME capability as direct grant creation (denies with no mutation)', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG, name: 'Org' });
    await expect(
      approveAccessRequest(
        orgOwnerContext(OTHER_ORG),
        { userId: USER, scope: { organizationId: ORG } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.accessGrants.size).toBe(0);
  });

  it('lets an Admin approve a request for a Writing-Type-scoped LOCKED domain', async () => {
    const db = new FakeDb();
    seedWritingType(db, WT, ORG);

    const grant = await approveAccessRequest(
      adminContext(),
      { userId: USER, scope: { writingTypeId: WT } },
      db,
    );
    expect(grant.scope).toEqual({ writingTypeId: WT });
    expect(db.accessGrants.size).toBe(1);
  });
});
