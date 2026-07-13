/**
 * `<WritingTypesList>` — lists Writing Types for the selected owned Organization
 * (task 19.3; Requirements 34.1, 34.4).
 *
 * Shows each Writing Type's name and accessState (read-only — access-state
 * control is Admin-only per existing design). Includes a "Create Writing Type"
 * form. The list is scoped to the owned org only (Requirement 34.4).
 */
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  createWritingTypeInputSchema,
  type CreateWritingTypeInput,
} from '../orgOwnerTypes';
import { useOrgWritingTypes, useCreateWritingType } from '../useOrgOwner';

import type { HttpClient } from '@/services';

export interface WritingTypesListProps {
  readonly organizationId: string;
  readonly client?: HttpClient;
}

export function WritingTypesList({
  organizationId,
  client,
}: WritingTypesListProps) {
  const writingTypesQuery = useOrgWritingTypes(organizationId, client);
  const createMutation = useCreateWritingType(organizationId, client);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateWritingTypeInput>({
    resolver: zodResolver(createWritingTypeInputSchema),
    defaultValues: { organizationId, name: '', accessState: 'OPEN' },
  });

  const onSubmit = (values: CreateWritingTypeInput) => {
    createMutation.mutate(values, { onSuccess: () => reset() });
  };

  return (
    <section aria-labelledby="writing-types-heading" className="flex flex-col gap-md">
      <h3
        id="writing-types-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Writing Types
      </h3>

      {writingTypesQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading writing types…
        </p>
      )}

      {writingTypesQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load writing types.
        </p>
      )}

      {writingTypesQuery.data && writingTypesQuery.data.length === 0 && (
        <p className="text-bodySmall text-text-secondary">
          No writing types yet. Add the first one below.
        </p>
      )}

      {writingTypesQuery.data && writingTypesQuery.data.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Name
              </th>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Access State
              </th>
            </tr>
          </thead>
          <tbody>
            {writingTypesQuery.data.map((wt) => (
              <tr key={wt.id}>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                  {wt.name}
                </td>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-secondary">
                  {wt.accessState}
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
            htmlFor="new-writing-type-name"
            className="text-caption text-text-secondary"
          >
            New writing type
          </label>
          <input
            id="new-writing-type-name"
            type="text"
            placeholder="Writing type name"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
            {...register('name')}
          />
          {errors.name && (
            <p className="text-caption text-signal-critical">{errors.name.message}</p>
          )}
        </div>
        <input type="hidden" {...register('organizationId')} />
        <input type="hidden" {...register('accessState')} />
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
