/**
 * AppSync Lambda authorizer (REQ-SEC-AUTHDECOUPLE-01 / REQ-SEC-ROLE-01).
 *
 * Enforces the same two-step auth model as the REST Lambda authorizer:
 *   1. Verify the Cognito JWT (signature / issuer / expiry).
 *   2. Map the verified subject to the app DB identity — roles and ownership
 *      are sourced from Postgres, never from token claims (Requirement 37.3).
 *
 * Additionally enforces subscription-level ownership:
 *   - `onDebriefReady`: Student role + the `documentId` argument must belong
 *     to the requesting student.
 *   - `onNotification` / `onNotificationStateChange`: `recipientUserId` must
 *     equal the authenticated user (self-subscription).
 *
 * Authorization decisions made without a validated subscription argument
 * (connection-phase handshake) return `ttlOverride: 0` so they cannot be
 * reused for a later subscribe call. The CDK construct also disables the
 * authorizer result cache (`resultsCacheTtl: 0`) because AppSync keys that
 * cache by token only — a cached Allow for document A must never authorize
 * document B.
 *
 * AppSync Lambda authorizer event shape:
 *   authorizationToken  — the raw JWT (AppSync strips "Bearer " prefix)
 *   requestContext.apiId
 *   requestContext.accountId
 *   requestContext.requestId
 *   requestContext.queryString   — the GraphQL operation string
 *   requestContext.variables     — arguments for the subscription
 */
import { resolveCognitoVerifierConfig } from './config';
import { mapSubjectToAuthContext, type QueryExecutor } from './identityMapping';
import type { TokenVerifier } from './tokenVerifier';

export interface AppSyncAuthorizerEvent {
  readonly authorizationToken: string;
  readonly requestContext: {
    readonly apiId: string;
    readonly accountId: string;
    readonly requestId: string;
    readonly queryString: string;
    readonly operationName?: string;
    readonly variables?: Record<string, unknown>;
  };
}

export interface AppSyncAuthorizerResponse {
  readonly isAuthorized: boolean;
  readonly resolverContext?: Record<string, string>;
  readonly deniedFields?: string[];
  readonly ttlOverride?: number;
}

export interface AppSyncAuthorizerDeps {
  readonly verifier: TokenVerifier;
  readonly db: QueryExecutor;
}

export type AppSyncDepsProvider = () => Promise<AppSyncAuthorizerDeps>;

function deny(ttlOverride = 0): AppSyncAuthorizerResponse {
  return { isAuthorized: false, ttlOverride };
}

function allow(
  context: { userId: string; roles: readonly string[] },
  ttlOverride?: number,
): AppSyncAuthorizerResponse {
  const response: AppSyncAuthorizerResponse = {
    isAuthorized: true,
    resolverContext: {
      userId: context.userId,
      roles: JSON.stringify(context.roles),
    },
  };
  if (ttlOverride !== undefined) {
    return { ...response, ttlOverride };
  }
  return response;
}

/**
 * Extract and verify the JWT from the authorization token, which AppSync
 * delivers with or without a "Bearer " prefix depending on the client.
 */
function extractToken(raw: string): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? (match[1] ?? '').trim() || null : raw.trim() || null;
}

/**
 * Check whether the document is owned by this user. Uses a single targeted
 * query — no joins — because we only need the owner_user_id column.
 */
async function isDocumentOwner(
  documentId: string,
  userId: string,
  db: QueryExecutor,
): Promise<boolean> {
  const rows = await db.query<{ owner_user_id: string }>(
    'SELECT owner_user_id FROM document WHERE id = $1',
    [documentId],
  );
  return rows[0]?.owner_user_id === userId;
}

/** Strip GraphQL comments and neutralize string literals so field parsing
 * cannot be confused by quoted/commented subscription names. */
function stripGraphqlNoise(query: string): string {
  return query
    .replace(/#[^\n\r]*/g, ' ')
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/**
 * Return the executed GraphQL field name for a subscription operation.
 * Handles aliases (`alias: onDebriefReady`) and anonymous selection sets.
 * Returns null when the query is empty (connection-phase) or unparseable.
 */
export function parseExecutedSubscriptionField(
  queryString: string | undefined,
): string | null {
  if (!queryString || !queryString.trim()) return null;
  const stripped = stripGraphqlNoise(queryString);

  const subscriptionMatch =
    /\bsubscription\b(?:\s+[A-Za-z_][A-Za-z0-9_]*)?(?:\s*\([^)]*\))?\s*\{/i.exec(
      stripped,
    );
  let bodyStart = -1;
  if (subscriptionMatch) {
    bodyStart = (subscriptionMatch.index ?? 0) + subscriptionMatch[0].length;
  } else {
    const brace = stripped.indexOf('{');
    if (brace >= 0) bodyStart = brace + 1;
  }
  if (bodyStart < 0) return null;

  const rest = stripped.slice(bodyStart).trim();
  const fieldMatch =
    /^(?:[A-Za-z_][A-Za-z0-9_]*\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
  return fieldMatch?.[1] ?? null;
}

export type SubscriptionType = 'debrief' | 'notification';

const SUBSCRIPTION_FIELD_TYPE: Record<string, SubscriptionType> = {
  onDebriefReady: 'debrief',
  onNotification: 'notification',
  onNotificationStateChange: 'notification',
};

/**
 * Resolve the subscription kind from the executed field name. Unrecognized
 * fields return null so the caller can deny.
 */
export function resolveSubscriptionType(
  queryString: string | undefined,
): SubscriptionType | 'connection' | null {
  if (!queryString || !queryString.trim()) return 'connection';
  const field = parseExecutedSubscriptionField(queryString);
  if (!field) return null;
  return SUBSCRIPTION_FIELD_TYPE[field] ?? null;
}

function readStringArg(
  variables: Record<string, unknown> | undefined,
  queryString: string | undefined,
  name: string,
): string | null {
  const fromVar = variables?.[name];
  if (typeof fromVar === 'string' && fromVar.trim().length > 0) {
    return fromVar.trim();
  }
  if (!queryString) return null;
  const re = new RegExp(`\\b${name}\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = re.exec(queryString);
  if (!match?.[1]) return null;
  return match[1].replace(/\\"/g, '"').trim() || null;
}

export function createAppSyncAuthorizerHandler(depsProvider: AppSyncDepsProvider) {
  return async (event: AppSyncAuthorizerEvent): Promise<AppSyncAuthorizerResponse> => {
    const token = extractToken(event.authorizationToken);
    if (!token) return deny();

    const { verifier, db } = await depsProvider();

    let subject: string;
    try {
      const identity = await verifier.verify(token);
      subject = identity.subject;
    } catch {
      return deny();
    }

    // Authorization is resolved entirely from the app DB — not from token claims.
    const context = await mapSubjectToAuthContext(subject, db);
    if (!context) return deny();

    const subscriptionType = resolveSubscriptionType(event.requestContext.queryString);

    // Connection-phase handshake: queryString and variables are empty.
    // Allow the WebSocket upgrade for any authenticated user, but do not cache
    // this permissive decision (ttlOverride: 0).
    if (subscriptionType === 'connection') {
      return allow(context, 0);
    }

    if (subscriptionType === null) {
      return deny();
    }

    if (subscriptionType === 'notification') {
      const recipientUserId = readStringArg(
        event.requestContext.variables,
        event.requestContext.queryString,
        'recipientUserId',
      );
      if (!recipientUserId || recipientUserId !== context.userId) {
        return deny();
      }
      return allow(context);
    }

    // Debrief subscriptions: Student role + document ownership. Deny by default
    // when documentId is missing (inline literals are still extracted above).
    if (!context.roles.includes('Student')) return deny();

    const documentId = readStringArg(
      event.requestContext.variables,
      event.requestContext.queryString,
      'documentId',
    );
    if (!documentId || !(await isDocumentOwner(documentId, context.userId, db))) {
      return deny();
    }

    return allow(context);
  };
}

let cachedDeps: AppSyncAuthorizerDeps | undefined;

async function defaultDepsProvider(): Promise<AppSyncAuthorizerDeps> {
  if (cachedDeps) return cachedDeps;
  const [{ getDataAccess }, { CognitoTokenVerifier }] = await Promise.all([
    import('@wren/db-node'),
    import('./tokenVerifier.js'),
  ]);
  const db = await getDataAccess();
  const cognitoConfig = resolveCognitoVerifierConfig();
  const verifier = new CognitoTokenVerifier(cognitoConfig);
  cachedDeps = { verifier, db };
  return cachedDeps;
}

export const handler = createAppSyncAuthorizerHandler(defaultDepsProvider);
