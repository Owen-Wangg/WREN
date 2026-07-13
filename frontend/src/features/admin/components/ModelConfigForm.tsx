/**
 * `<ModelConfigForm>` — editable Bedrock model configuration form
 * (task 19.4; Requirement 33.1).
 *
 * Fields: modelId, temperature (0–1), maxOutputTokens. Uses React Hook Form +
 * Zod validation via the shared `modelConfigInputSchema`.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  modelConfigInputSchema,
  type ModelConfigInput,
} from '../adminSchemas';
import { useModelConfig, useSaveModelConfig } from '../useAdmin';

import type { HttpClient } from '@/services';

export interface ModelConfigFormProps {
  readonly client?: HttpClient;
}

export function ModelConfigForm({ client }: ModelConfigFormProps) {
  const configQuery = useModelConfig(client);
  const saveMutation = useSaveModelConfig(client);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ModelConfigInput>({
    resolver: zodResolver(modelConfigInputSchema),
    defaultValues: {
      modelId: '',
      temperature: 0.7,
      maxOutputTokens: 4096,
    },
  });

  // Reset form values when server data loads.
  useEffect(() => {
    if (configQuery.data) {
      reset({
        modelId: configQuery.data.modelId,
        temperature: configQuery.data.temperature,
        maxOutputTokens: configQuery.data.maxOutputTokens,
      });
    }
  }, [configQuery.data, reset]);

  const onSubmit = (values: ModelConfigInput) => {
    saveMutation.mutate(values);
  };

  return (
    <section aria-labelledby="model-config-heading" className="flex flex-col gap-md">
      <h3
        id="model-config-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Model Configuration
      </h3>

      {configQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading model configuration…
        </p>
      )}

      {configQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load model configuration.
        </p>
      )}

      {configQuery.data && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-md"
        >
          <div className="flex flex-col gap-xs">
            <label htmlFor="model-id" className="text-caption text-text-secondary">
              Model ID
            </label>
            <input
              id="model-id"
              type="text"
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
              {...register('modelId')}
            />
            {errors.modelId && (
              <p className="text-caption text-signal-critical">{errors.modelId.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="temperature" className="text-caption text-text-secondary">
              Temperature (0–1)
            </label>
            <input
              id="temperature"
              type="number"
              step="0.01"
              min="0"
              max="1"
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
              {...register('temperature', { valueAsNumber: true })}
            />
            {errors.temperature && (
              <p className="text-caption text-signal-critical">{errors.temperature.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="max-output-tokens" className="text-caption text-text-secondary">
              Max output tokens
            </label>
            <input
              id="max-output-tokens"
              type="number"
              min="1"
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
              {...register('maxOutputTokens', { valueAsNumber: true })}
            />
            {errors.maxOutputTokens && (
              <p className="text-caption text-signal-critical">
                {errors.maxOutputTokens.message}
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
