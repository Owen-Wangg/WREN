/**
 * No-Ghostwriting Compliance API - Task 10
 *
 * Prompt editor guardrail validation
 * Feedback response validation (no replacement prose)
 * Guardrail violation audit events
 */
import { z } from 'zod';
import type { HttpClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Prompt Validation (Task 10.3) */
/* -------------------------------------------------------------------------- */

const ghostwritingPatternsSchema = z.object({
  violations: z.array(
    z.object({
      pattern: z.string(),
      instruction: z.string(),
      location: z.string(),
    }),
  ),
  isCompliant: z.boolean(),
});

/**
 * Validate prompt for ghostwriting instructions.
 * Task 10.3, REQ-PROMPT-EDIT-01.5
 *
 * Rejects:
 * - "suggest revision", "rewrite", "justify improvement"
 * - "generate alternative", "compose", "write"
 * - Any instruction to produce replacement student work
 */
export async function validatePromptCompliance(
  client: HttpClient,
  promptText: string,
): Promise<{
  violations: Array<{
    pattern: string;
    instruction: string;
    location: string;
  }>;
  isCompliant: boolean;
}> {
  return client.request('/v1/compliance/validate-prompt', {
    method: 'POST',
    body: { promptText },
    schema: ghostwritingPatternsSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Feedback Response Validation (Task 10.2) */
/* -------------------------------------------------------------------------- */

const feedbackComplianceSchema = z.object({
  hasProse: z.boolean(),
  hasApplyAffordance: z.boolean(),
  isCompliant: z.boolean(),
  violations: z.array(z.string()).optional(),
});

/**
 * Validate feedback items response for compliance.
 * Task 10.2, REQ-CORE-NOGHOST-01.2
 *
 * Ensures:
 * - No replacementProse field
 * - Only {category, question, anchor?, citation?}
 * - No "Apply", "Accept", "Insert", "Use this" affordances
 */
export async function validateFeedbackCompliance(
  client: HttpClient,
  feedbackItems: unknown[],
): Promise<{
  hasProse: boolean;
  hasApplyAffordance: boolean;
  isCompliant: boolean;
  violations?: string[];
}> {
  return client.request('/v1/compliance/validate-feedback', {
    method: 'POST',
    body: { feedbackItems },
    schema: feedbackComplianceSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Guardrail Violation Reporting (Task 10.1, 10.3) */
/* -------------------------------------------------------------------------- */

/**
 * Report a guardrail violation to audit system.
 * Task 10.1, REQ-CORE-NOGHOST-01.5
 * Task 10.3, REQ-PROMPT-EDIT-01.6
 */
export async function reportGuardrailViolation(
  client: HttpClient,
  input: {
    violationType: 'prompt_violation' | 'feedback_violation';
    context: string;
    violations: string[];
    severity: 'warning' | 'error';
  },
): Promise<{ auditEventId: string; logged: boolean }> {
  return client.request('/v1/compliance/report-violation', {
    method: 'POST',
    body: input,
    schema: z.object({
      auditEventId: z.string(),
      logged: z.boolean(),
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* Default Prompt Templates (Task 10.4) */
/* -------------------------------------------------------------------------- */

/**
 * Fetch default compliant prompt template for a document type.
 * Task 10.4, REQ-CORE-NOGHOST-01.7
 *
 * Returns Socratic-only prompts with NO "suggest revision", "rewrite", etc.
 */
export async function getDefaultPromptTemplate(
  client: HttpClient,
  documentTypeId: string,
): Promise<{
  promptText: string;
  description: string;
  isCompliant: boolean;
}> {
  return client.request(
    `/v1/compliance/default-prompts/${documentTypeId}`,
    {
      schema: z.object({
        promptText: z.string(),
        description: z.string(),
        isCompliant: z.boolean(),
      }),
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Compliance Report (Task 10 - Verification) */
/* -------------------------------------------------------------------------- */

/**
 * Generate compliance verification report.
 * Checks:
 * - All FeedbackItems lack replacementProse
 * - All prompts are Socratic-only
 * - No apply/accept affordances in UI
 */
export async function getComplianceReport(
  client: HttpClient,
): Promise<{
  feedbackItems: {
    compliant: number;
    violations: number;
  };
  prompts: {
    compliant: number;
    violations: number;
  };
  uiAffordances: {
    compliant: boolean;
  };
  overallCompliant: boolean;
}> {
  return client.request('/v1/compliance/report', {
    schema: z.object({
      feedbackItems: z.object({
        compliant: z.number(),
        violations: z.number(),
      }),
      prompts: z.object({
        compliant: z.number(),
        violations: z.number(),
      }),
      uiAffordances: z.object({
        compliant: z.boolean(),
      }),
      overallCompliant: z.boolean(),
    }),
  });
}
