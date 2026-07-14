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
import * as jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { getDataAccess } from '@wren/db-node';

interface AuthorizerEvent {
  authorizationToken: string;
  methodArn: string;
}

interface CognitoPublicKey {
  kid: string;
  kty: string;
  use: string;
  n: string;
  e: string;
  alg: string;
}

interface CognitoJWKS {
  keys: CognitoPublicKey[];
}

let cachedJWKS: CognitoJWKS | null = null;
let jwksExpiry: number = 0;

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
    const jwtPayload = await validateJwtWithCognito(token);
    const cognitoSub = jwtPayload.sub;

    // Step 2: Query DATABASE to map Cognito subject → app identity
    const user = await queryUserIdentity(cognitoSub);

    if (!user) {
      throw new Error('Unauthorized');
    }

    // Step 3: Load roles from DATABASE
    const roles = await queryUserRoles(user.userId);

    // Step 4: Build AuthContext from DATABASE
    const authContext: AuthContext = {
      userId: user.userId,
      idpSubject: cognitoSub,
      email: user.email,
      roles: roles.map(r => r.role) as ('Student' | 'DepartmentAdmin' | 'TechnicalAdmin')[],
      administeredDepartmentIds: roles
        .filter(r => r.administeredDepartmentId)
        .map(r => r.administeredDepartmentId!),
      grants: [],
    };

    // Step 5: Return allow policy with context
    return {
      principalId: user.userId,
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
 * Fetch Cognito public keys (cached for 1 hour)
 */
async function getCognitoPublicKeys(): Promise<CognitoJWKS> {
  const now = Date.now();

  if (cachedJWKS && jwksExpiry > now) {
    return cachedJWKS;
  }

  const region = process.env.AWS_REGION || 'ca-central-1';
  const userPoolId = process.env.COGNITO_USER_POOL_ID!;
  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;

  try {
    const response = await fetch(jwksUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS: ${response.status}`);
    }
    cachedJWKS = (await response.json()) as CognitoJWKS;
    jwksExpiry = now + 60 * 60 * 1000;
    return cachedJWKS;
  } catch (error) {
    console.error('Failed to fetch Cognito JWKS:', error);
    throw error;
  }
}

/**
 * Convert JWK RSA key to PEM format for verification
 */
function jwkToPem(key: CognitoPublicKey): string {
  const { n, e } = key;
  const modulus = Buffer.from(n, 'base64');
  const exponent = Buffer.from(e, 'base64');

  const modulusHex = modulus.toString('hex');
  const exponentHex = exponent.toString('hex');

  const modulusInt = BigInt(`0x${modulusHex}`);
  const exponentInt = BigInt(`0x${exponentHex}`);

  const pem = `-----BEGIN RSA PUBLIC KEY-----\n${Buffer.from(`${modulusInt.toString(16)}${exponentInt.toString(16)}`, 'hex').toString('base64')}\n-----END RSA PUBLIC KEY-----`;
  return pem;
}

/**
 * Validate JWT signature with Cognito public key
 */
async function validateJwtWithCognito(token: string): Promise<any> {
  try {
    const jwks = await getCognitoPublicKeys();
    const decoded = jwt.decode(token, { complete: true });

    if (!decoded || typeof decoded === 'string') {
      throw new Error('Invalid token format');
    }

    const kid = decoded.header.kid;
    const key = jwks.keys.find(k => k.kid === kid);

    if (!key) {
      throw new Error(`Key ${kid} not found in JWKS`);
    }

    const publicKey = jwkToPem(key);
    const region = process.env.AWS_REGION || 'ca-central-1';
    const userPoolId = process.env.COGNITO_USER_POOL_ID!;

    const verified = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
      issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
      audience: process.env.COGNITO_CLIENT_ID!,
    });

    return verified;
  } catch (error) {
    console.error('JWT verification failed:', error);
    throw new Error('Invalid token');
  }
}

/**
 * Query database: map Cognito subject to user identity
 */
async function queryUserIdentity(cognitoSub: string): Promise<{ userId: string; email: string } | null> {
  try {
    const db = await getDataAccess();
    const query = `
      SELECT id, email FROM user_identities WHERE idp_subject = $1
    `;
    const rows = await db.query(query, [cognitoSub]);

    if (rows.length === 0) {
      return null;
    }

    return {
      userId: String(rows[0].id),
      email: String(rows[0].email),
    };
  } catch (error) {
    console.error('Failed to query user identity:', error);
    throw error;
  }
}

/**
 * Query database: load all roles for user
 */
async function queryUserRoles(
  userId: string,
): Promise<Array<{ role: string; administeredDepartmentId?: string }>> {
  try {
    const db = await getDataAccess();

    const rolesQuery = `
      SELECT DISTINCT role FROM user_roles WHERE user_id = $1
    `;
    const rolesRows = await db.query(rolesQuery, [userId]);

    const deptQuery = `
      SELECT DISTINCT administered_department_id FROM user_roles
      WHERE user_id = $1 AND role = 'DepartmentAdmin'
    `;
    const deptRows = await db.query(deptQuery, [userId]);

    const adminDeptIds = deptRows.map(r => String(r.administered_department_id));
    const roles = rolesRows.map(r => ({ role: String(r.role) }));

    const enrichedRoles = [
      ...roles,
      ...adminDeptIds.map(deptId => ({
        role: 'DepartmentAdmin',
        administeredDepartmentId: deptId,
      })),
    ];

    return enrichedRoles.length > 0 ? enrichedRoles : [{ role: 'User' }];
  } catch (error) {
    console.error('Failed to query user roles:', error);
    throw error;
  }
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
