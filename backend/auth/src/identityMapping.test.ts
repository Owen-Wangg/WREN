/**
 * Unit tests for app-database identity mapping (Requirements 37.2, 37.3, 37.5).
 *
 * These assert the authorization context is assembled ENTIRELY from database
 * rows keyed by the verified subject, using parameterized queries — never from
 * any identity-provider claim (the function cannot even receive a claim).
 */
import {
  mapSubjectToAuthContext,
  type AccessGrantRow,
  type AppUserRow,
  type QueryExecutor,
  type RoleAssignmentRow,
} from './identityMapping';

interface Fixture {
  readonly users: AppUserRow[];
  readonly roles: RoleAssignmentRow[];
  readonly grants: AccessGrantRow[];
}

interface RecordedCall {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Build a fake executor over an in-memory fixture and record every call. */
function makeDb(fixture: Fixture): { db: QueryExecutor; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const db: QueryExecutor = {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      calls.push({ text, params });
      if (text.includes('FROM app_user')) {
        return fixture.users.filter((u) => u.idp_subject === params[0]) as unknown as Row[];
      }
      if (text.includes('FROM role_assignment')) {
        // role rows are seeded already scoped to the single fixture user.
        return fixture.roles as unknown as Row[];
      }
      if (text.includes('FROM access_grant')) {
        // SQL filters revoked grants; the fixture only seeds active ones.
        return fixture.grants as unknown as Row[];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { db, calls };
}

const USER: AppUserRow = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'writer@example.com',
  idp_subject: 'cognito-sub-abc',
};

describe('mapSubjectToAuthContext — DB is the authorization source of truth', () => {
  it('resolves identity, roles, scopes, and grants for a known subject', async () => {
    const { db } = makeDb({
      users: [USER],
      roles: [
        { role: 'User', scope: null },
        { role: 'Field Expert', scope: { writingTypeIds: ['wt-1', 'wt-2'] } },
        { role: 'Org Owner', scope: { organizationId: 'org-9' } },
      ],
      grants: [
        {
          id: 'grant-1',
          user_id: USER.id,
          scope: { writingTypeId: 'wt-locked' },
          granted_by: 'admin-1',
          granted_at: new Date('2024-01-02T03:04:05.000Z'),
          revoked_at: null,
        },
      ],
    });

    const context = await mapSubjectToAuthContext(USER.idp_subject, db);

    expect(context).not.toBeNull();
    expect(context?.userId).toBe(USER.id);
    expect(context?.idpSubject).toBe(USER.idp_subject);
    expect(context?.email).toBe(USER.email);
    expect(context?.roles.sort()).toEqual(['Field Expert', 'Org Owner', 'User']);
    expect(context?.assignedWritingTypeIds.sort()).toEqual(['wt-1', 'wt-2']);
    expect(context?.ownedOrganizationIds).toEqual(['org-9']);
    expect(context?.grants).toEqual([
      {
        id: 'grant-1',
        userId: USER.id,
        scope: { writingTypeId: 'wt-locked' },
        grantedBy: 'admin-1',
        grantedAt: '2024-01-02T03:04:05.000Z',
      },
    ]);
  });

  it('returns null when the subject maps to no application identity (Req 37.5)', async () => {
    const { db } = makeDb({ users: [USER], roles: [], grants: [] });
    const context = await mapSubjectToAuthContext('unknown-subject', db);
    expect(context).toBeNull();
  });

  it('derives roles strictly from role_assignment rows, not from any claim', async () => {
    // Only a plain "User" role exists in the DB. There is no channel by which a
    // token claim could inject a higher role — the function takes only a subject.
    const { db } = makeDb({
      users: [USER],
      roles: [{ role: 'User', scope: null }],
      grants: [],
    });
    const context = await mapSubjectToAuthContext(USER.idp_subject, db);
    expect(context?.roles).toEqual(['User']);
    expect(context?.ownedOrganizationIds).toEqual([]);
    expect(context?.assignedWritingTypeIds).toEqual([]);
  });

  it('uses parameterized queries binding the subject and user id as $1', async () => {
    const { db, calls } = makeDb({
      users: [USER],
      roles: [{ role: 'User', scope: null }],
      grants: [],
    });
    await mapSubjectToAuthContext(USER.idp_subject, db);

    const userQuery = calls.find((c) => c.text.includes('FROM app_user'));
    expect(userQuery?.text).toContain('$1');
    expect(userQuery?.text).not.toContain(USER.idp_subject); // value never interpolated
    expect(userQuery?.params).toEqual([USER.idp_subject]);

    const roleQuery = calls.find((c) => c.text.includes('FROM role_assignment'));
    expect(roleQuery?.params).toEqual([USER.id]);

    const grantQuery = calls.find((c) => c.text.includes('FROM access_grant'));
    expect(grantQuery?.text).toContain('revoked_at IS NULL');
    expect(grantQuery?.params).toEqual([USER.id]);
  });

  it('ignores malformed grant/role scopes rather than emitting a bad context', async () => {
    const { db } = makeDb({
      users: [USER],
      roles: [
        { role: 'Org Owner', scope: {} }, // missing organizationId
        { role: 'Field Expert', scope: { writingTypeIds: [42, 'wt-ok'] } }, // mixed types
      ],
      grants: [
        {
          id: 'bad-grant',
          user_id: USER.id,
          scope: {}, // neither writingTypeId nor organizationId
          granted_by: 'admin-1',
          granted_at: '2024-01-02T03:04:05.000Z',
          revoked_at: null,
        },
      ],
    });

    const context = await mapSubjectToAuthContext(USER.idp_subject, db);
    expect(context?.ownedOrganizationIds).toEqual([]);
    expect(context?.assignedWritingTypeIds).toEqual(['wt-ok']);
    expect(context?.grants).toEqual([]);
  });
});
