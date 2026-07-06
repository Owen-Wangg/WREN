/**
 * `<MetadataFieldsList>` — lists configurable custom metadata fields for the
 * selected owned Organization (task 19.3; Requirement 34.3).
 *
 * Shows each field's label and whether it is required. Includes a "Create
 * Metadata Field" form with label + required toggle.
 */
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  createMetadataFieldInputSchema,
  type CreateMetadataFieldInput,
} from '../orgOwnerTypes';
import { useOrgMetadataFields, useCreateMetadataField } from '../useOrgOwner';

import type { HttpClient } from '@/services';

export interface MetadataFieldsListProps {
  readonly organizationId: string;
  readonly client?: HttpClient;
}

export function MetadataFieldsList({
  organizationId,
  client,
}: MetadataFieldsListProps) {
  const fieldsQuery = useOrgMetadataFields(organizationId, client);
  const createMutation = useCreateMetadataField(organizationId, client);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateMetadataFieldInput>({
    resolver: zodResolver(createMetadataFieldInputSchema),
    defaultValues: { organizationId, label: '', required: false },
  });

  const onSubmit = (values: CreateMetadataFieldInput) => {
    createMutation.mutate(values, { onSuccess: () => reset() });
  };

  return (
    <section aria-labelledby="metadata-fields-heading" className="flex flex-col gap-md">
      <h3
        id="metadata-fields-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Metadata Fields
      </h3>

      {fieldsQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading metadata fields…
        </p>
      )}

      {fieldsQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load metadata fields.
        </p>
      )}

      {fieldsQuery.data && fieldsQuery.data.length === 0 && (
        <p className="text-bodySmall text-text-secondary">
          No metadata fields yet. Add the first one below.
        </p>
      )}

      {fieldsQuery.data && fieldsQuery.data.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Label
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Required
              </th>
            </tr>
          </thead>
          <tbody>
            {fieldsQuery.data.map((field) => (
              <tr key={field.key}>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                  {field.label}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {field.required ? 'Yes' : 'No'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-wrap items-end gap-sm"
      >
        <div className="flex flex-col gap-xs">
          <label
            htmlFor="new-metadata-field-label"
            className="text-caption text-text-secondary"
          >
            Field label
          </label>
          <input
            id="new-metadata-field-label"
            type="text"
            placeholder="Field label"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
            {...register('label')}
          />
          {errors.label && (
            <p className="text-caption text-signal-critical">
              {errors.label.message}
            </p>
          )}
        </div>
        <div className="flex items-center gap-xs">
          <input
            id="new-metadata-field-required"
            type="checkbox"
            className="h-4 w-4 rounded border border-border-strong"
            {...register('required')}
          />
          <label
            htmlFor="new-metadata-field-required"
            className="text-caption text-text-secondary"
          >
            Required
          </label>
        </div>
        <input type="hidden" {...register('organizationId')} />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-text-primary px-md py-xs text-bodySmall font-sans font-medium text-text-on-accent disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>
    </section>
  );
}
