/**
 * GET /v1/auth/me - Returns current user with roles from DATABASE
 */
import type { APIGatewayProxyHandler } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const authContext = parseAuthContext(event);

    // Query DATABASE for user
    const user = await queryDatabase(
      `SELECT user_id, email FROM user_identities WHERE user_id = $1`,
      [authContext.userId],
    );

    if (!user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'User not found' }),
      };
    }

    // Query DATABASE for roles (CRITICAL: source of truth)
    const roles = await queryDatabase(
      `SELECT DISTINCT role FROM user_roles WHERE user_id = $1`,
      [user.user_id],
    );

    // Query DATABASE for administered departments
    const departments = await queryDatabase(
      `SELECT scope_id FROM user_roles 
       WHERE user_id = $1 AND scope_kind = 'department'`,
      [user.user_id],
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        userId: user.user_id,
        email: user.email,
        roles: roles.map((r) => r.role),
        administeredDepartmentIds: departments.map((d) => d.scope_id),
      }),
    };
  } catch (error) {
    console.error('Error in /v1/auth/me:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    };
  }
};

function parseAuthContext(event: any) {
  const context = event.requestContext?.authorizer;
  if (!context) throw new Error('Missing authorization context');
  return {
    userId: context.userId,
    idpSubject: context.idpSubject,
    email: context.email,
    roles: JSON.parse(context.roles || '[]'),
    administeredDepartmentIds: JSON.parse(context.administeredDepartmentIds || '[]'),
  };
}

async function queryDatabase(query: string, params: any[]): Promise<any[]> {
  // TODO: Replace with actual database client
  return [];
}
