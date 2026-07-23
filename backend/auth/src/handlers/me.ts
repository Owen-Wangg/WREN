/**
 * GET /v1/auth/me - Returns current user with roles from DATABASE
 */
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getDataAccess } from '@wren/db-node';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const authContext = parseAuthContext(event);
    const db = await getDataAccess();

    // Query for user by ID
    const userResult = await db.query<{ id: string; email: string; first_name: string; last_name: string }>(
      'SELECT id, email, first_name, last_name FROM app_user WHERE id = $1',
      [authContext.userId],
    );

    if (userResult.length === 0) {
      return {
        statusCode: 401,
        body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'User not found' }),
      };
    }

    const user = userResult[0];

    // Query for all roles assigned to this user
    const roleResult = await db.query<{ role: string; scope_id: string | null }>(
      `SELECT role, scope_id FROM role_assignment WHERE user_id = $1`,
      [authContext.userId],
    );

    // Deduplicate roles and collect department IDs for DepartmentAdmin roles
    const roles = Array.from(new Set(roleResult.map((r) => r.role)));
    const administeredDepartmentIds = roleResult
      .filter((r) => r.role === 'DepartmentAdmin' && r.scope_id)
      .map((r) => r.scope_id as string);

    return {
      statusCode: 200,
      body: JSON.stringify({
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        roles,
        administeredDepartmentIds,
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
