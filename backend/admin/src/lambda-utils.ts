import type { APIGatewayProxyResult } from 'aws-lambda';
import type { AuthContext } from '@wren/types';
import { AuthorizationError, NotFoundError } from './errors';

export function parseAuthContext(event: any): AuthContext {
  const context = event.requestContext?.authorizer;
  if (!context) throw new Error('Missing authorization context');
  return {
    userId: context.userId,
    idpSubject: context.idpSubject,
    email: context.email,
    roles: JSON.parse(context.roles || '[]'),
    administeredDepartmentIds: JSON.parse(context.administeredDepartmentIds || '[]'),
    grants: JSON.parse(context.grants || '[]'),
  };
}

export async function wrapHandler(
  fn: () => Promise<APIGatewayProxyResult>,
): Promise<APIGatewayProxyResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return {
        statusCode: 403,
        body: JSON.stringify({ code: 'PERMISSION_DENIED', message: e.message }),
      };
    }
    if (e instanceof NotFoundError) {
      return {
        statusCode: 404,
        body: JSON.stringify({ code: 'NOT_FOUND', message: e.message }),
      };
    }
    if (e instanceof SyntaxError || (e as any)?.statusCode === 400) {
      return {
        statusCode: 400,
        body: JSON.stringify({ code: 'BAD_REQUEST', message: (e as Error).message }),
      };
    }
    console.error('Unhandled error:', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    };
  }
}
