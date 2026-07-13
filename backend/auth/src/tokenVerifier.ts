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

/** The only authentication fact allowed to cross into authorization. */
export interface VerifiedIdentity {
  /** The verified IdP subject (Cognito `sub`). */
  readonly subject: string;
}

/**
 * Verifies a bearer token and yields the authenticated subject. Implementations
 * MUST reject (throw) on an invalid signature, wrong issuer, or expired token.
 */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

/** Configuration for the Cognito access-token verifier. */
export interface CognitoVerifierConfig {
  readonly userPoolId: string;
  readonly clientId: string;
  /** `access` tokens are used for API authorization by default. */
  readonly tokenUse?: 'access' | 'id';
}

/**
 * Concrete Cognito-backed verifier. `aws-jwt-verify` caches the JWKS internally
 * so warm Lambda invocations reuse fetched keys.
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
    // Throws on bad signature / issuer / expiry. We intentionally read ONLY
    // `sub` from the verified payload and discard every other claim.
    const payload = await this.verifier.verify(token);
    return { subject: payload.sub };
  }
}
