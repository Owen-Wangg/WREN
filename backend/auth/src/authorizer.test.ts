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
    return { subject: payload.sub };
  },
};

function makeDb(roles: RoleAssignmentRow[], grants: AccessGrantRow[] = [], user: AppUserRow | null = USER): QueryExecutor {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      if (text.includes('FROM app_user')) {
        return (user && user.idp_subject === params[0] ? [user] : []) as unknown as Row[];
      }
      if (text.includes('FROM role_assignment')) {
        return roles as unknown as Row[];
      }
      if (text.includes('FROM access_grant')) {
        return grants as unknown as Row[];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
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
    const deps: AuthorizerDeps = {
      verifier: fakeVerifier,
      db: makeDb([
        { role: 'User', scope: null },
        { role: 'Field Expert', scope: { writingTypeIds: ['wt-1'] } },
      ]),
    };
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
    expect(JSON.parse(String(result.context?.roles))).toEqual(['User', 'Field Expert']);
    expect(JSON.parse(String(result.context?.assignedWritingTypeIds))).toEqual(['wt-1']);
  });

  it('does NOT honor IdP claims: a bogus groups/role claim grants no role (Req 37.3)', async () => {
    // The DB says this subject is only a plain "User".
    const deps: AuthorizerDeps = {
      verifier: fakeVerifier,
      db: makeDb([{ role: 'User', scope: null }]),
    };
    const handler = createAuthorizerHandler(async () => deps);

    // The token loudly claims Admin/Org Owner via groups + a role claim.
    const result = await handler(
      event(
        tokenFor({
          sub: USER.idp_subject,
          groups: ['Admin', 'Org Owner'],
          role: 'Admin',
          'cognito:groups': ['Admin'],
        }),
      ),
    );

    // Authorization reflects ONLY the app DB — the claims are ignored entirely.
    expect(JSON.parse(String(result.context?.roles))).toEqual(['User']);
    expect(JSON.parse(String(result.context?.ownedOrganizationIds))).toEqual([]);
  });

  it('rejects an invalid / expired / wrong-issuer token with Unauthorized (Req 37.1)', async () => {
    const deps: AuthorizerDeps = {
      verifier: fakeVerifier,
      db: makeDb([{ role: 'User', scope: null }]),
    };
    const handler = createAuthorizerHandler(async () => deps);

    await expect(handler(event(tokenFor({ invalid: true })))).rejects.toThrow(UNAUTHORIZED);
  });

  it('rejects a request with no token', async () => {
    const deps: AuthorizerDeps = { verifier: fakeVerifier, db: makeDb([]) };
    const handler = createAuthorizerHandler(async () => deps);
    await expect(handler(event(''))).rejects.toThrow(UNAUTHORIZED);
  });

  it('denies a verified subject that maps to no application identity (Req 37.5)', async () => {
    const deps: AuthorizerDeps = {
      verifier: fakeVerifier,
      db: makeDb([], [], null),
    };
    const handler = createAuthorizerHandler(async () => deps);

    const result = await handler(event(tokenFor({ sub: 'ghost-subject' })));
    expect(result.principalId).toBe('ghost-subject');
    expect(result.policyDocument.Statement[0]).toMatchObject({ Effect: 'Deny' });
    expect(result.context).toBeUndefined();
  });
});
