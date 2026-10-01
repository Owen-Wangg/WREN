import type { APIGatewayProxyResult } from 'aws-lambda';
import type { AuthContext } from '@wren/types';
import { bindCorsOrigin, withCorsHeaders } from '@wren/auth';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  PromptGuardrailUnavailableError,
  PromptInjectionError,
  UsageLimitReachedError,
} from './errors';
import { PromptGuardrailError } from './promptGuardrail';

/** CORS headers required on aws_proxy Lambda responses (API Gateway does not add them). */
export const withCors = withCorsHeaders;
export { bindCorsOrigin };

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseAuthContext(event: any): AuthContext {
  const context = event.requestContext?.authorizer;
  if (!context) throw new Error('Missing authorization context');
  return {
    userId: context.userId,
    idpSubject: context.idpSubject,
    email: context.email,
    roles: parseJsonArray(context.roles) as AuthContext['roles'],
    administeredDepartmentIds: parseJsonArray(context.administeredDepartmentIds) as AuthContext['administeredDepartmentIds'],
    grants: parseJsonArray(context.grants) as AuthContext['grants'],
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
    if (e instanceof ConflictError) {
      return withCors({
        statusCode: 409,
        body: JSON.stringify({ code: e.code, message: e.message }),
      });
    }
    if (e instanceof UsageLimitReachedError) {
      return withCors({
        statusCode: 429,
        body: JSON.stringify({ code: e.code, message: e.message }),
      });
    }
    if (e instanceof PromptInjectionError) {
      return withCors({
        statusCode: 400,
        body: JSON.stringify({ code: e.code, message: e.message }),
      });
    }
    if (e instanceof PromptGuardrailUnavailableError) {
      // Fail closed (Issue #181): generic message; config detail stays in logs.
      return withCors({
        statusCode: 503,
        body: JSON.stringify({
          code: e.code,
          message: 'Prompt safety screening is unavailable. Please contact an administrator.',
        }),
      });
    }
    if (e instanceof PromptGuardrailError) {
      return withCors({
        statusCode: 400,
        body: JSON.stringify({ code: 'GHOSTWRITING_DETECTED', message: e.message }),
      });
    }
    if (e instanceof SyntaxError || (e as any)?.statusCode === 400) {
      return withCors({
        statusCode: 400,
        body: JSON.stringify({ code: 'BAD_REQUEST', message: (e as Error).message }),
      });
    }
    // Plain errors thrown with a numeric statusCode (e.g. Object.assign(new Error(...), { statusCode: 409 }))
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
    if (statusCode === 409) {
      return withCors({
        statusCode: 409,
        body: JSON.stringify({ code: 'CONFLICT', message: (e as Error).message }),
      });
    }
    console.error('Unhandled error:', e);
    return withCors({
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR', message: 'Internal server error' }),
    });
  }
}
