/**
 * Root Jest setup (runs before each test file).
 *
 * Unit tests have no Bedrock Guardrail configured, so opt in to the explicit
 * dev/test bypass for the admin prompt-injection scan (Issue #181). Deployed
 * Lambdas never set this flag; without it an unconfigured guardrail fails
 * closed. Tests that exercise fail-closed behavior delete it locally.
 */
process.env.PROMPT_GUARDRAIL_SKIP = 'true';
