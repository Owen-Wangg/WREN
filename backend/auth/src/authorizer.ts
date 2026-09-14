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
 * armed only by the guided deploy and stripped immediately after. For a
 * genuinely new user it runs inside first-login provisioning (and additionally
 * requires the SystemAdmin group claim). Because the app auto-loads the
 * dashboard on signup — so the intended admin usually already has a Student row
 * before the subject is armed — the same armed-subject gate is also
 * re-evaluated for an already-provisioned user below, elevating in place. No
 * user whose exact subject is not armed can ever escalate.
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

/** Strip an optional `Bearer ` prefix and return the raw JWT (or `undefined`). */
export function extractBearerToken(authorizationToken: string | undefined): string | undefined {
  if (!authorizationToken) return undefined;
  const trimmed = authorizationToken.trim();
  if (trimmed.length === 0) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (match) {
    const token = match[1].trim();
    return token.length > 0 ? token : undefined;
  }
  // A lone "Bearer" keyword carries no token; anything else is a raw token.
  if (/^Bearer$/i.test(trimmed)) return undefined;
  return trimmed;
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
          const resource = stageWildcardResource(event.methodArn);
          return {
            principalId: subject,
            policyDocument: policy('Deny', resource),
          };
        }
      } else if (armedSubject === subject && !context.roles.includes('TechnicalAdmin')) {
        // First-admin bootstrap for an ALREADY-PROVISIONED candidate. The app
        // auto-loads the dashboard right after signup, so the intended admin
        // almost always has an app_user (Student) row before the deploy arms
        // their subject — which makes the ensureAppUser first-login elevation
        // above unreachable for them. Re-evaluate the elevation here, gated
        // SOLELY on the operator-armed exact-subject match (set only by the
        // guided deploy and stripped immediately after verification). This does
        // not trust `cognito:groups`: the access tokens the REST authorizer
        // verifies do not reliably carry that claim, and the armed subject is
        // itself the operator-controlled signal. Re-read the context so this
        // same request is authorized with the freshly granted role.
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
