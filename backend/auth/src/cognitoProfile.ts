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
  readonly firstName: string;
  readonly lastName: string;
}

export type CognitoProfileLookup = (idpSubject: string) => Promise<CognitoProfile>;

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

/**
 * Build a Cognito AdminGetUser-backed profile lookup for the authorizer.
 */
export function createCognitoProfileLookup(
  userPoolId: string,
  client: CognitoIdentityProviderClient = new CognitoIdentityProviderClient({}),
): CognitoProfileLookup {
  return async (idpSubject: string): Promise<CognitoProfile> => {
    const response = await client.send(
      new AdminGetUserCommand({
        UserPoolId: userPoolId,
        Username: idpSubject,
      }),
    );

    const attrs = attrMap(response.UserAttributes);
    const email = attrs.email?.trim();
    if (!email) {
      throw new Error(
        `Cognito user ${idpSubject} has no email attribute; cannot provision app_user`,
      );
    }

    return {
      email,
      firstName: attrs.given_name?.trim() || 'User',
      lastName: attrs.family_name?.trim() || 'Account',
    };
  };
}
