/**
 * `<ContentTypesList>` — lists Content Types for the selected owned Organization
 * (task 19.3; Requirement 34.3).
 *
 * Each Content Type is scoped to a Writing Type within the org. Includes a
 * "Create Content Type" form with a Writing Type selector sourced from the org's
 * own types only (Requirement 34.4).
 */
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  createContentTypeInputSchema,
  type CreateContentTypeInput,
} from '../orgOwnerTypes';
import {
  useOrgContentTypes,
  useOrgWritingTypes,
  useCreateContentType,
} from '../useOrgOwner';

import type { HttpClient } from '@/services';

export interface ContentTypesListProps {
  readonly organizationId: string;
  readonly client?: HttpClient;
}

export function ContentTypesList({
  organizationId,
  client,
}: ContentTypesListProps) {
  const contentTypesQuery = useOrgContentTypes(organizationId, client);
  const writingTypesQuery = useOrgWritingTypes(organizationId, client);
  const createMutation = useCreateContentType(organizationId, client);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateContentTypeInput>({
    resolver: zodResolver(createContentTypeInputSchema),
    defaultValues: { organizationId, writingTypeId: '', name: '' },
  });

  const onSubmit = (values: CreateContentTypeInput) => {
    createMutation.mutate(values, { onSuccess: () => reset() });
  };

  return (
    <section aria-labelledby="content-types-heading" className="flex flex-col gap-md">
      <h3
        id="content-types-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Content Types
      </h3>

      {contentTypesQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading content types…
        </p>
      )}

      {contentTypesQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load content types.
        </p>
      )}

      {contentTypesQuery.data && contentTypesQuery.data.length === 0 && (
        <p className="text-bodySmall text-text-secondary">
          No content types yet. Add the first one below.
        </p>
      )}

      {contentTypesQuery.data && contentTypesQuery.data.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
              >
                Name
              </th>
            </tr>
          </thead>
          <tbody>
            {contentTypesQuery.data.map((ct) => (
              <tr key={ct.id}>
                <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                  {ct.name}
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
            htmlFor="new-content-type-writing-type"
            className="text-caption text-text-secondary"
          >
            Writing type
          </label>
          <select
            id="new-content-type-writing-type"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
            {...register('writingTypeId')}
          >
            <option value="">Select…</option>
            {(writingTypesQuery.data ?? []).map((wt) => (
              <option key={wt.id} value={wt.id}>
                {wt.name}
              </option>
            ))}
          </select>
          {errors.writingTypeId && (
            <p className="text-caption text-signal-critical">
              {errors.writingTypeId.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-xs">
          <label
            htmlFor="new-content-type-name"
            className="text-caption text-text-secondary"
          >
            Content type name
          </label>
          <input
            id="new-content-type-name"
            type="text"
            placeholder="Content type name"
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
            {...register('name')}
          />
          {errors.name && (
            <p className="text-caption text-signal-critical">{errors.name.message}</p>
          )}
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
