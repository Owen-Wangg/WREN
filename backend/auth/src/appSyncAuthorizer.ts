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
import {
  Kind,
  OperationTypeNode,
  parse,
  valueFromASTUntyped,
  type DocumentNode,
  type OperationDefinitionNode,
} from 'graphql';
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

export type SubscriptionType = 'debrief' | 'notification';

const SUBSCRIPTION_FIELD_TYPE: Record<string, SubscriptionType> = {
  onDebriefReady: 'debrief',
  onNotification: 'notification',
  onNotificationStateChange: 'notification',
};

interface ParsedSubscriptionOperation {
  /** The executed root field name (alias ignored), e.g. `onNotification`. */
  readonly field: string;
  /**
   * Arguments coerced exactly as AppSync will bind them: variable references
   * resolve from the `variables` map, inline literals are used directly.
   */
  readonly args: Record<string, unknown>;
}

/**
 * Parse the GraphQL document and return the single executed subscription root
 * field plus its coerced arguments — bound to the operation AppSync will
 * actually run, not to a regex over the raw text.
 *
 * Deny-closed: returns null on parse failure, when the operation cannot be
 * selected (operationName mismatch, or ambiguous multi-operation document with
 * no operationName), when the selected operation is not a subscription, or
 * when the selection set is not exactly one root field. The caller treats null
 * as "deny".
 */
function parseSubscriptionOperation(
  queryString: string,
  variables: Record<string, unknown> | undefined,
  operationName: string | undefined,
): ParsedSubscriptionOperation | null {
  let doc: DocumentNode;
  try {
    doc = parse(queryString);
  } catch {
    return null;
  }

  const operations = doc.definitions.filter(
    (d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION,
  );
  if (operations.length === 0) return null;

  // Select the operation AppSync will execute: by operationName when provided,
  // otherwise the sole operation. A multi-operation document with no
  // operationName is ambiguous — AppSync rejects it, so we deny.
  let operation: OperationDefinitionNode | undefined;
  if (operationName && operationName.trim().length > 0) {
    operation = operations.find((op) => op.name?.value === operationName);
  } else if (operations.length === 1) {
    operation = operations[0];
  }
  if (!operation) return null;

  if (operation.operation !== OperationTypeNode.SUBSCRIPTION) return null;

  // AppSync subscriptions carry exactly one root field. Reject anything else
  // (extra fields, fragment spreads) so the authorized field is unambiguous.
  const selections = operation.selectionSet.selections;
  if (selections.length !== 1) return null;
  const only = selections[0];
  if (!only || only.kind !== Kind.FIELD) return null;

  const args: Record<string, unknown> = {};
  for (const arg of only.arguments ?? []) {
    // valueFromASTUntyped resolves a VariableNode from `variables` and uses a
    // literal value directly — matching GraphQL argument coercion exactly.
    args[arg.name.value] = valueFromASTUntyped(arg.value, variables);
  }

  return { field: only.name.value, args };
}

/**
 * Return the executed GraphQL field name for a subscription operation, bound to
 * the operation AppSync will run. Returns null when the query is empty
 * (connection-phase) or cannot be resolved to a single subscription field.
 */
export function parseExecutedSubscriptionField(
  queryString: string | undefined,
  operationName?: string,
): string | null {
  if (!queryString || !queryString.trim()) return null;
  return parseSubscriptionOperation(queryString, undefined, operationName)?.field ?? null;
}

export type ResolvedSubscription =
  | { readonly kind: 'connection' }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'subscription';
      readonly field: string;
      readonly type: SubscriptionType;
      readonly args: Record<string, unknown>;
    };

/**
 * Resolve a subscription request to the operation AppSync will execute and the
 * arguments it will bind. An empty query is the connection-phase handshake;
 * anything that cannot be resolved to a known subscription field is `invalid`
 * (deny-closed).
 */
export function resolveSubscriptionRequest(
  queryString: string | undefined,
  variables: Record<string, unknown> | undefined,
  operationName: string | undefined,
): ResolvedSubscription {
  if (!queryString || !queryString.trim()) return { kind: 'connection' };

  const parsed = parseSubscriptionOperation(queryString, variables, operationName);
  if (!parsed) return { kind: 'invalid' };

  const type = SUBSCRIPTION_FIELD_TYPE[parsed.field];
  if (!type) return { kind: 'invalid' };

  return { kind: 'subscription', field: parsed.field, type, args: parsed.args };
}

/**
 * Resolve the subscription kind from the executed field name. Unrecognized
 * fields return null so the caller can deny.
 */
export function resolveSubscriptionType(
  queryString: string | undefined,
  operationName?: string,
): SubscriptionType | 'connection' | null {
  if (!queryString || !queryString.trim()) return 'connection';
  const field = parseExecutedSubscriptionField(queryString, operationName);
  if (!field) return null;
  return SUBSCRIPTION_FIELD_TYPE[field] ?? null;
}

/**
 * Read a required string argument from the coerced argument map. Non-string or
 * empty values are treated as missing.
 */
function readStringArg(
  args: Record<string, unknown>,
  name: string,
): string | null {
  const value = args[name];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

export function createAppSyncAuthorizerHandler(depsProvider: AppSyncDepsProvider) {
  return async (
    event: AppSyncAuthorizerEvent,
    lambdaContext?: { callbackWaitsForEmptyEventLoop: boolean },
  ): Promise<AppSyncAuthorizerResponse> => {
    if (lambdaContext) {
      lambdaContext.callbackWaitsForEmptyEventLoop = false;
    }

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

    // Bind the decision to the operation AppSync will execute: the field and
    // its coerced arguments come from the parsed GraphQL document + variables,
    // selected via operationName — never from a regex over the raw query.
    const resolved = resolveSubscriptionRequest(
      event.requestContext.queryString,
      event.requestContext.variables,
      event.requestContext.operationName,
    );

    // Connection-phase handshake: queryString and variables are empty.
    // Allow the WebSocket upgrade for any authenticated user, but do not cache
    // this permissive decision (ttlOverride: 0).
    if (resolved.kind === 'connection') {
      return allow(context, 0);
    }

    // Parse failure, ambiguous/unselectable operation, non-subscription,
    // multi-root-field, or unknown subscription field — all deny-closed.
    if (resolved.kind === 'invalid') {
      return deny();
    }

    if (resolved.type === 'notification') {
      const recipientUserId = readStringArg(resolved.args, 'recipientUserId');
      if (!recipientUserId || recipientUserId !== context.userId) {
        return deny();
      }
      return allow(context);
    }

    // Debrief subscriptions: Student role + document ownership. Deny by default
    // when documentId is missing or unresolvable.
    if (!context.roles.includes('Student')) return deny();

    const documentId = readStringArg(resolved.args, 'documentId');
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
