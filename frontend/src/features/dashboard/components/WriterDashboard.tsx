/**
 * `<WriterDashboard>` — the connected writer dashboard (task 19.1; frontend
 * steering §4; Requirements 4.2, 6.8).
 *
 * Displays the "My Documents" surface (search + status filter over
 * {@link WritingEnvironmentCard}s). Server state comes from the `useDashboard`
 * React Query hooks; each accepts an optional {@link HttpClient} so a test can
 * inject a `MockApiClient` with different fixtures without touching global state.
 *
 * The shared `<AiDisclaimerNotice>` is always rendered (steering §3/§4: the
 * dashboard surfaces the disclaimer, notably on the empty state) — never
 * copy-pasted inline (steering §11).
 *
 * This module builds the feature surface only; it is deliberately NOT wired
 * into `App.tsx` routing (that is convergence work). `onOpenDocument` is an
 * optional seam a router/page can supply later.
 */
import { useState } from 'react';

import { StatusFilter } from './StatusFilter';
import { WritingEnvironmentCard } from './WritingEnvironmentCard';
import { WritingEnvironmentSearch } from './WritingEnvironmentSearch';
import { WritingTypeSelector } from './WritingTypeSelector';

import {
  ALL_STATUSES,
  filterDocuments,
  type StatusFilterValue,
} from '../documentFilters';
import {
  useDocuments,
  useWritingTypes,
  useOrganizations,
  useAccessGrants,
  useRequestAccess,
} from '../useDashboard';
import { resolveWritingTypeCatalog } from '../writingTypeAccess';

import { AiDisclaimerNotice } from '@/components/ui';
import { apiClient, type HttpClient } from '@/services';

import type { Document } from '@wren/types';

export interface WriterDashboardProps {
  /** Injectable HTTP client (defaults to the shared app client). */
  readonly client?: HttpClient;
  /** Optional seam for opening a document (page/route composition wires this). */
  readonly onOpenDocument?: (document: Document) => void;
}

export function WriterDashboard({
  client = apiClient,
  onOpenDocument,
}: WriterDashboardProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilterValue>(ALL_STATUSES);
  const [requestedWritingTypeIds, setRequestedWritingTypeIds] = useState<string[]>([]);

  const documentsQuery = useDocuments(client);
  const writingTypesQuery = useWritingTypes(client);
  const organizationsQuery = useOrganizations(client);
  const accessGrantsQuery = useAccessGrants(client);
  const requestAccessMutation = useRequestAccess(client);

  const documents = documentsQuery.data ?? [];
  const filteredDocuments = filterDocuments(documents, { search, status });

  // Resolve writing type catalog once all queries are ready
  const writingTypes = writingTypesQuery.data ?? [];
  const organizations = organizationsQuery.data ?? [];
  const accessGrants = accessGrantsQuery.data ?? [];
  const resolvedWritingTypes = resolveWritingTypeCatalog(
    writingTypes,
    organizations,
    accessGrants,
  );

  const handleSelectWritingType = (_writingType: typeof writingTypes[0]) => {
    // Placeholder: page/route composition wires the actual navigation here
  };

  const handleRequestAccess = (writingType: typeof writingTypes[0]) => {
    setRequestedWritingTypeIds((prev) => [...prev, writingType.id]);
    requestAccessMutation.mutate({
      writingTypeId: writingType.id,
    });
  };

  return (
    <div className="flex flex-col gap-xl px-4xl">
      <AiDisclaimerNotice
        dismissible
        dismissStorageKey="dashboard-ai-disclaimer-dismissed"
      />

      <h1 className="text-title-page font-sans font-bold text-text-primary">
        Writing Environments
      </h1>

      <section
        aria-labelledby="writer-dashboard-types-heading"
        className="flex flex-col gap-lg"
      >
        <h2
          id="writer-dashboard-types-heading"
          className="text-heading3 font-sans font-semibold text-text-primary underline"
        >
          Start a Document
        </h2>

        <WritingTypeSelector
          resolvedWritingTypes={resolvedWritingTypes}
          onSelect={handleSelectWritingType}
          onRequestAccess={handleRequestAccess}
          requestingWritingTypeId={
            requestAccessMutation.isPending
              ? requestAccessMutation.variables?.writingTypeId
              : undefined
          }
          requestedWritingTypeIds={requestedWritingTypeIds}
        />
      </section>

      <section
        aria-labelledby="writer-dashboard-documents-heading"
        className="flex flex-col gap-lg"
      >
        <h2
          id="writer-dashboard-documents-heading"
          className="text-heading3 font-sans font-semibold text-text-primary underline"
        >
          My Documents{documents.length > 0 ? ` (${documents.length})` : ''}
        </h2>

        <div className="flex flex-col gap-lg sm:flex-row sm:items-end">
          <div className="sm:flex-1">
            <WritingEnvironmentSearch value={search} onChange={setSearch} />
          </div>
          <StatusFilter value={status} onChange={setStatus} />
        </div>

        {documentsQuery.isLoading && (
          <p role="status" className="text-bodySmall text-text-secondary">
            Loading your documents…
          </p>
        )}

        {documentsQuery.isError && (
          <div role="alert" className="flex flex-col gap-sm">
            <p className="text-bodySmall text-signal-critical">
              Something went wrong loading your documents.
            </p>
            <button
              type="button"
              onClick={() => documentsQuery.refetch()}
              className="self-start rounded-md border border-border-strong px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
            >
              Retry
            </button>
          </div>
        )}

        {!documentsQuery.isLoading && !documentsQuery.isError && (
          <>
            {documents.length === 0 ? (
              <p className="text-bodySmall text-text-secondary">
                You don't have any documents yet. Go to the dashboard to create your first one.
              </p>
            ) : filteredDocuments.length === 0 ? (
              <p className="text-bodySmall text-text-secondary">
                No documents match your search.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-lg sm:grid-cols-2 lg:grid-cols-3">
                {filteredDocuments.map((document) => (
                  <WritingEnvironmentCard
                    key={document.id}
                    document={document}
                    onOpen={onOpenDocument}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
