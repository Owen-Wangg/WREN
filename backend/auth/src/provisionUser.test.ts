import type { RecordActivityEventInput } from '@wren/db-node';

import type { QueryExecutor } from './identityMapping';
import {
  BOOTSTRAP_AUDIT_ACTOR,
  ensureAppUser,
  grantTechnicalAdminBootstrapOnce,
  IdentityProvisioningRefusedError,
  PROVISIONING_AUDIT_ACTOR,
  type ProvisioningDb,
  type ProvisionUserDeps,
  type ProvisionUserInput,
} from './provisionUser';

const SUBJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OLD_SUBJECT = '99999999-8888-4777-8666-555555555555';
const NEW_USER_ID = '11111111-1111-4111-8111-111111111111';
const EXISTING_USER_ID = '22222222-2222-4222-8222-222222222222';
const RELINKED_USER_ID = '33333333-3333-4333-8333-333333333333';

type ProvisionedRole = 'Student' | 'TechnicalAdmin';

interface Privileges {
  readonly has_elevated_role: boolean;
  readonly has_access_grant: boolean;
  readonly has_visibility_grant: boolean;
  readonly roles: readonly string[];
}

const STUDENT_ONLY: Privileges = {
  has_elevated_role: false,
  has_access_grant: false,
  has_visibility_grant: false,
  roles: ['Student'],
};

interface DbSetup {
  readonly existingSubjectId?: string;
  /** Rows returned by the lower(email) lookup. */
  readonly emailMatches?: readonly { id: string; idp_subject: string }[];
  readonly privileges?: Privileges;
  /** Simulate the guarded UPDATE matching zero rows (row changed concurrently). */
  readonly relinkConflict?: boolean;
  /** With relinkConflict: a concurrent request for the SAME subject won the relink. */
  readonly concurrentSameSubjectWinner?: string;
  /** Expose a `transaction` method like the production DataAccess (default true). */
  readonly transactional?: boolean;
}

function makeDb(setup: DbSetup & { bootstrapMarkerPresent?: boolean } = {}): {
  readonly db: ProvisioningDb;
  readonly roles: ProvisionedRole[];
  readonly calls: string[];
  readonly relinkParams: unknown[][];
  readonly transactions: { count: number };
  readonly bootstrapMarker: () => boolean;
} {
  let inserted = false;
  let bootstrapMarker = setup.bootstrapMarkerPresent ?? false;
  const roles: ProvisionedRole[] = [];
  const calls: string[] = [];
  const relinkParams: unknown[][] = [];
  const transactions = { count: 0 };

  const query: QueryExecutor['query'] = async <Row>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> => {
    calls.push(text);
    if (text.includes('technical_admin_bootstrap')) {
      if (text.includes('INSERT')) {
        bootstrapMarker = true;
        return [] as Row[];
      }
      return (bootstrapMarker ? [{ one: 1 }] : []) as Row[];
    }
    if (text.includes('SELECT id FROM app_user WHERE idp_subject')) {
      const id =
        setup.existingSubjectId ??
        (relinkParams.length > 0 ? setup.concurrentSameSubjectWinner : undefined) ??
        (inserted ? NEW_USER_ID : undefined);
      return (id ? [{ id }] : []) as Row[];
    }
    if (text.includes('FROM app_user WHERE lower(email)')) {
      return [...(setup.emailMatches ?? [])] as Row[];
    }
    if (text.includes('INSERT INTO app_user')) {
      inserted = true;
      return [];
    }
    if (text.includes('has_elevated_role')) {
      return [setup.privileges ?? STUDENT_ONLY] as Row[];
    }
    if (text.includes('UPDATE app_user')) {
      relinkParams.push([...params]);
      return (setup.relinkConflict ? [] : [{ id: params[0] }]) as Row[];
    }
    if (text.includes('INSERT INTO role_assignment')) {
      roles.push(text.includes("'TechnicalAdmin'") ? 'TechnicalAdmin' : 'Student');
      return [];
    }
    throw new Error(`unexpected query: ${text}`);
  };

  const db: ProvisioningDb = setup.transactional !== false
    ? {
        query,
        async transaction<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T> {
          transactions.count += 1;
          return fn({ query });
        },
      }
    : { query };

  return { db, roles, calls, relinkParams, transactions, bootstrapMarker: () => bootstrapMarker };
}

function makeDeps(overrides: Partial<ProvisionUserDeps> = {}): {
  readonly deps: ProvisionUserDeps;
  readonly audits: RecordActivityEventInput[];
  readonly logs: Record<string, unknown>[];
  readonly livenessChecks: string[];
} {
  const audits: RecordActivityEventInput[] = [];
  const logs: Record<string, unknown>[] = [];
  const livenessChecks: string[] = [];
  const deps: ProvisionUserDeps = {
    // Default: the previously linked subject no longer exists in the pool.
    isSubjectLive: async (sub) => {
      livenessChecks.push(sub);
      return false;
    },
    recordActivityEvent: async (event) => {
      audits.push(event);
    },
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, audits, logs, livenessChecks };
}

function input(overrides: Partial<ProvisionUserInput> = {}): ProvisionUserInput {
  return {
    idpSubject: SUBJECT,
    email: 'First.Admin@example.com',
    emailVerified: true,
    firstName: 'First',
    lastName: 'Admin',
    ...overrides,
  };
}

const staleMatch = { id: RELINKED_USER_ID, idp_subject: OLD_SUBJECT };

async function expectRefusal(
  promise: Promise<unknown>,
  reason: IdentityProvisioningRefusedError['reason'],
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(IdentityProvisioningRefusedError);
  await promise.catch((error: IdentityProvisioningRefusedError) => {
    expect(error.reason).toBe(reason);
  });
}

describe('ensureAppUser — TechnicalAdmin bootstrap', () => {
  it.each([
    ['missing', undefined],
    ['non-matching', 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
  ])('does not bootstrap when the exact subject is %s', async (_case, bootstrapSubject) => {
    const { db, roles } = makeDb();

    await ensureAppUser(db, input({
      groups: ['SystemAdmin'],
      technicalAdminBootstrapSubject: bootstrapSubject,
    }), makeDeps().deps);

    expect(roles).toEqual(['Student']);
  });

  it('does not bootstrap when the SystemAdmin group is missing', async () => {
    const { db, roles } = makeDb();

    await ensureAppUser(db, input({ technicalAdminBootstrapSubject: SUBJECT }), makeDeps().deps);

    expect(roles).toEqual(['Student']);
  });

  it('bootstraps an exact-subject SystemAdmin who is genuinely new', async () => {
    const { db, roles } = makeDb();

    const userId = await ensureAppUser(db, input({
      groups: ['Student', 'SystemAdmin'],
      technicalAdminBootstrapSubject: SUBJECT,
    }), makeDeps().deps);

    expect(userId).toBe(NEW_USER_ID);
    expect(roles).toEqual(['Student', 'TechnicalAdmin']);
  });

  it('elevates an exact-subject SystemAdmin who already exists (early-login recovery)', async () => {
    const { db, roles, calls } = makeDb({ existingSubjectId: EXISTING_USER_ID });

    const userId = await ensureAppUser(db, input({
      groups: ['SystemAdmin'],
      technicalAdminBootstrapSubject: SUBJECT,
    }), makeDeps().deps);

    expect(userId).toBe(EXISTING_USER_ID);
    expect(roles).toEqual(['Student', 'TechnicalAdmin']);
    expect(calls.some((text) => text.includes('INSERT INTO app_user'))).toBe(false);
  });

  it('elevates an exact-subject SystemAdmin after reclaiming an unprivileged stale row', async () => {
    const { db, roles, calls } = makeDb({ emailMatches: [staleMatch] });

    const userId = await ensureAppUser(db, input({
      groups: ['SystemAdmin'],
      technicalAdminBootstrapSubject: SUBJECT,
    }), makeDeps().deps);

    expect(userId).toBe(RELINKED_USER_ID);
    expect(roles).toEqual(['Student', 'TechnicalAdmin']);
    expect(calls.some((text) => text.includes('UPDATE app_user'))).toBe(true);
  });

  it('gives an ordinary genuinely new user the Student role', async () => {
    const { db, roles } = makeDb();

    const userId = await ensureAppUser(db, input(), makeDeps().deps);

    expect(userId).toBe(NEW_USER_ID);
    expect(roles).toEqual(['Student']);
  });

  it('writes the one-shot marker and a role.assigned audit event on first-login bootstrap', async () => {
    const { db, roles, bootstrapMarker } = makeDb();
    const { deps, audits } = makeDeps();

    await ensureAppUser(db, input({
      groups: ['Student', 'SystemAdmin'],
      technicalAdminBootstrapSubject: SUBJECT,
    }), deps);

    expect(roles).toEqual(['Student', 'TechnicalAdmin']);
    expect(bootstrapMarker()).toBe(true);
    expect(audits).toEqual([
      {
        actorUserId: BOOTSTRAP_AUDIT_ACTOR,
        verb: 'role.assigned',
        objectType: 'RoleAssignment',
        objectRef: NEW_USER_ID,
        context: {
          action: 'role.assigned',
          targetUserId: NEW_USER_ID,
          targetRole: 'TechnicalAdmin',
          source: 'authorizer-bootstrap',
        },
      },
    ]);
  });

  it('does not re-grant or re-audit when the one-shot marker already exists', async () => {
    const { db, roles, bootstrapMarker } = makeDb({
      existingSubjectId: EXISTING_USER_ID,
      bootstrapMarkerPresent: true,
    });
    const { deps, audits } = makeDeps();

    await ensureAppUser(db, input({
      groups: ['SystemAdmin'],
      technicalAdminBootstrapSubject: SUBJECT,
    }), deps);

    // Student is still ensured, but the TechnicalAdmin grant is skipped.
    expect(roles).toEqual(['Student']);
    expect(bootstrapMarker()).toBe(true);
    expect(audits).toEqual([]);
  });
});

describe('grantTechnicalAdminBootstrapOnce', () => {
  const GRANT = { userId: EXISTING_USER_ID, idpSubject: SUBJECT };

  it('grants the role, writes the marker, and emits exactly one role.assigned when no marker exists', async () => {
    const { db, roles, bootstrapMarker } = makeDb();
    const { deps, audits } = makeDeps();

    const result = await grantTechnicalAdminBootstrapOnce(db, GRANT, {
      recordActivityEvent: deps.recordActivityEvent,
    });

    expect(result).toEqual({ granted: true });
    expect(roles).toEqual(['TechnicalAdmin']);
    expect(bootstrapMarker()).toBe(true);
    expect(audits).toEqual([
      {
        actorUserId: BOOTSTRAP_AUDIT_ACTOR,
        verb: 'role.assigned',
        objectType: 'RoleAssignment',
        objectRef: EXISTING_USER_ID,
        context: {
          action: 'role.assigned',
          targetUserId: EXISTING_USER_ID,
          targetRole: 'TechnicalAdmin',
          source: 'authorizer-bootstrap',
        },
      },
    ]);
  });

  it('is a no-op (no role, no marker write, no audit) when the marker already exists', async () => {
    const { db, roles, bootstrapMarker } = makeDb({ bootstrapMarkerPresent: true });
    const { deps, audits } = makeDeps();

    const result = await grantTechnicalAdminBootstrapOnce(db, GRANT, {
      recordActivityEvent: deps.recordActivityEvent,
    });

    expect(result).toEqual({ granted: false });
    expect(roles).toEqual([]);
    expect(bootstrapMarker()).toBe(true);
    expect(audits).toEqual([]);
  });

  it('fails closed without a transactional data-access handle', async () => {
    const { db } = makeDb({ transactional: false });
    const { deps, audits } = makeDeps();

    await expect(
      grantTechnicalAdminBootstrapOnce(db, GRANT, {
        recordActivityEvent: deps.recordActivityEvent,
      }),
    ).rejects.toThrow(/transactional/);
    expect(audits).toEqual([]);
  });
});

describe('ensureAppUser — email relink hardening (finding f-4531f8e7)', () => {
  it('refuses to provision or match anything when the email is unverified', async () => {
    const { db, calls, roles } = makeDb({ emailMatches: [staleMatch] });
    const { deps, audits, logs } = makeDeps();

    await expectRefusal(ensureAppUser(db, input({ emailVerified: false }), deps), 'email_unverified');

    // The email lookup is never consulted and nothing is written.
    expect(calls.some((text) => text.includes('lower(email)'))).toBe(false);
    expect(calls.some((text) => text.includes('UPDATE app_user'))).toBe(false);
    expect(calls.some((text) => text.includes('INSERT INTO app_user'))).toBe(false);
    expect(roles).toEqual([]);
    expect(audits).toEqual([]);
    expect(logs).toEqual([
      expect.objectContaining({ event: 'identity_relink_refused', reason: 'email_unverified' }),
    ]);
  });

  it('does not require email verification for a subject that is already linked', async () => {
    const { db, calls } = makeDb({ existingSubjectId: EXISTING_USER_ID });

    const userId = await ensureAppUser(db, input({ emailVerified: false }), makeDeps().deps);

    expect(userId).toBe(EXISTING_USER_ID);
    expect(calls.some((text) => text.includes('lower(email)'))).toBe(false);
  });

  it('fails closed when the matched row is still bound to a live subject', async () => {
    const { db, relinkParams, roles } = makeDb({ emailMatches: [staleMatch] });
    const { deps, audits, logs, livenessChecks } = makeDeps({
      isSubjectLive: async () => true,
    });

    await expectRefusal(ensureAppUser(db, input(), deps), 'identity_still_bound');

    expect(relinkParams).toEqual([]);
    expect(roles).toEqual([]);
    expect(audits).toEqual([]);
    expect(livenessChecks).toEqual([]);
    expect(logs).toEqual([
      expect.objectContaining({
        event: 'identity_relink_refused',
        reason: 'identity_still_bound',
        userId: RELINKED_USER_ID,
        previousSubject: OLD_SUBJECT,
        attemptedSubject: SUBJECT,
      }),
    ]);
  });

  it('fails closed (no relink) when the liveness check errors', async () => {
    const { db, relinkParams } = makeDb({ emailMatches: [staleMatch] });
    const { deps } = makeDeps({
      isSubjectLive: async () => {
        throw new Error('Cognito throttled');
      },
    });

    await expect(ensureAppUser(db, input(), deps)).rejects.toThrow('Cognito throttled');
    expect(relinkParams).toEqual([]);
  });

  it.each([
    ['a DepartmentAdmin / TechnicalAdmin or scoped role', { has_elevated_role: true, roles: ['DepartmentAdmin', 'Student'] }],
    ['an active access grant', { has_access_grant: true }],
    ['an active department visibility grant', { has_visibility_grant: true }],
  ])('never auto-relinks a row holding %s', async (_case, flags) => {
    const { db, relinkParams, roles } = makeDb({
      emailMatches: [staleMatch],
      privileges: { ...STUDENT_ONLY, ...flags },
    });
    const { deps, audits } = makeDeps();

    await expectRefusal(ensureAppUser(db, input(), deps), 'privileged_identity');

    expect(relinkParams).toEqual([]);
    expect(roles).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('refuses an ambiguous (case-variant) email match', async () => {
    const { db, relinkParams } = makeDb({
      emailMatches: [staleMatch, { id: EXISTING_USER_ID, idp_subject: 'other-sub' }],
    });

    await expectRefusal(ensureAppUser(db, input(), makeDeps().deps), 'relink_conflict');
    expect(relinkParams).toEqual([]);
  });

  it('reports a conflict when the guarded UPDATE matches no row', async () => {
    const { db, roles } = makeDb({ emailMatches: [staleMatch], relinkConflict: true });
    const { deps, audits } = makeDeps();

    await expectRefusal(ensureAppUser(db, input(), deps), 'relink_conflict');

    expect(audits).toEqual([]);
    expect(roles).toEqual([]);
  });

  it('compare-and-sets on the inspected subject and re-checks privilege at write time', async () => {
    const { db, calls, relinkParams } = makeDb({ emailMatches: [staleMatch] });

    await ensureAppUser(db, input(), makeDeps().deps);

    expect(relinkParams).toEqual([[RELINKED_USER_ID, SUBJECT, OLD_SUBJECT, 'First', 'Admin']]);
    const update = calls.find((text) => text.includes('UPDATE app_user'))!;
    expect(update).toMatch(/AND idp_subject = \$3/);
    expect(update).toMatch(/NOT EXISTS \(SELECT 1 FROM role_assignment/);
    expect(update).toMatch(/NOT EXISTS \(SELECT 1 FROM access_grant/);
    expect(update).toMatch(/NOT EXISTS \(SELECT 1 FROM department_visibility_grant/);
    expect(update).toMatch(/RETURNING id/);
  });

  it('reclaims an unprivileged row whose previous subject no longer exists, and audits it', async () => {
    const { db, roles } = makeDb({ emailMatches: [staleMatch] });
    const { deps, audits, logs, livenessChecks } = makeDeps();

    const userId = await ensureAppUser(db, input(), deps);

    expect(userId).toBe(RELINKED_USER_ID);
    expect(livenessChecks).toEqual([OLD_SUBJECT]);
    expect(roles).toEqual(['Student']);
    expect(audits).toEqual([
      {
        actorUserId: PROVISIONING_AUDIT_ACTOR,
        verb: 'identity.relinked',
        objectType: 'AppUser',
        objectRef: RELINKED_USER_ID,
        context: {
          userId: RELINKED_USER_ID,
          previousIdpSubject: OLD_SUBJECT,
          newIdpSubject: SUBJECT,
          rolesAtRelink: ['Student'],
          claimKind: 'stale_subject',
        },
      },
    ]);
    expect(logs).toEqual([
      expect.objectContaining({
        event: 'identity_relinked',
        userId: RELINKED_USER_ID,
        previousSubject: OLD_SUBJECT,
        newSubject: SUBJECT,
      }),
    ]);
  });

  it('claims an unclaimed seed row on first verified login without a liveness lookup', async () => {
    const { db } = makeDb({
      emailMatches: [{ id: RELINKED_USER_ID, idp_subject: 'seed:first-admin' }],
    });
    const { deps, audits, livenessChecks } = makeDeps({
      isSubjectLive: async (sub) => {
        livenessChecks.push(sub);
        return true;
      },
    });

    const userId = await ensureAppUser(db, input(), deps);

    expect(userId).toBe(RELINKED_USER_ID);
    expect(livenessChecks).toEqual([]);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.context).toMatchObject({ claimKind: 'seed', previousIdpSubject: 'seed:first-admin' });
  });

  it('still refuses a privileged seed row (admins go through the operator bootstrap)', async () => {
    const { db } = makeDb({
      emailMatches: [{ id: RELINKED_USER_ID, idp_subject: 'seed:first-admin' }],
      privileges: { ...STUDENT_ONLY, has_elevated_role: true, roles: ['TechnicalAdmin'] },
    });

    await expectRefusal(ensureAppUser(db, input(), makeDeps().deps), 'privileged_identity');
  });

  it('runs the relink and its audit record in one transaction', async () => {
    const { db, transactions } = makeDb({ emailMatches: [staleMatch] });
    const { deps, audits } = makeDeps();

    await ensureAppUser(db, input(), deps);

    expect(transactions.count).toBe(1);
    expect(audits).toHaveLength(1);
  });

  it('never stores the email in the (pseudonymized) activity log', async () => {
    const { db } = makeDb({ emailMatches: [staleMatch] });
    const { deps, audits } = makeDeps();

    await ensureAppUser(db, input(), deps);

    expect(JSON.stringify(audits)).not.toMatch(/example\.com/i);
  });

  it('fails closed (no relink) without a transactional handle', async () => {
    const { db, relinkParams } = makeDb({ emailMatches: [staleMatch], transactional: false });
    const { deps, audits, livenessChecks } = makeDeps();

    await expect(ensureAppUser(db, input(), deps)).rejects.toThrow(/transactional/);
    expect(relinkParams).toEqual([]);
    expect(audits).toEqual([]);
    expect(livenessChecks).toEqual([]);
  });

  it('does not refuse when a concurrent request for the same subject won the relink', async () => {
    const { db } = makeDb({
      emailMatches: [staleMatch],
      relinkConflict: true,
      concurrentSameSubjectWinner: RELINKED_USER_ID,
    });
    const { deps, audits } = makeDeps();

    const userId = await ensureAppUser(db, input(), deps);

    expect(userId).toBe(RELINKED_USER_ID);
    // The winning request wrote the audit record; this one writes none.
    expect(audits).toEqual([]);
  });

  it('propagates an audit write failure so the transaction rolls back', async () => {
    const { db } = makeDb({ emailMatches: [staleMatch] });
    const { deps } = makeDeps({
      recordActivityEvent: async () => {
        throw new Error('permission denied for table activity_event');
      },
    });

    await expect(ensureAppUser(db, input(), deps)).rejects.toThrow(
      'permission denied for table activity_event',
    );
  });
});
