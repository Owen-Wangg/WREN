/**
 * Resolve display attributes for a Cognito user after JWT verification.
 * Used only to populate `app_user` on first login — never for authorization.
 */
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

export interface CognitoProfile {
  readonly email: string;
  /**
   * Cognito's `email_verified` attribute. Only a verified email may be used to
   * provision or reclaim an application identity (see `ensureAppUser`).
   */
  readonly emailVerified: boolean;
  readonly firstName: string;
  readonly lastName: string;
}

export type CognitoProfileLookup = (
  idpSubject: string,
  username?: string,
) => Promise<CognitoProfile>;

/**
 * Report whether an IdP subject still resolves to a user in the pool. Used to
 * decide whether an existing `app_user` row is still bound to a live identity
 * before it may be reclaimed. Implementations MUST fail closed: anything other
 * than a definitive "user does not exist" answer is reported as live (or throws).
 */
export type CognitoSubjectLivenessCheck = (idpSubject: string) => Promise<boolean>;

function attrMap(
  attributes: ReadonlyArray<{ Name?: string; Value?: string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of attributes ?? []) {
    if (attr.Name && typeof attr.Value === 'string') {
      out[attr.Name] = attr.Value;
    }
  }
  return out;
}

function isUserNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'UserNotFoundException'
  );
}

/**
 * Build a Cognito AdminGetUser-backed profile lookup for the authorizer.
 */
export function createCognitoProfileLookup(
  userPoolId: string,
  client: CognitoIdentityProviderClient = new CognitoIdentityProviderClient({}),
): CognitoProfileLookup {
  return async (idpSubject: string, username?: string): Promise<CognitoProfile> => {
    const candidates = [...new Set(
      [username, idpSubject].filter((value): value is string => Boolean(value && value.trim())),
    )];

    let lastError: unknown;
    for (const Username of candidates) {
      try {
        const response = await client.send(
          new AdminGetUserCommand({
            UserPoolId: userPoolId,
            Username,
          }),
        );
        const attrs = attrMap(response.UserAttributes);
        const email = attrs.email?.trim();
        if (!email) {
          throw new Error(
            `Cognito user ${Username} has no email attribute; cannot provision app_user`,
          );
        }
        return {
          email,
          // Cognito stores booleans as the strings "true" / "false". Anything
          // other than an exact "true" is treated as unverified (fail closed).
          emailVerified: attrs.email_verified === 'true',
          firstName: attrs.given_name?.trim() || 'User',
          lastName: attrs.family_name?.trim() || 'Account',
        };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Cognito user ${idpSubject} not found for provisioning`);
  };
}

/**
 * Build an AdminGetUser-backed liveness check. The pool signs in with email as
 * the username attribute, so a user's `sub` is accepted as `Username`
 * (the same lookup {@link createCognitoProfileLookup} already relies on).
 *
 * Only `UserNotFoundException` yields `false`. Disabled users are still bound
 * identities and report `true`. Every other error propagates so the caller
 * fails closed rather than treating an outage as "user gone".
 */
export function createCognitoSubjectLivenessCheck(
  userPoolId: string,
  client: CognitoIdentityProviderClient = new CognitoIdentityProviderClient({}),
): CognitoSubjectLivenessCheck {
  return async (idpSubject: string): Promise<boolean> => {
    try {
      await client.send(
        new AdminGetUserCommand({ UserPoolId: userPoolId, Username: idpSubject }),
      );
      // Any user that resolves counts as live, even if it resolved through an
      // alias rather than the `sub`: that is not a definitive "subject gone".
      return true;
    } catch (error) {
      if (isUserNotFound(error)) return false;
      throw error;
    }
  };
}
