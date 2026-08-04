/**
 * AppSync Lambda authorizer (REQ-SEC-AUTHDECOUPLE-01 / REQ-SEC-ROLE-01).
 *
 * Enforces the same two-step auth model as the REST Lambda authorizer:
 *   1. Verify the Cognito JWT (signature / issuer / expiry).
 *   2. Map the verified subject to the app DB identity — roles and ownership
 *      are sourced from Postgres, never from token claims (Requirement 37.3).
 *
 * Additionally enforces subscription-level ownership:
 *   - Only users with the 'Student' role may hold subscriptions.
 *   - The `documentId` argument must belong to the requesting student
 *     (SELECT owner_user_id FROM document WHERE id = $1).
 *
 * Returns an AppSync Lambda authorization response with:
 *   isAuthorized: true/false
 *   resolverContext: userId, roles (for downstream resolver use)
 *   ttlOverride: absent — use the 300s TTL set in the CDK construct. The
 *     authorizer runs once at WebSocket connection time (not per message);
 *     caching reconnections for 5 min is safe since ownership is immutable.
 *
 * AppSync Lambda authorizer event shape:
 *   authorizationToken  — the raw JWT (AppSync strips "Bearer " prefix)
 *   requestContext.apiId
 *   requestContext.accountId
 *   requestContext.requestId
 *   requestContext.queryString   — the GraphQL operation string
 *   requestContext.variables     — { documentId: "..." } for the subscription
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

function deny(): AppSyncAuthorizerResponse {
  return { isAuthorized: false };
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

    // Only Students hold subscriptions. Admins and other roles do not interact
    // with the student-facing debrief subscription surface.
    if (!context.roles.includes('Student')) return deny();

    // Ownership check: the subscribed documentId must belong to this student.
    //
    // AppSync invokes the Lambda authorizer twice for WebSocket subscriptions:
    //   1. Connection phase (HTTP upgrade): queryString and variables are empty.
    //      Allow the connection based on JWT + Student role alone.
    //   2. Subscription phase (start message): variables contain documentId.
    //      Enforce ownership here.
    const documentId =
      typeof event.requestContext.variables?.['documentId'] === 'string'
        ? event.requestContext.variables['documentId']
        : null;

    if (documentId) {
      const owns = await isDocumentOwner(documentId, context.userId, db);
      if (!owns) return deny();
    }

    return {
      isAuthorized: true,
      resolverContext: {
        userId: context.userId,
        roles: JSON.stringify(context.roles),
      },
      // No ttlOverride — use the 300s TTL configured in the CDK construct.
    };
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
