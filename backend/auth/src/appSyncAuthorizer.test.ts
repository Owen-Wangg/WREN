/**
 * Unit tests for the AppSync Lambda authorizer — subscription field parsing,
 * deny-by-default ownership, and uncached connection-phase Allow.
 */
import {
  createAppSyncAuthorizerHandler,
  parseExecutedSubscriptionField,
  resolveSubscriptionType,
  type AppSyncAuthorizerEvent,
} from './appSyncAuthorizer';
import type { AppUserRow, QueryExecutor, RoleAssignmentRow } from './identityMapping';
import type { TokenVerifier } from './tokenVerifier';

const USER: AppUserRow = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'writer@example.com',
  idp_subject: 'cognito-sub-xyz',
};

const OWNED_DOC = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_DOC = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const fakeVerifier: TokenVerifier = {
  async verify(token: string) {
    const payload = JSON.parse(token) as { sub?: string; invalid?: boolean };
    if (payload.invalid || !payload.sub) {
      throw new Error('invalid token');
    }
    return { subject: payload.sub, groups: [] };
  },
};

function makeDb(
  roles: RoleAssignmentRow[],
  ownerByDoc: Record<string, string> = { [OWNED_DOC]: USER.id },
): QueryExecutor {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      if (text.includes('FROM app_user')) {
        return [USER] as unknown as Row[];
      }
      if (text.includes('FROM role_assignment')) {
        return roles as unknown as Row[];
      }
      if (text.includes('FROM access_grant')) {
        return [] as unknown as Row[];
      }
      if (text.includes('FROM document')) {
        const documentId = params[0] as string;
        const owner = ownerByDoc[documentId];
        return (owner ? [{ owner_user_id: owner }] : []) as unknown as Row[];
      }
      return [] as unknown as Row[];
    },
  };
}

function event(partial: {
  queryString?: string;
  variables?: Record<string, unknown>;
  token?: string;
}): AppSyncAuthorizerEvent {
  return {
    authorizationToken: partial.token ?? JSON.stringify({ sub: USER.idp_subject }),
    requestContext: {
      apiId: 'api',
      accountId: '123',
      requestId: 'req',
      queryString: partial.queryString ?? '',
      variables: partial.variables,
    },
  };
}

describe('parseExecutedSubscriptionField', () => {
  it('reads the executed field from a named subscription', () => {
    expect(
      parseExecutedSubscriptionField(
        'subscription OnReady { onDebriefReady(documentId: $documentId) { documentId } }',
      ),
    ).toBe('onDebriefReady');
  });

  it('reads the field name after an alias', () => {
    expect(
      parseExecutedSubscriptionField(
        'subscription { ready: onDebriefReady(documentId: $id) { documentId } }',
      ),
    ).toBe('onDebriefReady');
  });

  it('does not treat a commented-out field as the executed operation', () => {
    const query = `
      subscription {
        # onNotification(recipientUserId: $id) { id }
        onDebriefReady(documentId: $documentId) { documentId }
      }
    `;
    expect(parseExecutedSubscriptionField(query)).toBe('onDebriefReady');
    expect(resolveSubscriptionType(query)).toBe('debrief');
  });

  it('returns null for an empty connection-phase query', () => {
    expect(parseExecutedSubscriptionField('')).toBeNull();
    expect(parseExecutedSubscriptionField(undefined)).toBeNull();
    expect(resolveSubscriptionType('')).toBe('connection');
  });
});

describe('createAppSyncAuthorizerHandler', () => {
  const studentRoles: RoleAssignmentRow[] = [{ role: 'Student', scope: null }];
  const adminRoles: RoleAssignmentRow[] = [{ role: 'TechnicalAdmin', scope: null }];

  it('allows the connection phase with ttlOverride 0', async () => {
    const handler = createAppSyncAuthorizerHandler(async () => ({
      verifier: fakeVerifier,
      db: makeDb(studentRoles),
    }));
    const result = await handler(event({ queryString: '' }));
    expect(result.isAuthorized).toBe(true);
    expect(result.ttlOverride).toBe(0);
  });

  it('denies onDebriefReady when documentId is missing', async () => {
    const handler = createAppSyncAuthorizerHandler(async () => ({
      verifier: fakeVerifier,
      db: makeDb(studentRoles),
    }));
    const result = await handler(
      event({
        queryString: 'subscription { onDebriefReady { documentId } }',
        variables: {},
      }),
    );
    expect(result.isAuthorized).toBe(false);
  });

  it('denies onDebriefReady when the caller does not own the document', async () => {
    const handler = createAppSyncAuthorizerHandler(async () => ({
      verifier: fakeVerifier,
      db: makeDb(studentRoles),
    }));
    const result = await handler(
      event({
        queryString: 'subscription { onDebriefReady(documentId: $documentId) { documentId } }',
        variables: { documentId: OTHER_DOC },
      }),
    );
    expect(result.isAuthorized).toBe(false);
  });

  it('allows onDebriefReady for the document owner', async () => {
    const handler = createAppSyncAuthorizerHandler(async () => ({
      verifier: fakeVerifier,
      db: makeDb(studentRoles),
    }));
    const result = await handler(
      event({
        queryString: 'subscription { onDebriefReady(documentId: $documentId) { documentId } }',
        variables: { documentId: OWNED_DOC },
      }),
    );
    expect(result.isAuthorized).toBe(true);
  });

  it('enforces ownership for an inline documentId literal', async () => {
    const handler = createAppSyncAuthorizerHandler(async () => ({
      verifier: fakeVerifier,
      db: makeDb(studentRoles),
    }));
    const denied = await handler(
      event({
        queryString: `subscription { onDebriefReady(documentId: "${OTHER_DOC}") { documentId } }`,
      }),
    );
    expect(denied.isAuthorized).toBe(false);

    const allowed = await handler(
      event({
        queryString: `subscription { onDebriefReady(documentId: "${OWNED_DOC}") { documentId } }`,
      }),
    );
    expect(allowed.isAuthorized).toBe(true);
  });

  it('denies notification subscriptions when recipientUserId is missing or not self', async () => {
    const handler = createAppSyncAuthorizerHandler(async () => ({
      verifier: fakeVerifier,
      db: makeDb(adminRoles),
    }));
    const missing = await handler(
      event({
        queryString: 'subscription { onNotification { id } }',
        variables: {},
      }),
    );
    expect(missing.isAuthorized).toBe(false);

    const other = await handler(
      event({
        queryString: 'subscription { onNotification(recipientUserId: $recipientUserId) { id } }',
        variables: { recipientUserId: 'someone-else' },
      }),
    );
    expect(other.isAuthorized).toBe(false);

    const self = await handler(
      event({
        queryString: 'subscription { onNotification(recipientUserId: $recipientUserId) { id } }',
        variables: { recipientUserId: USER.id },
      }),
    );
    expect(self.isAuthorized).toBe(true);
  });

  it('denies unrecognized subscription fields', async () => {
    const handler = createAppSyncAuthorizerHandler(async () => ({
      verifier: fakeVerifier,
      db: makeDb(studentRoles),
    }));
    const result = await handler(
      event({
        queryString: 'subscription { onSomethingElse(documentId: $documentId) { id } }',
        variables: { documentId: OWNED_DOC },
      }),
    );
    expect(result.isAuthorized).toBe(false);
  });
});
