/**
 * Lambda Authorizer with Database Identity Mapping
 *
 * CRITICAL: This is the point where Cognito JWT is mapped to app identity.
 * 1. Validate JWT signature with Cognito (proves identity)
 * 2. Query DATABASE to load roles (source of truth)
 * 3. Return AuthContext to service
 *
 * Services ALWAYS re-check database. This is coarse enforcement only.
 */
import type { APIGatewayAuthorizerResult } from 'aws-lambda';
import type { AuthContext } from '@wren/types';

interface AuthorizerEvent {
  authorizationToken: string;
  methodArn: string;
}

/**
 * Main handler - validates JWT and maps to app identity
 */
export async function handler(event: AuthorizerEvent): Promise<APIGatewayAuthorizerResult> {
  const token = extractBearerToken(event.authorizationToken);

  if (!token) {
    throw new Error('Unauthorized');
  }

  try {
    // Step 1: Validate JWT with Cognito (proves identity)
    const jwt = await validateJwtWithCognito(token);
    const cognitoSub = jwt.sub;

    // Step 2: Query DATABASE to map Cognito subject → app identity
    const user = await queryUserIdentity(cognitoSub);

    if (!user) {
      // Subject not found in database - reject
      throw new Error('Unauthorized');
    }

    // Step 3: Load roles from DATABASE
    const roles = await queryUserRoles(user.user_id);

    // Step 4: Build AuthContext from DATABASE
    const authContext: AuthContext = {
      userId: user.user_id,
      idpSubject: cognitoSub,
      email: user.email,
      roles: roles.map(r => r.role),
      administeredDepartmentIds: roles
        .filter(r => r.scope_kind === 'department')
        .map(r => r.scope_id!),
      grants: [], // TODO: Load access grants from DB if needed
    };

    // Step 5: Return allow policy with context
    return {
      principalId: user.user_id,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: stageWildcard(event.methodArn),
          },
        ],
      },
      context: serializeAuthContext(authContext),
    };
  } catch (error) {
    console.error('Authorization failed:', error);
    throw new Error('Unauthorized');
  }
}

/**
 * Validate JWT signature with Cognito public key
 * This proves the user is who they claim to be
 */
async function validateJwtWithCognito(token: string) {
  // TODO: Implement JWT validation using Cognito public key
  // See: https://docs.aws.amazon.com/cognito-user-identity-pools/latest/userguide/user-pools-API-operations.html
  // 
  // For now, this is a stub - in production:
  // 1. Fetch Cognito public keys
  // 2. Verify JWT signature
  // 3. Check expiry
  // 4. Validate issuer

  const decoded = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  return decoded;
}

/**
 * Query database: map Cognito subject to user identity
 * CRITICAL: DATABASE is source of truth
 */
async function queryUserIdentity(cognitoSub: string) {
  // TODO: Query database
  // SELECT user_id, email FROM user_identities WHERE cognito_subject = ?

  return {
    user_id: 'user-uuid-placeholder',
    email: 'user@example.com',
  };
}

/**
 * Query database: load all roles for user
 * CRITICAL: DATABASE is source of truth
 */
async function queryUserRoles(
  userId: string,
): Promise<Array<{ role: string; scope_kind: string | null; scope_id: string | null }>> {
  // TODO: Query database
  // SELECT role, scope_kind, scope_id FROM user_roles WHERE user_id = ?

  return [];
}

/**
 * Serialize AuthContext for API Gateway (string values only)
 */
function serializeAuthContext(context: AuthContext): Record<string, string> {
  return {
    userId: context.userId,
    idpSubject: context.idpSubject,
    email: context.email,
    roles: JSON.stringify(context.roles),
    administeredDepartmentIds: JSON.stringify(context.administeredDepartmentIds),
  };
}

function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1] : undefined;
}

function stageWildcard(methodArn: string): string {
  const parts = methodArn.split(':');
  if (parts.length < 6) return methodArn;
  const apiParts = parts[5].split('/');
  if (apiParts.length < 2) return methodArn;
  const [apiId, stage] = apiParts;
  return `${parts.slice(0, 5).join(':')}:${apiId}/${stage}/*`;
}
