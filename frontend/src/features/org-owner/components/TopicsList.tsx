/**
 * `<TopicsList>` — lists business Topics for the selected owned Organization
 * (task 19.3; Requirement 35).
 *
 * Topics are organizational metadata only — they never drive error taxonomy,
 * reference-material selection, or feedback generation (REQ-TOPIC-01).
 * Includes a "Create Topic" form.
 */
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import {
  createTopicInputSchema,
  type CreateTopicInput,
} from '../orgOwnerTypes';
import { useOrgTopics, useCreateTopic } from '../useOrgOwner';

import type { HttpClient } from '@/services';

export interface TopicsListProps {
  readonly organizationId: string;
  readonly client?: HttpClient;
}

export function TopicsList({ organizationId, client }: TopicsListProps) {
  const topicsQuery = useOrgTopics(organizationId, client);
  const createMutation = useCreateTopic(organizationId, client);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTopicInput>({
    resolver: zodResolver(createTopicInputSchema),
    defaultValues: { organizationId, name: '' },
  });

  const onSubmit = (values: CreateTopicInput) => {
    createMutation.mutate(values, { onSuccess: () => reset() });
  };

  return (
    <section aria-labelledby="topics-heading" className="flex flex-col gap-md">
      <h3
        id="topics-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Topics
      </h3>

      {topicsQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading topics…
        </p>
      )}

      {topicsQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load topics.
        </p>
      )}

      {topicsQuery.data && topicsQuery.data.length === 0 && (
        <p className="text-bodySmall text-text-secondary">
          No topics yet. Add the first one below.
        </p>
      )}

      {topicsQuery.data && topicsQuery.data.length > 0 && (
        <ul className="flex flex-col gap-xs">
          {topicsQuery.data.map((topic) => (
            <li
              key={topic.id}
              className="rounded-md border border-border-subtle bg-surface-primary px-md py-sm text-bodySmall text-text-primary"
            >
              {topic.name}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-wrap items-end gap-sm"
      >
        <div className="flex flex-col gap-xs">
          <label htmlFor="new-topic-name" className="text-caption text-text-secondary">
            New topic
          </label>
          <input
            id="new-topic-name"
            type="text"
            placeholder="Topic name"
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
