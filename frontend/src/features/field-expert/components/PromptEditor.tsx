/**
 * `<PromptEditor>` — the convention + prompt editor with the Admin/Field-Expert
 * edit boundary (task 19.2; Requirements 32.2, 32.3, 32.7).
 *
 * The Field Expert edits the inner **domain prompt** layer (instruction text,
 * tone, density, priority) via React Hook Form + Zod (`domainPromptFormSchema`).
 * The Admin-owned **system scaffolding** is shown READ-ONLY and clearly labeled
 * as always taking precedence — that is the edit boundary (Requirement 32.3,
 * 32.7). There is deliberately no field that produces replacement prose
 * (REQ-CORE-NOGHOST-01).
 *
 * As a non-authoritative convenience, the instruction-text field surfaces the
 * client-side ghostwriting hint ({@link containsGhostwritingHint} →
 * {@link GHOSTWRITING_HINT_MESSAGE}) as a NON-blocking warning: the writer can
 * still save. The authoritative save-time guardrail is backend task 12.3.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { domainPromptFormSchema } from '../fieldExpertSchemas';
import {
  GHOSTWRITING_HINT_MESSAGE,
  containsGhostwritingHint,
} from '../ghostwritingHint';

import type {
  DomainPromptFormValues,
  FeedbackDensity,
  PromptConfig,
} from '../fieldExpertSchemas';

const DENSITY_OPTIONS: readonly { value: FeedbackDensity; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'High' },
];

export interface PromptEditorProps {
  readonly promptConfig: PromptConfig;
  readonly onSave: (values: DomainPromptFormValues) => void;
  readonly isSaving?: boolean;
}

export function PromptEditor({
  promptConfig,
  onSave,
  isSaving = false,
}: PromptEditorProps) {
  const { register, handleSubmit, watch } = useForm<DomainPromptFormValues>({
    resolver: zodResolver(domainPromptFormSchema),
    defaultValues: {
      instructionText: promptConfig.domainPrompt.instructionText,
      tone: promptConfig.domainPrompt.tone,
      density: promptConfig.domainPrompt.density,
      priority: promptConfig.domainPrompt.priority,
    },
  });

  const instructionText = watch('instructionText');
  const showGhostwritingHint = containsGhostwritingHint(instructionText);

  const submit = handleSubmit((values) => onSave(values));

  return (
    <section
      aria-labelledby="prompt-editor-heading"
      className="flex flex-col gap-md"
    >
      <h3
        id="prompt-editor-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Prompt &amp; conventions
      </h3>

      <form className="flex flex-col gap-lg" noValidate onSubmit={submit}>
        <div className="flex flex-col gap-xs">
          <label
            htmlFor="prompt-instruction-text"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            Domain instructions
          </label>
          <textarea
            id="prompt-instruction-text"
            rows={5}
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('instructionText')}
          />
          {showGhostwritingHint && (
            <p
              role="status"
              className="rounded-md border border-signal-caution bg-signal-caution-surface px-md py-sm text-bodySmall text-signal-caution"
            >
              {GHOSTWRITING_HINT_MESSAGE}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-xs">
          <label
            htmlFor="prompt-tone"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            Tone
          </label>
          <input
            id="prompt-tone"
            type="text"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('tone')}
          />
        </div>

        <div className="flex flex-col gap-xs">
          <label
            htmlFor="prompt-density"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            Feedback density
          </label>
          <select
            id="prompt-density"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('density')}
          >
            {DENSITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-xs">
          <label
            htmlFor="prompt-priority"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            Priority when the annotation cap binds
          </label>
          <input
            id="prompt-priority"
            type="text"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('priority')}
          />
        </div>

        <button
          type="submit"
          disabled={isSaving}
          className="self-start rounded-md bg-text-primary px-md py-sm text-body font-sans font-medium text-text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : 'Save prompt'}
        </button>
      </form>

      <SystemScaffoldingPanel promptConfig={promptConfig} />
    </section>
  );
}

function SystemScaffoldingPanel({
  promptConfig,
}: {
  readonly promptConfig: PromptConfig;
}) {
  return (
    <div
      aria-labelledby="system-scaffolding-heading"
      className="flex flex-col gap-sm rounded-md border border-border-subtle bg-surface-muted px-md py-md"
    >
      <h4
        id="system-scaffolding-heading"
        className="text-bodySmall font-sans font-semibold text-text-primary"
      >
        System scaffolding (Admin-owned, read-only)
      </h4>
      <p className="text-caption text-text-muted">
        Managed by an Administrator. This outer layer always takes precedence
        over the domain prompt above and cannot be edited here.
      </p>

      <div className="flex flex-col gap-xs">
        <span className="text-caption font-sans font-medium text-text-secondary">
          System instructions
        </span>
        <p className="whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-primary px-md py-sm text-bodySmall text-text-secondary">
          {promptConfig.systemScaffolding.systemInstructions}
        </p>
      </div>

      <div className="flex flex-col gap-xs">
        <span className="text-caption font-sans font-medium text-text-secondary">
          Guardrail
        </span>
        <p className="whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-primary px-md py-sm text-bodySmall text-text-secondary">
          {promptConfig.systemScaffolding.guardrailTemplate}
        </p>
      </div>
    </div>
  );
}
