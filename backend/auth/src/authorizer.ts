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
 *   4. Emit an IAM policy plus an authorization context (roles, administered
 *      Departments, grants) that downstream services consume and
 *      RE-CHECK against the specific operation (dual enforcement).
 *
 * The authorizer produces a COARSE, cacheable allow across the API stage; the
 * fine-grained per-operation decision is made inside each service. The IdP is
 * used only to prove identity — no groups/claims/attributes influence the
 * decision (Requirement 37.3).
 *
 * Heavy runtime dependencies (`@wren/db-node`, the Cognito verifier) are loaded
 * lazily by the default deps provider so the module stays cheaply importable and
 * unit-testable with injected fakes.
 */
import type {
  APIGatewayAuthorizerResult,
  APIGatewayTokenAuthorizerEvent,
  PolicyDocument,
} from 'aws-lambda';

import type { AuthContext } from '@wren/types';

import { resolveCognitoVerifierConfig } from './config';
import {
  createCognitoProfileLookup,
  type CognitoProfileLookup,
} from './cognitoProfile';
import { mapSubjectToAuthContext, type QueryExecutor } from './identityMapping';
import { ensureAppUser } from './provisionUser';
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
  ): Promise<APIGatewayAuthorizerResult> => {
    const token = extractBearerToken(event.authorizationToken);
    if (!token) {
      throw new Error(UNAUTHORIZED);
    }

    const { verifier, db, lookupProfile } = await depsProvider();

    let subject: string;
    let groups: readonly string[];
    try {
      const identity = await verifier.verify(token);
      subject = identity.subject;
      groups = identity.groups;
    } catch {
      // Any verification error (signature, issuer, expiry) is a 401.
      throw new Error(UNAUTHORIZED);
    }

    // Authorization is resolved ENTIRELY from the app DB using only the verified
    // subject — never from token claims (Requirement 37.2, 37.3).
    // Exception: `groups` is passed to ensureAppUser ONCE on first login so the
    // SystemAdmin Cognito group can seed TechnicalAdmin. Never consulted again.
    let context = await mapSubjectToAuthContext(subject, db);
    if (!context) {
      const profile = await lookupProfile(subject);
      await ensureAppUser(db, {
        idpSubject: subject,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        groups,
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
    }

    return {
      principalId: context.userId,
      policyDocument: policy('Allow', stageWildcardResource(event.methodArn)),
      context: serializeAuthContext(context),
    };
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
