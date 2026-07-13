/**
 * `<SystemPromptForm>` — editable system prompt / guardrail configuration form
 * (task 19.4; Requirement 33.1).
 *
 * Fields: systemScaffold (textarea), guardrailInstructions (textarea). These
 * compose the authoritative outer layer that always takes precedence over
 * Field-Expert Writing-Type prompts.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  systemPromptConfigInputSchema,
  type SystemPromptConfigInput,
} from '../adminSchemas';
import { useSystemPromptConfig, useSaveSystemPromptConfig } from '../useAdmin';

import type { HttpClient } from '@/services';

export interface SystemPromptFormProps {
  readonly client?: HttpClient;
}

export function SystemPromptForm({ client }: SystemPromptFormProps) {
  const configQuery = useSystemPromptConfig(client);
  const saveMutation = useSaveSystemPromptConfig(client);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<SystemPromptConfigInput>({
    resolver: zodResolver(systemPromptConfigInputSchema),
    defaultValues: {
      systemScaffold: '',
      guardrailInstructions: '',
    },
  });

  useEffect(() => {
    if (configQuery.data) {
      reset({
        systemScaffold: configQuery.data.systemScaffold,
        guardrailInstructions: configQuery.data.guardrailInstructions,
      });
    }
  }, [configQuery.data, reset]);

  const onSubmit = (values: SystemPromptConfigInput) => {
    saveMutation.mutate(values);
  };

  return (
    <section aria-labelledby="system-prompt-heading" className="flex flex-col gap-md">
      <h3
        id="system-prompt-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        System Prompt / Guardrails
      </h3>

      {configQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading system prompt configuration…
        </p>
      )}

      {configQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load system prompt configuration.
        </p>
      )}

      {configQuery.data && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-md"
        >
          <div className="flex flex-col gap-xs">
            <label htmlFor="system-scaffold" className="text-caption text-text-secondary">
              System scaffold
            </label>
            <textarea
              id="system-scaffold"
              rows={6}
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
              {...register('systemScaffold')}
            />
            {errors.systemScaffold && (
              <p className="text-caption text-signal-critical">
                {errors.systemScaffold.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="guardrail-instructions" className="text-caption text-text-secondary">
              Guardrail instructions
            </label>
            <textarea
              id="guardrail-instructions"
              rows={4}
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
              {...register('guardrailInstructions')}
            />
            {errors.guardrailInstructions && (
              <p className="text-caption text-signal-critical">
                {errors.guardrailInstructions.message}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={saveMutation.isPending || !isDirty}
            className="self-start rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </form>
      )}
    </section>
  );
}
