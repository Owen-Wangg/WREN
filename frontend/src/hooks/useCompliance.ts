/**
 * React Query hooks for no-ghostwriting compliance (Task 10)
 *
 * Prompt validation, feedback validation, guardrail violation reporting
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  validatePromptCompliance,
  validateFeedbackCompliance,
  reportGuardrailViolation,
  getDefaultPromptTemplate,
  getComplianceReport,
} from '@/services/api/complianceApi';
import { useApiClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Prompt Validation (Task 10.3) */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: validate prompt for ghostwriting instructions.
 * Task 10.3, REQ-PROMPT-EDIT-01.5
 *
 * Returns violations if found, isCompliant flag.
 * Used at save-time in prompt editor.
 */
export function useValidatePromptCompliance() {
  const client = useApiClient();

  return useMutation({
    mutationFn: (promptText: string) =>
      validatePromptCompliance(client, promptText),
  });
}

/* -------------------------------------------------------------------------- */
/* Feedback Validation (Task 10.2) */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: validate feedback items for compliance.
 * Task 10.2, REQ-CORE-NOGHOST-01.2
 *
 * Ensures no replacementProse, no apply affordances.
 * Returns violations if found.
 */
export function useValidateFeedbackCompliance() {
  const client = useApiClient();

  return useMutation({
    mutationFn: (feedbackItems: unknown[]) =>
      validateFeedbackCompliance(client, feedbackItems),
  });
}

/* -------------------------------------------------------------------------- */
/* Guardrail Violation Reporting (Task 10.1, 10.3) */
/* -------------------------------------------------------------------------- */

/**
 * Mutation hook: report guardrail violation to audit system.
 * Task 10.1, REQ-CORE-NOGHOST-01.5
 * Task 10.3, REQ-PROMPT-EDIT-01.6
 *
 * Logs violation with context and severity.
 */
export function useReportGuardrailViolation() {
  const client = useApiClient();

  return useMutation({
    mutationFn: (input: {
      violationType: 'prompt_violation' | 'feedback_violation';
      context: string;
      violations: string[];
      severity: 'warning' | 'error';
    }) => reportGuardrailViolation(client, input),
  });
}

/* -------------------------------------------------------------------------- */
/* Default Prompt Templates (Task 10.4) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: fetch default compliant prompt for document type.
 * Task 10.4, REQ-CORE-NOGHOST-01.7
 *
 * Returns Socratic-only template, verified compliant.
 */
export function useGetDefaultPromptTemplate(documentTypeId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['compliance', 'default-prompt', documentTypeId],
    queryFn: () => getDefaultPromptTemplate(client, documentTypeId),
    enabled: !!documentTypeId,
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

/* -------------------------------------------------------------------------- */
/* Compliance Verification Report (Task 10) */
/* -------------------------------------------------------------------------- */

/**
 * Query hook: get system-wide compliance verification report.
 * Checks:
 * - All FeedbackItems lack replacementProse
 * - All prompts are Socratic-only
 * - No apply/accept affordances in UI
 */
export function useGetComplianceReport() {
  const client = useApiClient();

  return useQuery({
    queryKey: ['compliance', 'report'],
    queryFn: () => getComplianceReport(client),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/* -------------------------------------------------------------------------- */
/* Compliance Validation Helper (Frontend) */
/* -------------------------------------------------------------------------- */

/**
 * Frontend guardrail patterns (mirrored on backend).
 * Used for client-side validation feedback.
 */
export const GHOSTWRITING_PATTERNS = [
  {
    pattern: /suggest\s+(revision|edit|alternative|version)/i,
    instruction: '"suggest revision/edit/alternative/version"',
  },
  {
    pattern: /rewrite/i,
    instruction: '"rewrite"',
  },
  {
    pattern: /justify\s+improvement/i,
    instruction: '"justify improvement"',
  },
  {
    pattern: /generate\s+(alternative|version|draft)/i,
    instruction: '"generate alternative/version/draft"',
  },
  {
    pattern: /compose|write\s+(a\s+)?(new|different|better)/i,
    instruction: '"compose" or "write" (replacement content)',
  },
  {
    pattern: /provide\s+(replacement|revised)\s+(text|prose|passage)/i,
    instruction: '"provide replacement/revised text"',
  },
];

/**
 * Client-side prompt validation helper.
 * Returns violations for immediate user feedback.
 */
export function validatePromptClientSide(promptText: string): {
  violations: Array<{ pattern: string; instruction: string }>;
  isCompliant: boolean;
} {
  const violations: Array<{ pattern: string; instruction: string }> = [];

  for (const { pattern, instruction } of GHOSTWRITING_PATTERNS) {
    if (pattern.test(promptText)) {
      violations.push({ pattern: pattern.source, instruction });
    }
  }

  return {
    violations,
    isCompliant: violations.length === 0,
  };
}
