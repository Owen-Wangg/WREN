/**
 * JWT verification boundary (Requirement 37.1, 37.5; design "Lambda Authorizer
 * — aws-jwt-verify").
 *
 * The IdP is used SOLELY to prove authentication. This module verifies the
 * token's signature, issuer, and expiry with `aws-jwt-verify` and then returns
 * ONLY the opaque subject — never groups/claims/attributes. That deliberate
 * narrowing is what keeps authorization identity-provider independent
 * (Requirement 37.3): downstream identity mapping cannot even see IdP roles.
 *
 * `TokenVerifier` is an interface so the authorizer can be unit-tested with a
 * fake and so the concrete Cognito verifier can be swapped for another provider
 * with no change to authorization logic (Requirement 37.4).
 */
import { CognitoJwtVerifier } from 'aws-jwt-verify';

/** The only authentication facts allowed to cross into authorization. */
export interface VerifiedIdentity {
  /** The verified IdP subject (Cognito `sub`). */
  readonly subject: string;
  /**
   * Cognito group names from the `cognito:groups` claim. Consumed ONLY during
   * first-login provisioning to bootstrap roles — never used on subsequent
   * requests (the DB is the source of truth after provisioning).
   */
  readonly groups: readonly string[];
  /**
   * Cognito `username` claim. Used only for AdminGetUser on first login
   * (email-as-username pools reject AdminGetUser by `sub`). Not an authz input.
   */
  readonly username?: string;
}

/**
 * Verifies a bearer token and yields the authenticated subject. Implementations
 * MUST reject (throw) on an invalid signature, wrong issuer, or expired token.
 */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

/** Configuration for the Cognito token verifier. */
export interface CognitoVerifierConfig {
  readonly userPoolId: string;
  readonly clientId: string;
  /**
   * The ONE token use this verifier accepts. Defaults to `access`, which is
   * what the REST API authorizer requires. Only the AppSync authorizer sets
   * `id` (AppSync realtime clients send the ID token).
   */
  readonly tokenUse?: 'access' | 'id';
}

/**
 * Concrete Cognito-backed verifier pinned to a single `token_use`.
 *
 * There is deliberately NO fallback to the other token use: an ID token is
 * issued for the client app and is routinely handed to front-end code or
 * third parties, so it must not double as a REST API credential (and vice
 * versa for AppSync). A token whose `token_use` does not match is rejected.
 * See https://github.com/awslabs/aws-jwt-verify#verifying-jwts-from-amazon-cognito
 *
 * `aws-jwt-verify` caches the JWKS internally so warm Lambda invocations reuse
 * fetched keys.
 */
export class CognitoTokenVerifier implements TokenVerifier {
  private readonly verifier: ReturnType<typeof CognitoJwtVerifier.create>;

  public constructor(config: CognitoVerifierConfig) {
    this.verifier = CognitoJwtVerifier.create({
      userPoolId: config.userPoolId,
      tokenUse: config.tokenUse ?? 'access',
      clientId: config.clientId,
    });
  }

  public async verify(token: string): Promise<VerifiedIdentity> {
    return this.fromPayload(await this.verifier.verify(token));
  }

  private fromPayload(payload: { sub?: string; username?: unknown; [key: string]: unknown }): VerifiedIdentity {
    const groups = Array.isArray(payload['cognito:groups'])
      ? (payload['cognito:groups'] as string[])
      : [];
    const username = typeof payload.username === 'string' && payload.username.trim().length > 0
      ? payload.username.trim()
      : undefined;
    return { subject: payload.sub as string, groups, username };
  }
}
