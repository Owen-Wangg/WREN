/**
 * `<FieldExpertConsole>` — the connected top-level Field Expert configuration
 * surface (task 19.2; Requirements 23.4, 24.1, 32.2, 40.1).
 *
 * Composes the five sub-surfaces — Active-Writing-Type selection, taxonomy
 * editor, prompt/convention editor with the edit boundary, domain-scoped
 * reference manager, and the all-users aggregate analytics view — and drives
 * them from the `useFieldExpert` React Query hooks. The active Writing Type id
 * is local state (defaulting to the first assigned type once loaded) and scopes
 * every per-type query and mutation (Requirement 23.4).
 *
 * Every hook accepts an optional {@link HttpClient} so a test can inject a
 * `MockApiClient` with task-specific fixtures via the `client` prop, mirroring
 * `<WriterDashboard>`. This module builds the feature surface only; it is not
 * wired into `App.tsx` routing (that is convergence work).
 */
import { useEffect, useState } from 'react';

import { ActiveWritingTypeSelector } from './ActiveWritingTypeSelector';
import { AggregateAnalyticsView } from './AggregateAnalyticsView';
import { PromptEditor } from './PromptEditor';
import { ReferenceManager } from './ReferenceManager';
import { TaxonomyEditor } from './TaxonomyEditor';

import {
  useAddCategory,
  useAddReferenceMaterial,
  useAggregateAnalytics,
  useFieldExpertWritingTypes,
  usePromptConfig,
  useReferenceMaterials,
  useRemoveCategory,
  useRemoveReferenceMaterial,
  useRenameCategory,
  useSaveDomainPrompt,
  useTaxonomy,
} from '../useFieldExpert';

import { AiDisclaimerNotice } from '@/components/ui';
import { apiClient, type HttpClient } from '@/services';

export interface FieldExpertConsoleProps {
  /** Injectable HTTP client (defaults to the shared app client). */
  readonly client?: HttpClient;
}

export function FieldExpertConsole({
  client = apiClient,
}: FieldExpertConsoleProps) {
  const [activeWritingTypeId, setActiveWritingTypeId] = useState<
    string | undefined
  >(undefined);

  const writingTypesQuery = useFieldExpertWritingTypes(client);
  const writingTypes = writingTypesQuery.data ?? [];

  // Default the active type to the first assigned one once the list loads.
  const firstWritingTypeId = writingTypesQuery.data?.[0]?.id;
  useEffect(() => {
    if (activeWritingTypeId === undefined && firstWritingTypeId !== undefined) {
      setActiveWritingTypeId(firstWritingTypeId);
    }
  }, [activeWritingTypeId, firstWritingTypeId]);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <h2 className="text-heading2 font-sans font-semibold text-text-primary">
          Writing type configuration
        </h2>
        <AiDisclaimerNotice />
      </header>

      {writingTypesQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading your writing types…
        </p>
      )}

      {writingTypesQuery.isError && (
        <div role="alert" className="flex flex-col gap-sm">
          <p className="text-bodySmall text-signal-critical">
            Something went wrong loading your writing types.
          </p>
          <button
            type="button"
            onClick={() => writingTypesQuery.refetch()}
            className="self-start rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
          >
            Retry
          </button>
        </div>
      )}

      {!writingTypesQuery.isLoading && !writingTypesQuery.isError && (
        <>
          <ActiveWritingTypeSelector
            writingTypes={writingTypes}
            activeWritingTypeId={activeWritingTypeId}
            onChange={setActiveWritingTypeId}
          />

          {activeWritingTypeId && (
            <ActiveWritingTypePanels
              key={activeWritingTypeId}
              writingTypeId={activeWritingTypeId}
              client={client}
            />
          )}
        </>
      )}
    </div>
  );
}

interface ActiveWritingTypePanelsProps {
  readonly writingTypeId: string;
  readonly client: HttpClient;
}

/**
 * The per-Writing-Type configuration panels. Split into its own component (and
 * remounted via `key={writingTypeId}` from the parent) so the per-type hooks
 * are keyed cleanly to the active type — selecting a different type scopes the
 * whole panel set (Requirement 23.4).
 */
function ActiveWritingTypePanels({
  writingTypeId,
  client,
}: ActiveWritingTypePanelsProps) {
  const taxonomyQuery = useTaxonomy(writingTypeId, client);
  const promptConfigQuery = usePromptConfig(writingTypeId, client);
  const referencesQuery = useReferenceMaterials(writingTypeId, client);
  const analyticsQuery = useAggregateAnalytics(writingTypeId, client);

  const addCategory = useAddCategory(writingTypeId, client);
  const renameCategory = useRenameCategory(writingTypeId, client);
  const removeCategory = useRemoveCategory(writingTypeId, client);
  const saveDomainPrompt = useSaveDomainPrompt(writingTypeId, client);
  const addReference = useAddReferenceMaterial(writingTypeId, client);
  const removeReference = useRemoveReferenceMaterial(writingTypeId, client);

  return (
    <div className="flex flex-col gap-2xl">
      {/* Taxonomy */}
      {taxonomyQuery.isLoading ? (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading taxonomy…
        </p>
      ) : taxonomyQuery.isError ? (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Something went wrong loading the taxonomy.
        </p>
      ) : (
        <TaxonomyEditor
          categories={taxonomyQuery.data ?? []}
          onAdd={(values) => addCategory.mutate(values)}
          onRename={(categoryId, values) =>
            renameCategory.mutate({ categoryId, values })
          }
          onRemove={(categoryId) => removeCategory.mutate(categoryId)}
          isAdding={addCategory.isPending}
        />
      )}

      {/* Prompt + conventions */}
      {promptConfigQuery.isLoading ? (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading prompt configuration…
        </p>
      ) : promptConfigQuery.isError ? (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Something went wrong loading the prompt configuration.
        </p>
      ) : promptConfigQuery.data ? (
        <PromptEditor
          promptConfig={promptConfigQuery.data}
          onSave={(values) => saveDomainPrompt.mutate(values)}
          isSaving={saveDomainPrompt.isPending}
        />
      ) : null}

      {/* Reference materials */}
      <ReferenceManager
        references={referencesQuery.data ?? []}
        onAdd={(values) => addReference.mutate(values)}
        onRemove={(referenceId) => removeReference.mutate(referenceId)}
        isLoading={referencesQuery.isLoading}
        isError={referencesQuery.isError}
        onRetry={() => referencesQuery.refetch()}
        isAdding={addReference.isPending}
      />

      {/* Aggregate analytics */}
      {analyticsQuery.isLoading ? (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading aggregate analytics…
        </p>
      ) : analyticsQuery.isError ? (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Something went wrong loading aggregate analytics.
        </p>
      ) : analyticsQuery.data ? (
        <AggregateAnalyticsView analytics={analyticsQuery.data} />
      ) : null}
    </div>
  );
}
