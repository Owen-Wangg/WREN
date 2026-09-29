/**
 * API Gateway Lambda authorizer (design "Request / Authorization Flow";
 * REQ-SEC-ROLE-01 / REQ-SEC-AUTHDECOUPLE-01).
 *
 * Flow (per request):
 *   1. Verify the Cognito JWT (signature / issuer / expiry) — authentication only.
 *   2. Map the verified subject to an application identity + roles + Department
 *      scopes + Access Grants by querying Postgres (the authz source of truth).
 *   3. If no app_user exists yet, provision one (default Student role) using
 *      Cognito profile attributes for email/name — still never using IdP groups.
 *   4. Emit a stage-wide IAM Allow plus authorization context (roles,
 *      administered Departments, grants) that downstream services consume and
 *      RE-CHECK against the specific operation (dual enforcement).
 *
 * The only escalation exception is a default-off first-admin bootstrap gated on
 * an exact configured Cognito subject (`TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT`),
 * armed by the guided deploy. For a genuinely new user it runs inside
 * first-login provisioning (and additionally requires the SystemAdmin group
 * claim). Because the app auto-loads the dashboard on signup — so the intended
 * admin usually already has a Student row before the subject is armed — the
 * same armed-subject gate is also re-evaluated after provisioning, elevating in
 * place on that user's first authenticated application request. No user whose
 * exact subject is not armed can ever escalate.
 *
 * The authorizer produces a COARSE stage-wide allow; REST authorizer caching is
 * disabled in `cdk/lib/openapi.yaml`, so roles/grants are loaded from the DB on
 * every request. Fine-grained per-operation decisions remain the responsibility
 * of each service. The IdP is used only to prove identity — token groups are not
 * used after the explicitly documented first-login bootstrap below.
 *
 * Heavy runtime dependencies (`@wren/db-node`, the Cognito verifier) are loaded
 * lazily by the default deps provider so the module stays cheaply importable and
 * unit-testable with injected fakes.
 */
import type {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
  Context,
  PolicyDocument,
} from 'aws-lambda';

import type { AuthContext } from '@wren/types';

import { resolveCognitoVerifierConfig } from './config';
import {
  createCognitoProfileLookup,
  type CognitoProfileLookup,
} from './cognitoProfile';
import { mapSubjectToAuthContext, type QueryExecutor } from './identityMapping';
import { ensureAppUser, ensureTechnicalAdminForArmedSubject } from './provisionUser';
import type { TokenVerifier } from './tokenVerifier';

/** Collaborators the authorizer needs; injectable for testing. */
export interface AuthorizerDeps {
  readonly verifier: TokenVerifier;
  readonly db: QueryExecutor;
  /** Resolves email/name from Cognito for first-login provisioning. */
  readonly lookupProfile: CognitoProfileLookup;
}

/** Async provider so real deps can be built lazily (and cached) at runtime. */
export type DepsProvider = () => Promise<AuthorizerDeps>;

/** Sentinel error mapped by API Gateway to a 401 response for a TOKEN authorizer. */
export const UNAUTHORIZED = 'Unauthorized';

/**
 * Emit a single structured, machine-queryable log line for an authentication
 * failure or deny decision (Issue #187). Previously the authorizer threw/denied
 * with no log line, so 401/403s at the request layer were invisible to
 * operators and unalarmable. Deliberately logs NO secrets: never the token or
 * Authorization header — only the reason, the route (methodArn), and the
 * verified subject when one is already known. Uses the stable
 * `event: "auth_failure"` key so a CloudWatch metric filter can count it.
 */
function logAuthFailure(detail: {
  reason: 'missing_token' | 'token_verification_failed' | 'provisioning_failed';
  methodArn?: string;
  subject?: string;
}): void {
  console.warn(
    JSON.stringify({
      event: 'auth_failure',
      reason: detail.reason,
      ...(detail.methodArn ? { methodArn: detail.methodArn } : {}),
      ...(detail.subject ? { subject: detail.subject } : {}),
    }),
  );
}

/**
 * Return the JWT from an `Authorization: Bearer <token>` header (RFC 6750 §2.1),
 * or `undefined`. The `Bearer` scheme is REQUIRED: a bare JWT, another scheme,
 * or a lone `Bearer` keyword is rejected so only the documented credential
 * shape is accepted on the REST API.
 */
export function extractBearerToken(authorizationToken: string | undefined): string | undefined {
  if (!authorizationToken) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationToken.trim());
  return match ? match[1] : undefined;
}

/**
 * Reduce a concrete `methodArn` to a stage-wide wildcard so a single cached
 * allow covers every method/route on the stage (coarse enforcement). Given
 * `arn:aws:execute-api:region:acct:apiId/stage/GET/foo` this returns
 * `arn:aws:execute-api:region:acct:apiId/stage/*` and, failing to parse, falls
 * back to the original arn.
 */
export function stageWildcardResource(methodArn: string): string {
  const parts = methodArn.split(':');
  if (parts.length < 6) return methodArn;
  const apiParts = parts[5].split('/');
  if (apiParts.length < 2) return methodArn;
  const [apiId, stage] = apiParts;
  return `${parts.slice(0, 5).join(':')}:${apiId}/${stage}/*`;
}

function policy(effect: 'Allow' | 'Deny', resource: string): PolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'execute-api:Invoke',
        Effect: effect,
        Resource: resource,
      },
    ],
  };
}

/**
 * Serialize an {@link AuthContext} into the string-only key/value shape API
 * Gateway allows for the authorizer context. Downstream services parse the JSON
 * fields back into arrays/objects for their per-operation re-check.
 */
export function serializeAuthContext(context: AuthContext): Record<string, string> {
  return {
    userId: context.userId,
    idpSubject: context.idpSubject,
    email: context.email,
    roles: JSON.stringify(context.roles),
    administeredDepartmentIds: JSON.stringify(context.administeredDepartmentIds),
    grants: JSON.stringify(context.grants),
  };
}

/**
 * Build a TOKEN-authorizer handler around injected dependencies.
 *
 * - Verification failure (bad signature / wrong issuer / expired / missing
 *   token) throws {@link UNAUTHORIZED} → API Gateway returns 401.
 * - A verified subject with no application identity is auto-provisioned as a
 *   Student (Cognito profile supplies email/name only).
 * - Otherwise an Allow policy plus the serialized authorization context.
 */
export function createAuthorizerHandler(depsProvider: DepsProvider) {
  return async (
    event: APIGatewayTokenAuthorizerEvent,
    lambdaContext?: Context,
  ): Promise<APIGatewayAuthorizerResult> => {
    // postgres sockets keep the event loop alive; freeze as soon as we return
    // or the 10s authorizer timeout races the success response (RIC 403).
    if (lambdaContext) {
      lambdaContext.callbackWaitsForEmptyEventLoop = false;
    }

    const token = extractBearerToken(event.authorizationToken);
    if (!token) {
      logAuthFailure({ reason: 'missing_token', methodArn: event.methodArn });
      throw new Error(UNAUTHORIZED);
    }

    try {
      const { verifier, db, lookupProfile } = await depsProvider();

      let subject: string;
      let groups: readonly string[];
      let username: string | undefined;
      try {
        const identity = await verifier.verify(token);
        subject = identity.subject;
        groups = identity.groups;
        username = identity.username;
      } catch {
        // Any verification error (signature, issuer, expiry) is a 401.
        logAuthFailure({ reason: 'token_verification_failed', methodArn: event.methodArn });
        throw new Error(UNAUTHORIZED);
      }

      const armedSubject =
        process.env.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT?.trim() || undefined;

      // Authorization is resolved ENTIRELY from the app DB using only the verified
      // subject — never from token claims (Requirement 37.2, 37.3).
      // Exception: `groups` is passed to ensureAppUser ONCE on first login so the
      // SystemAdmin Cognito group can seed TechnicalAdmin. Never consulted again.
      let context = await mapSubjectToAuthContext(subject, db);
      if (!context) {
        const profile = await lookupProfile(subject, username);
        await ensureAppUser(db, {
          idpSubject: subject,
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          groups,
          technicalAdminBootstrapSubject: armedSubject,
        });
        context = await mapSubjectToAuthContext(subject, db);
        if (!context) {
          // Provisioning failed unexpectedly — deny rather than allow without identity.
          logAuthFailure({
            reason: 'provisioning_failed',
            methodArn: event.methodArn,
            subject,
          });
          const resource = stageWildcardResource(event.methodArn);
          return {
            principalId: subject,
            policyDocument: policy('Deny', resource),
          };
        }
      }
      if (armedSubject === subject && !context.roles.includes('TechnicalAdmin')) {
        // First-admin bootstrap on the candidate's authenticated application
        // request. Access tokens do not reliably carry `cognito:groups`, so
        // ensureAppUser's group check may not elevate; this path is gated
        // solely on the operator-armed exact-subject match. Re-read context
        // so this same request is authorized with the freshly granted role.
        await ensureTechnicalAdminForArmedSubject(db, context.userId);
        context = (await mapSubjectToAuthContext(subject, db)) ?? context;
      }

      return {
        principalId: context.userId,
        policyDocument: policy('Allow', stageWildcardResource(event.methodArn)),
        context: serializeAuthContext(context),
      };
    } catch (error) {
      if (error instanceof Error && error.message === UNAUTHORIZED) {
        throw error;
      }
      // Keep verified-identity infrastructure failures distinct from bad
      // credentials: callers should receive a retryable 5xx, not a misleading
      // 401 that prompts them to repeatedly re-enter valid credentials.
      console.error('Authorizer failed after token present:', error);
      throw error;
    }
  };
}

let cachedDeps: AuthorizerDeps | undefined;

/**
 * Default deps provider for the deployed Lambda: resolves the pooled
 * `@wren/db-node` data-access handle and the Cognito verifier once per execution
 * environment. Both heavy modules are imported dynamically so this file (and the
 * handler factory) stays importable without them present.
 */
async function defaultDepsProvider(): Promise<AuthorizerDeps> {
  if (cachedDeps) return cachedDeps;
  const [{ getDataAccess }, { CognitoTokenVerifier }] = await Promise.all([
    import('@wren/db-node'),
    import('./tokenVerifier.js'),
  ]);
  const db = await getDataAccess();
  const cognitoConfig = resolveCognitoVerifierConfig();
  const verifier = new CognitoTokenVerifier(cognitoConfig);
  const lookupProfile = createCognitoProfileLookup(cognitoConfig.userPoolId);
  cachedDeps = { verifier, db, lookupProfile };
  return cachedDeps;
}

/** The Lambda entry point wired by the CDK `Api` stack. */
export const handler = createAuthorizerHandler(defaultDepsProvider);
