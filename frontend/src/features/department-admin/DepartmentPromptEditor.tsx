/**
 * Department Prompt editor — the Feedback-Engine department prompt
 * (`department.prompt`), split into three labelled sections.
 *
 * Shared by the System Admin department view and the Department Admin
 * dashboard. The backend gates saves with `department.managePrompt`
 * (TechnicalAdmin, or DepartmentAdmin for an administered department) and runs
 * the no-ghostwriting + prompt-injection guardrails before writing.
 */
import { useEffect, useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { Department } from '@wren/types';

import {
  EMPTY_DEPARTMENT_PROMPT_FIELDS as EMPTY_FIELDS,
  parseDepartmentPrompt,
  serializeDepartmentPrompt,
  type DepartmentPromptFields,
} from './departmentPrompt';

/** Extracts a user-facing message from an API error response when available. */
function saveErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'details' in error) {
    const details = (error as { details?: unknown }).details;
    if (details && typeof details === 'object' && 'message' in details) {
      const msg = (details as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
  }
  if (error && typeof error === 'object' && 'status' in error) {
    if ((error as { status?: unknown }).status === 403) {
      return 'You do not have permission to edit the prompt for this department.';
    }
  }
  return 'Error saving prompt — please try again.';
}

interface DepartmentPromptEditorProps {
  departmentId: string;
  /** Stored prompt; `undefined` while loading or when the server withheld it. */
  prompt: string | null | undefined;
  save: (departmentId: string, prompt: string | null) => Promise<Department>;
  onSaved?: (department: Department) => void;
}

export function DepartmentPromptEditor({
  departmentId,
  prompt,
  save,
  onSaved,
}: DepartmentPromptEditorProps) {
  const idPrefix = useId();
  const [fields, setFields] = useState<DepartmentPromptFields>(EMPTY_FIELDS);

  const mutation = useMutation({
    mutationFn: (text: string) => save(departmentId, text || null),
    onSuccess: (department) => onSaved?.(department),
  });
  const { reset: resetMutation } = mutation;

  // Re-sync fields when switching departments or when the stored value changes
  // (including the refetch after a successful save).
  useEffect(() => {
    setFields(parseDepartmentPrompt(prompt ?? ''));
  }, [departmentId, prompt]);

  // Drop stale save status when switching departments.
  useEffect(() => {
    resetMutation();
  }, [departmentId, resetMutation]);

  function updateField(key: keyof DepartmentPromptFields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    mutation.reset();
  }

  const sections: Array<{
    key: keyof DepartmentPromptFields;
    label: string;
    hint: string;
    placeholder: string;
  }> = [
    {
      key: 'context',
      label: 'Department Context',
      hint: 'Who are the writers? What discipline or program does this department serve?',
      placeholder: 'e.g. Law students in the Faculty of Law writing legal memoranda and case briefs',
    },
    {
      key: 'standards',
      label: 'Writing Standards',
      hint: 'Department-specific writing expectations (citation style, register, formatting rules).',
      placeholder:
        'e.g. Canadian Guide to Uniform Legal Citation (McGill Guide). Formal register. IRAC structure for legal analysis.',
    },
    {
      key: 'restricted',
      label: 'Restricted Topics',
      hint: 'What should feedback NOT address? Topics that are out of scope for this department.',
      placeholder:
        'e.g. Do not comment on the merits of legal arguments or provide case law recommendations',
    },
  ];

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Provide department-specific context that applies across all document types.
      </p>

      {sections.map(({ key, label, hint, placeholder }) => {
        const inputId = `${idPrefix}-${key}`;
        const hintId = `${inputId}-hint`;
        return (
          <div key={key}>
            <label htmlFor={inputId} className="block text-sm font-semibold text-gray-900 mb-1">
              {label}
            </label>
            <p id={hintId} className="text-xs text-gray-500 mb-2">
              {hint}
            </p>
            <textarea
              id={inputId}
              aria-describedby={hintId}
              value={fields[key]}
              onChange={(e) => updateField(key, e.target.value)}
              placeholder={placeholder}
              className="w-full h-24 p-3 border border-gray-300 rounded-lg focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 text-sm"
            />
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => mutation.mutate(serializeDepartmentPrompt(fields))}
          disabled={mutation.isPending}
          className="rounded-lg bg-gray-900 px-6 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {mutation.isPending ? 'Saving...' : 'Save Prompt'}
        </button>
        <button
          type="button"
          onClick={() => {
            setFields(EMPTY_FIELDS);
            mutation.reset();
          }}
          disabled={mutation.isPending}
          className="rounded-lg border border-gray-300 px-6 py-2 font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-50"
        >
          Clear All
        </button>
        {mutation.isSuccess && (
          <span role="status" className="text-green-700 font-semibold text-sm">
            Saved successfully!
          </span>
        )}
      </div>
      {mutation.isError && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {saveErrorMessage(mutation.error)}
        </p>
      )}
    </div>
  );
}
