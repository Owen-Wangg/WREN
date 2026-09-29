/**
 * Dedicated operator Lambda for the sync-cognito-admins script.
 *
 * Granting TechnicalAdmin is the most privileged write in the platform, so it
 * lives in its own function instead of behind an unauthenticated `_script`
 * branch in the API-facing Admin Lambda. This function:
 *   - has NO API Gateway (or any other service) invoke permission — only IAM
 *     principals explicitly granted `lambda:InvokeFunction` on it can run it,
 *     and every invoke is attributable via CloudTrail;
 *   - accepts ONLY the exact operator payload `{"_script":"sync-cognito-admins"}`
 *     and refuses anything shaped like an API Gateway / AWS service event;
 *   - logs a structured record of every invocation (accepted or rejected);
 *     each individual grant is additionally audited in activity_event by
 *     {@link syncCognitoAdmins}.
 */
import type { Context } from 'aws-lambda';
import { freezeEventLoopOnReturn } from '@wren/db-node';

import { syncCognitoAdmins } from './scripts/sync-cognito-admins';

const SCRIPT_NAME = 'sync-cognito-admins';

export interface ScriptResponse {
  readonly statusCode: number;
  readonly body: string;
}

/**
 * True only for the exact operator payload. Extra keys (e.g. `requestContext`,
 * `httpMethod`, `Records`, `source`) mean the event came from, or imitates, an
 * AWS service integration rather than a deliberate operator invoke.
 */
export function isOperatorScriptEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null || Array.isArray(event)) return false;
  const keys = Object.keys(event);
  return (
    keys.length === 1 &&
    keys[0] === '_script' &&
    (event as Record<string, unknown>)['_script'] === SCRIPT_NAME
  );
}

export async function handler(event: unknown, context: Context): Promise<ScriptResponse> {
  freezeEventLoopOnReturn(context);

  const invocation = {
    script: SCRIPT_NAME,
    requestId: context.awsRequestId,
    functionArn: context.invokedFunctionArn,
  };

  if (!isOperatorScriptEvent(event)) {
    console.warn(JSON.stringify({ event: 'admin_script_rejected', ...invocation }));
    return {
      statusCode: 400,
      body: JSON.stringify({
        code: 'INVALID_INVOCATION',
        message: `Payload must be exactly {"_script":"${SCRIPT_NAME}"}`,
      }),
    };
  }

  console.log(JSON.stringify({ event: 'admin_script_invoked', ...invocation }));
  const result = await syncCognitoAdmins();
  console.log(
    JSON.stringify({
      event: 'admin_script_completed',
      ...invocation,
      checked: result.checked,
      upserted: result.upserted.length,
      alreadyAdmin: result.alreadyAdmin.length,
      notFound: result.notFound.length,
    }),
  );
  return { statusCode: 200, body: JSON.stringify(result) };
}
