import type { APIGatewayProxyResult } from 'aws-lambda';
import type { AuthContext } from '@wren/types';
import { AuthorizationError, NotFoundError, UsageLimitReachedError } from './errors';

/** CORS headers required on aws_proxy Lambda responses (API Gateway does not add them). */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'Content-Type,Accept,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

export function withCors(result: APIGatewayProxyResult): APIGatewayProxyResult {
  return {
    ...result,
    headers: {
      ...CORS_HEADERS,
      ...(result.headers as Record<string, string> | undefined),
    },
  };
}

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
    return withCors(await fn());
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return withCors({
        statusCode: 403,
        body: JSON.stringify({ code: 'PERMISSION_DENIED', message: e.message }),
      });
    }
    if (e instanceof NotFoundError) {
      return withCors({
        statusCode: 404,
        body: JSON.stringify({ code: 'NOT_FOUND', message: e.message }),
      });
    }
    if (e instanceof UsageLimitReachedError) {
      return withCors({
        statusCode: 429,
        body: JSON.stringify({ code: e.code, message: e.message }),
      });
    }
    if (e instanceof SyntaxError || (e as any)?.statusCode === 400) {
      return withCors({
        statusCode: 400,
        body: JSON.stringify({ code: 'BAD_REQUEST', message: (e as Error).message }),
      });
    }
    // Plain errors thrown with a numeric statusCode (e.g. Object.assign(new Error(...), { statusCode: 404 }))
    const statusCode = typeof (e as any)?.statusCode === 'number' ? (e as any).statusCode : null;
    if (statusCode === 403) {
      return withCors({
        statusCode: 403,
        body: JSON.stringify({ code: 'PERMISSION_DENIED', message: (e as Error).message }),
      });
    }
    if (statusCode === 404) {
      return withCors({
        statusCode: 404,
        body: JSON.stringify({ code: 'NOT_FOUND', message: (e as Error).message }),
      });
    }
    console.error('Unhandled error:', e);
    return withCors({
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    });
  }
}
