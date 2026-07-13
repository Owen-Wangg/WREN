/**
 * `<AppSettingsForm>` — editable application-level settings form
 * (task 19.4; Requirement 33.1).
 *
 * Fields: appName, supportEmail, defaultSizeLimitWords.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  appSettingsInputSchema,
  type AppSettingsInput,
} from '../adminSchemas';
import { useAppSettings, useSaveAppSettings } from '../useAdmin';

import type { HttpClient } from '@/services';

export interface AppSettingsFormProps {
  readonly client?: HttpClient;
}

export function AppSettingsForm({ client }: AppSettingsFormProps) {
  const settingsQuery = useAppSettings(client);
  const saveMutation = useSaveAppSettings(client);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<AppSettingsInput>({
    resolver: zodResolver(appSettingsInputSchema),
    defaultValues: {
      appName: '',
      supportEmail: '',
      defaultSizeLimitWords: 5000,
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      reset({
        appName: settingsQuery.data.appName,
        supportEmail: settingsQuery.data.supportEmail,
        defaultSizeLimitWords: settingsQuery.data.defaultSizeLimitWords,
      });
    }
  }, [settingsQuery.data, reset]);

  const onSubmit = (values: AppSettingsInput) => {
    saveMutation.mutate(values);
  };

  return (
    <section aria-labelledby="app-settings-heading" className="flex flex-col gap-md">
      <h3
        id="app-settings-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Application Settings
      </h3>

      {settingsQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading application settings…
        </p>
      )}

      {settingsQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load application settings.
        </p>
      )}

      {settingsQuery.data && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-md"
        >
          <div className="flex flex-col gap-xs">
            <label htmlFor="app-name" className="text-caption text-text-secondary">
              Application name
            </label>
            <input
              id="app-name"
              type="text"
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
              {...register('appName')}
            />
            {errors.appName && (
              <p className="text-caption text-signal-critical">{errors.appName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="support-email" className="text-caption text-text-secondary">
              Support email
            </label>
            <input
              id="support-email"
              type="email"
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
              {...register('supportEmail')}
            />
            {errors.supportEmail && (
              <p className="text-caption text-signal-critical">{errors.supportEmail.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="default-size-limit" className="text-caption text-text-secondary">
              Default size limit (words)
            </label>
            <input
              id="default-size-limit"
              type="number"
              min="1"
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
              {...register('defaultSizeLimitWords', { valueAsNumber: true })}
            />
            {errors.defaultSizeLimitWords && (
              <p className="text-caption text-signal-critical">
                {errors.defaultSizeLimitWords.message}
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
