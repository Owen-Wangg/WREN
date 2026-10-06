/**
 * Unit tests for the AppSync Lambda authorizer — subscription field parsing,
 * deny-by-default ownership, and uncached connection-phase Allow.
 */
import {
  createAppSyncAuthorizerHandler,
  parseExecutedSubscriptionField,
  resolveSubscriptionRequest,
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
  operationName?: string;
}): AppSyncAuthorizerEvent {
  return {
    authorizationToken: partial.token ?? JSON.stringify({ sub: USER.idp_subject }),
    requestContext: {
      apiId: 'api',
      accountId: '123',
      requestId: 'req',
      queryString: partial.queryString ?? '',
      operationName: partial.operationName,
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

describe('resolveSubscriptionRequest (argument binding)', () => {
  it('reports connection phase for an empty query', () => {
    expect(resolveSubscriptionRequest('', undefined, undefined)).toEqual({
      kind: 'connection',
    });
  });

  it('resolves a variable reference from the variables map', () => {
    const result = resolveSubscriptionRequest(
      'subscription On($recipientUserId: ID!) { onNotification(recipientUserId: $recipientUserId) { id } }',
      { recipientUserId: 'self-id' },
      undefined,
    );
    expect(result).toEqual({
      kind: 'subscription',
      field: 'onNotification',
      type: 'notification',
      args: { recipientUserId: 'self-id' },
    });
  });

  it('binds the inline literal AppSync executes, ignoring an unrelated variables entry', () => {
    // The query hardcodes the victim via a literal; the variables map carries a
    // different (attacker-owned) value under the same name. GraphQL coercion
    // uses the literal, so the resolved arg must be the literal — not the var.
    const result = resolveSubscriptionRequest(
      'subscription { onNotification(recipientUserId: "victim-id") { id } }',
      { recipientUserId: 'attacker-id' },
      undefined,
    );
    expect(result).toMatchObject({
      kind: 'subscription',
      args: { recipientUserId: 'victim-id' },
    });
  });

  it('ignores commented-out arguments', () => {
    const query = `
      subscription {
        # recipientUserId: "attacker-id"
        onNotification(recipientUserId: "victim-id") { id }
      }
    `;
    expect(resolveSubscriptionRequest(query, undefined, undefined)).toMatchObject({
      args: { recipientUserId: 'victim-id' },
    });
  });

  it('selects the operation named by operationName', () => {
    const query = `
      subscription Self { onNotification(recipientUserId: "self-id") { id } }
      subscription Victim { onNotification(recipientUserId: "victim-id") { id } }
    `;
    expect(
      resolveSubscriptionRequest(query, undefined, 'Victim'),
    ).toMatchObject({ args: { recipientUserId: 'victim-id' } });
    expect(
      resolveSubscriptionRequest(query, undefined, 'Self'),
    ).toMatchObject({ args: { recipientUserId: 'self-id' } });
  });

  it('is invalid for a multi-operation document with no operationName', () => {
    const query = `
      subscription Self { onNotification(recipientUserId: "self-id") { id } }
      subscription Victim { onNotification(recipientUserId: "victim-id") { id } }
    `;
    expect(resolveSubscriptionRequest(query, undefined, undefined)).toEqual({
      kind: 'invalid',
    });
  });

  it('is invalid when the selection set has more than one root field', () => {
    const query = `
      subscription {
        onNotification(recipientUserId: "self-id") { id }
        onDebriefReady(documentId: "doc-id") { documentId }
      }
    `;
    expect(resolveSubscriptionRequest(query, undefined, undefined)).toEqual({
      kind: 'invalid',
    });
  });

  it('is invalid for a non-subscription operation', () => {
    expect(
      resolveSubscriptionRequest('query { _health }', undefined, undefined),
    ).toEqual({ kind: 'invalid' });
  });

  it('is invalid for an unparseable document', () => {
    expect(
      resolveSubscriptionRequest('subscription { onNotification(', undefined, undefined),
    ).toEqual({ kind: 'invalid' });
  });

  it('is invalid for an unknown subscription field', () => {
    expect(
      resolveSubscriptionRequest(
        'subscription { onSomethingElse(recipientUserId: "x") { id } }',
        undefined,
        undefined,
      ),
    ).toEqual({ kind: 'invalid' });
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

/**
 * Regression tests for the three BROKEN_OBJECT_PROPERTY_AUTHORIZATION vectors
 * (f-5fc7184a). Each previously let a caller authorize a stream whose argument
 * does not match what AppSync binds. The authorizer now decides on the parsed,
 * coerced operation, so each must deny while the matching legitimate request
 * still authorizes.
 */
describe('createAppSyncAuthorizerHandler — argument-binding exploit vectors', () => {
  const studentRoles: RoleAssignmentRow[] = [{ role: 'Student', scope: null }];
  const VICTIM = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  function handlerFor(roles: RoleAssignmentRow[]) {
    return createAppSyncAuthorizerHandler(async () => ({
      verifier: fakeVerifier,
      db: makeDb(roles),
    }));
  }

  it('denies an inline-literal victim id when the attacker puts their own id in variables', async () => {
    // Previously: readStringArg preferred variables[recipientUserId] (self), so
    // the ownership compare passed while AppSync bound the literal (victim).
    const handler = handlerFor(studentRoles);
    const result = await handler(
      event({
        queryString: `subscription { onNotification(recipientUserId: "${VICTIM}") { id } }`,
        variables: { recipientUserId: USER.id },
      }),
    );
    expect(result.isAuthorized).toBe(false);
  });

  it('denies a comment-decoy own id placed above the real victim argument', async () => {
    // Previously: the raw-query regex matched the first `recipientUserId: "…"`
    // (the comment, self) while AppSync bound the real argument (victim).
    const handler = handlerFor(studentRoles);
    const query = `
      subscription {
        # recipientUserId: "${USER.id}"
        onNotification(recipientUserId: "${VICTIM}") { id }
      }
    `;
    const result = await handler(event({ queryString: query }));
    expect(result.isAuthorized).toBe(false);
  });

  it('denies when operationName selects a victim operation even if the first block is self-owned', async () => {
    // Previously: resolveSubscriptionType read the first subscription block
    // (self) while operationName steered AppSync to the second (victim).
    const handler = handlerFor(studentRoles);
    const query = `
      subscription Self { onNotification(recipientUserId: "${USER.id}") { id } }
      subscription Victim { onNotification(recipientUserId: "${VICTIM}") { id } }
    `;
    const denied = await handler(
      event({ queryString: query, operationName: 'Victim' }),
    );
    expect(denied.isAuthorized).toBe(false);

    // The genuinely self-owned operation still authorizes when selected.
    const allowed = await handler(
      event({ queryString: query, operationName: 'Self' }),
    );
    expect(allowed.isAuthorized).toBe(true);
  });

  it('denies an inline-literal other document even when an owned documentId is in variables', async () => {
    // onDebriefReady mirror of the inline-literal vector.
    const handler = handlerFor(studentRoles);
    const result = await handler(
      event({
        queryString: `subscription { onDebriefReady(documentId: "${OTHER_DOC}") { documentId } }`,
        variables: { documentId: OWNED_DOC },
      }),
    );
    expect(result.isAuthorized).toBe(false);
  });
});
