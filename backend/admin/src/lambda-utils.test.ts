/**
 * wrapHandler error mapping for the fail-closed prompt guardrail (Issue #181).
 */
import { PromptGuardrailUnavailableError } from './errors';
import { wrapHandler } from './lambda-utils';

describe('wrapHandler', () => {
  it('maps PromptGuardrailUnavailableError to 503 with a generic message', async () => {
    const res = await wrapHandler(async () => {
      throw new PromptGuardrailUnavailableError('PROMPT_GUARDRAIL_ID unset');
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body) as { code: string; message: string };
    expect(body.code).toBe('PROMPT_GUARDRAIL_UNCONFIGURED');
    expect(body.message).not.toContain('PROMPT_GUARDRAIL_ID');
  });
});
