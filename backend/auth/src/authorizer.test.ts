/**
 * Unit tests for the API Gateway Lambda authorizer (Requirements 36.1, 36.2,
 * 37.1, 37.2, 37.3, 37.5).
 *
 * Covers the three behaviours called out for task 3.1:
 *   - a valid token resolves an identity + roles from the DB (Allow + context);
 *   - roles come from the DB, NOT the JWT — a token carrying a bogus `groups`/
 *     `role` claim does not grant that role;
 *   - an invalid / expired / wrong-issuer token is rejected.
 */
import type { APIGatewayTokenAuthorizerEvent } from 'aws-lambda';

import {
  createAuthorizerHandler,
  extractBearerToken,
  stageWildcardResource,
  UNAUTHORIZED,
  type AuthorizerDeps,
} from './authorizer';
import type { AccessGrantRow, AppUserRow, QueryExecutor, RoleAssignmentRow } from './identityMapping';
import type { TokenVerifier } from './tokenVerifier';

const METHOD_ARN =
  'arn:aws:execute-api:ca-central-1:123456789012:abcdef123/prod/GET/documents';

const USER: AppUserRow = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'writer@example.com',
  idp_subject: 'cognito-sub-xyz',
};

/**
 * A fake verifier that treats the token string as JSON. It returns ONLY the
 * subject — exactly like the real Cognito verifier, which discards every other
 * claim. Setting `{ "invalid": true }` simulates a failed verification.
 */
const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    const payload = JSON.parse(token) as { sub?: string; invalid?: boolean };
    if (payload.invalid || !payload.sub) {
      throw new Error('invalid token: bad signature / issuer / expiry');
    }
    return { subject: payload.sub, groups: [] };
  },
};

function makeDb(roles: RoleAssignmentRow[], grants: AccessGrantRow[] = [], user: AppUserRow | null = USER): QueryExecutor {
  const users = user ? [user] : [];
  const roleRows = [...roles];
  return {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      if (text.includes('INSERT INTO app_user')) {
        const [email, firstName, lastName, idpSubject] = params as [
          string,
          string,
          string,
          string,
        ];
        if (!users.some((u) => u.idp_subject === idpSubject)) {
          users.push({
            id: '33333333-3333-3333-3333-333333333333',
            email,
            idp_subject: idpSubject,
          });
          void firstName;
          void lastName;
        }
        return [] as unknown as Row[];
      }
      if (text.includes('UPDATE app_user') && text.includes('idp_subject')) {
        const [idpSubject, id] = params as [string, string];
        const idx = users.findIndex((u) => u.id === id);
        if (idx >= 0) {
          users[idx] = { ...users[idx], idp_subject: idpSubject };
        }
        return [] as unknown as Row[];
      }
      if (text.includes('lower(email)')) {
        const found = users.find((u) => u.email.toLowerCase() === String(params[0]).toLowerCase());
        return (found ? [{ id: found.id }] : []) as unknown as Row[];
      }
      if (text.includes('SELECT id FROM app_user')) {
        const found = users.find((u) => u.idp_subject === params[0]);
        return (found ? [{ id: found.id }] : []) as unknown as Row[];
      }
      if (text.includes('INSERT INTO role_assignment')) {
        roleRows.push({ role: 'Student', scope: null });
        return [] as unknown as Row[];
      }
      if (text.includes('FROM app_user')) {
        const found = users.find((u) => u.idp_subject === params[0]);
        return (found ? [found] : []) as unknown as Row[];
      }
      if (text.includes('FROM role_assignment')) {
        return roleRows as unknown as Row[];
      }
      if (text.includes('FROM access_grant')) {
        return grants as unknown as Row[];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

const lookupProfile = async () => ({
  email: 'writer@example.com',
  firstName: 'Test',
  lastName: 'User',
});

function depsFor(db: QueryExecutor, verifier: TokenVerifier = fakeVerifier): AuthorizerDeps {
  return { verifier, db, lookupProfile };
}

function event(authorizationToken: string): APIGatewayTokenAuthorizerEvent {
  return { type: 'TOKEN', authorizationToken, methodArn: METHOD_ARN };
}

function tokenFor(payload: Record<string, unknown>): string {
  return `Bearer ${JSON.stringify(payload)}`;
}

describe('extractBearerToken', () => {
  it('strips a Bearer prefix and trims', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('  raw-token  ')).toBe('raw-token');
  });
  it('returns undefined for missing/empty input', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
    expect(extractBearerToken('')).toBeUndefined();
    expect(extractBearerToken('Bearer   ')).toBeUndefined();
  });
});

describe('stageWildcardResource', () => {
  it('reduces a method arn to a stage-wide wildcard (coarse, cacheable)', () => {
    expect(stageWildcardResource(METHOD_ARN)).toBe(
      'arn:aws:execute-api:ca-central-1:123456789012:abcdef123/prod/*',
    );
  });
});

describe('Lambda authorizer', () => {
  it('allows a valid token and emits the DB-resolved authorization context', async () => {
    const deps = depsFor(
      makeDb([
        { role: 'Student', scope: null },
        { role: 'DepartmentAdmin', scope: { departmentIds: ['dept-1'] } },
      ]),
    );
    const handler = createAuthorizerHandler(async () => deps);

    const result = await handler(event(tokenFor({ sub: USER.idp_subject })));

    expect(result.principalId).toBe(USER.id);
    expect(result.policyDocument.Statement[0]).toMatchObject({
      Action: 'execute-api:Invoke',
      Effect: 'Allow',
      Resource: 'arn:aws:execute-api:ca-central-1:123456789012:abcdef123/prod/*',
    });
    expect(result.context?.userId).toBe(USER.id);
    expect(result.context?.email).toBe(USER.email);
    expect(JSON.parse(String(result.context?.roles))).toEqual(['Student', 'DepartmentAdmin']);
    expect(JSON.parse(String(result.context?.administeredDepartmentIds))).toEqual(['dept-1']);
  });

  it('does NOT honor IdP claims: a bogus groups/role claim grants no role (Req 37.3)', async () => {
    // The DB says this subject is only a plain "Student".
    const deps = depsFor(makeDb([{ role: 'Student', scope: null }]));
    const handler = createAuthorizerHandler(async () => deps);

    // The token loudly claims TechnicalAdmin/DepartmentAdmin via groups + a role claim.
    const result = await handler(
      event(
        tokenFor({
          sub: USER.idp_subject,
          groups: ['TechnicalAdmin', 'DepartmentAdmin'],
          role: 'TechnicalAdmin',
          'cognito:groups': ['TechnicalAdmin'],
        }),
      ),
    );

    // Authorization reflects ONLY the app DB — the claims are ignored entirely.
    expect(JSON.parse(String(result.context?.roles))).toEqual(['Student']);
    expect(JSON.parse(String(result.context?.administeredDepartmentIds))).toEqual([]);
  });

  it('rejects an invalid / expired / wrong-issuer token with Unauthorized (Req 37.1)', async () => {
    const deps = depsFor(makeDb([{ role: 'Student', scope: null }]));
    const handler = createAuthorizerHandler(async () => deps);

    await expect(handler(event(tokenFor({ invalid: true })))).rejects.toThrow(UNAUTHORIZED);
  });

  it('rejects a request with no token', async () => {
    const deps = depsFor(makeDb([]));
    const handler = createAuthorizerHandler(async () => deps);
    await expect(handler(event(''))).rejects.toThrow(UNAUTHORIZED);
  });

  it('freezes the Lambda event loop so pooled postgres sockets do not race the response', async () => {
    const deps = depsFor(makeDb([{ role: 'Student', scope: null }]));
    const handler = createAuthorizerHandler(async () => deps);
    const lambdaContext = { callbackWaitsForEmptyEventLoop: true } as import('aws-lambda').Context;
    await handler(event(tokenFor({ sub: USER.idp_subject })), lambdaContext);
    expect(lambdaContext.callbackWaitsForEmptyEventLoop).toBe(false);
  });

  it('does not remap identity-mapping errors to Unauthorized (cached 401 would lock the token)', async () => {
    const db: QueryExecutor = {
      async query() {
        throw new Error('relation "app_user" does not exist');
      },
    };
    const handler = createAuthorizerHandler(async () => depsFor(db));
    await expect(handler(event(tokenFor({ sub: USER.idp_subject })))).rejects.toThrow(
      'relation "app_user" does not exist',
    );
  });

  it('relinks an existing app_user row whose email matches but idp_subject does not', async () => {
    const existing: AppUserRow = {
      id: '44444444-4444-4444-4444-444444444444',
      email: 'writer@example.com',
      idp_subject: 'old-cognito-sub',
    };
    const deps = depsFor(makeDb([], [], existing));
    const handler = createAuthorizerHandler(async () => deps);
    const result = await handler(event(tokenFor({ sub: 'new-cognito-sub' })));
    expect(result.principalId).toBe(existing.id);
    expect(result.policyDocument.Statement[0]).toMatchObject({ Effect: 'Allow' });
  });

  it('provisions a verified subject with no app_user as Student on first login', async () => {
    const deps = depsFor(makeDb([], [], null));
    const handler = createAuthorizerHandler(async () => deps);

    const result = await handler(event(tokenFor({ sub: 'ghost-subject' })));
    expect(result.principalId).toBe('33333333-3333-3333-3333-333333333333');
    expect(result.policyDocument.Statement[0]).toMatchObject({ Effect: 'Allow' });
    expect(JSON.parse(String(result.context?.roles))).toEqual(['Student']);
    expect(result.context?.email).toBe('writer@example.com');
  });
});

/**
 * First-admin bootstrap for an ALREADY-PROVISIONED candidate (option 2a).
 *
 * These exercise the authorizer end-to-end for a user who already has a Student
 * row — the case the app forces by auto-loading the dashboard on signup, and
 * the one the `if (!context)` first-login path can never reach. The verifier
 * returns `groups: []` (as a real Cognito ACCESS token does), so these also
 * prove the elevation does NOT depend on the `cognito:groups` claim: the sole
 * gate is the operator-armed exact subject.
 */
describe('Lambda authorizer — armed-subject TechnicalAdmin elevation', () => {
  const SUBJECT = USER.idp_subject;
  const ORIGINAL_ARMED = process.env.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT;

  /**
   * DB fake that tracks role rows precisely, distinguishing the Student insert
   * from the TechnicalAdmin insert (unlike the shared makeDb, which always
   * pushes Student).
   */
  function makeRoleTrackingDb(initialRoles: RoleAssignmentRow[]): {
    db: QueryExecutor;
    roles: () => string[];
  } {
    const roleRows: RoleAssignmentRow[] = [...initialRoles];
    const db: QueryExecutor = {
      async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
        if (text.includes("'TechnicalAdmin'")) {
          if (!roleRows.some((r) => r.role === 'TechnicalAdmin')) {
            roleRows.push({ role: 'TechnicalAdmin', scope: null });
          }
          return [] as unknown as Row[];
        }
        if (text.includes("'Student'")) {
          if (!roleRows.some((r) => r.role === 'Student')) {
            roleRows.push({ role: 'Student', scope: null });
          }
          return [] as unknown as Row[];
        }
        if (text.includes('SELECT id FROM app_user')) {
          return (params[0] === SUBJECT ? [{ id: USER.id }] : []) as unknown as Row[];
        }
        if (text.includes('FROM app_user')) {
          return (params[0] === SUBJECT ? [USER] : []) as unknown as Row[];
        }
        if (text.includes('FROM role_assignment')) {
          return roleRows as unknown as Row[];
        }
        if (text.includes('FROM access_grant')) {
          return [] as unknown as Row[];
        }
        throw new Error(`unexpected query: ${text}`);
      },
    };
    return { db, roles: () => roleRows.map((r) => r.role) };
  }

  afterEach(() => {
    if (ORIGINAL_ARMED === undefined) delete process.env.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT;
    else process.env.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT = ORIGINAL_ARMED;
  });

  it('elevates an already-provisioned Student when their exact subject is armed', async () => {
    process.env.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT = SUBJECT;
    const { db, roles } = makeRoleTrackingDb([{ role: 'Student', scope: null }]);
    const handler = createAuthorizerHandler(async () => depsFor(db));

    const result = await handler(event(tokenFor({ sub: SUBJECT })));

    // The freshly granted role is reflected in THIS request's context. Compare
    // order-insensitively: role_assignment has no ORDER BY, so a real DB may
    // return the rows in any order.
    expect(JSON.parse(String(result.context?.roles))).toEqual(
      expect.arrayContaining(['Student', 'TechnicalAdmin']),
    );
    expect(JSON.parse(String(result.context?.roles))).toHaveLength(2);
    expect(roles()).toEqual(expect.arrayContaining(['Student', 'TechnicalAdmin']));
    expect(roles()).toHaveLength(2);
  });

  it('does not elevate when no subject is armed', async () => {
    delete process.env.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT;
    const { db, roles } = makeRoleTrackingDb([{ role: 'Student', scope: null }]);
    const handler = createAuthorizerHandler(async () => depsFor(db));

    const result = await handler(event(tokenFor({ sub: SUBJECT })));

    expect(JSON.parse(String(result.context?.roles))).toEqual(['Student']);
    expect(roles()).toEqual(['Student']);
  });

  it('does not elevate a different user while another subject is armed', async () => {
    process.env.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT = 'some-other-armed-subject';
    const { db, roles } = makeRoleTrackingDb([{ role: 'Student', scope: null }]);
    const handler = createAuthorizerHandler(async () => depsFor(db));

    const result = await handler(event(tokenFor({ sub: SUBJECT })));

    expect(JSON.parse(String(result.context?.roles))).toEqual(['Student']);
    expect(roles()).toEqual(['Student']);
  });

  it('is idempotent: an armed subject already holding TechnicalAdmin is unchanged', async () => {
    process.env.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT = SUBJECT;
    const { db, roles } = makeRoleTrackingDb([
      { role: 'Student', scope: null },
      { role: 'TechnicalAdmin', scope: null },
    ]);
    const handler = createAuthorizerHandler(async () => depsFor(db));

    const result = await handler(event(tokenFor({ sub: SUBJECT })));

    expect(JSON.parse(String(result.context?.roles))).toEqual(
      expect.arrayContaining(['Student', 'TechnicalAdmin']),
    );
    expect(JSON.parse(String(result.context?.roles))).toHaveLength(2);
    expect(roles()).toEqual(expect.arrayContaining(['Student', 'TechnicalAdmin']));
    expect(roles()).toHaveLength(2);
  });
});
