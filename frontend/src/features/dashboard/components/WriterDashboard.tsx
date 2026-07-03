/**
 * `<WriterDashboard>` — the connected writer dashboard (task 19.1; frontend
 * steering §4; Requirements 4.2, 4.6, 6.8, 28.2).
 *
 * Composes the "My Documents" surface (search + status filter over
 * {@link WritingEnvironmentCard}s) and the Writing Type self-selection /
 * access-request section. Server state comes from the `useDashboard` React
 * Query hooks; each accepts an optional {@link HttpClient} so a test can inject
 * a `MockApiClient` with different fixtures (e.g. a LOCKED Writing Type) without
 * touching global state.
 *
 * The shared `<AiDisclaimerNotice>` is always rendered (steering §3/§4: the
 * dashboard surfaces the disclaimer, notably on the empty state) — never
 * copy-pasted inline (steering §11).
 *
 * This module builds the feature surface only; it is deliberately NOT wired
 * into `App.tsx` routing (that is convergence work). `onOpenDocument` /
 * `onSelectWritingType` are optional seams a router/page can supply later.
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
  useAccessGrants,
  useDocuments,
  useOrganizations,
  useRequestAccess,
  useWritingTypes,
} from '../useDashboard';
import { resolveWritingTypeCatalog } from '../writingTypeAccess';

import { AiDisclaimerNotice } from '@/components/ui';
import { apiClient, type HttpClient } from '@/services';

import type { Document, WritingType } from '@wren/types';

export interface WriterDashboardProps {
  /** Injectable HTTP client (defaults to the shared app client). */
  readonly client?: HttpClient;
  /** Optional seam for opening a document (page/route composition wires this). */
  readonly onOpenDocument?: (document: Document) => void;
  /** Optional seam for starting a document in a self-selected Writing Type. */
  readonly onSelectWritingType?: (writingType: WritingType) => void;
}

export function WriterDashboard({
  client = apiClient,
  onOpenDocument,
  onSelectWritingType,
}: WriterDashboardProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilterValue>(ALL_STATUSES);
  const [requestedWritingTypeIds, setRequestedWritingTypeIds] = useState<
    string[]
  >([]);

  const documentsQuery = useDocuments(client);
  const writingTypesQuery = useWritingTypes(client);
  const organizationsQuery = useOrganizations(client);
  const grantsQuery = useAccessGrants(client);
  const requestAccess = useRequestAccess(client);

  const documents = documentsQuery.data ?? [];
  const filteredDocuments = filterDocuments(documents, { search, status });

  const resolvedWritingTypes =
    writingTypesQuery.data && organizationsQuery.data && grantsQuery.data
      ? resolveWritingTypeCatalog(
          writingTypesQuery.data,
          organizationsQuery.data,
          grantsQuery.data,
        )
      : [];

  const handleRequestAccess = (writingType: WritingType) => {
    requestAccess.mutate(
      { writingTypeId: writingType.id },
      {
        onSuccess: () =>
          setRequestedWritingTypeIds((prev) =>
            prev.includes(writingType.id) ? prev : [...prev, writingType.id],
          ),
      },
    );
  };

  const requestingWritingTypeId = requestAccess.isPending
    ? requestAccess.variables?.writingTypeId
    : undefined;

  return (
    <div className="flex flex-col gap-xl">
      <AiDisclaimerNotice />

      <section
        aria-labelledby="writer-dashboard-documents-heading"
        className="flex flex-col gap-md"
      >
        <h2
          id="writer-dashboard-documents-heading"
          className="text-heading3 font-sans font-semibold text-text-primary"
        >
          My Documents
        </h2>

        <div className="flex flex-col gap-md sm:flex-row sm:items-end">
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
                You don't have any documents yet. Select a writing type below to
                start your first one.
              </p>
            ) : filteredDocuments.length === 0 ? (
              <p className="text-bodySmall text-text-secondary">
                No documents match your search.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
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

      <section
        aria-labelledby="writer-dashboard-writing-types-heading"
        className="flex flex-col gap-md"
      >
        <h2
          id="writer-dashboard-writing-types-heading"
          className="text-heading3 font-sans font-semibold text-text-primary"
        >
          Start a new document
        </h2>

        {(writingTypesQuery.isLoading ||
          organizationsQuery.isLoading ||
          grantsQuery.isLoading) && (
          <p role="status" className="text-bodySmall text-text-secondary">
            Loading writing types…
          </p>
        )}

        {(writingTypesQuery.isError ||
          organizationsQuery.isError ||
          grantsQuery.isError) && (
          <p role="alert" className="text-bodySmall text-signal-critical">
            Something went wrong loading writing types.
          </p>
        )}

        {requestAccess.isError && (
          <p role="alert" className="text-bodySmall text-signal-critical">
            Couldn't request access. Please try again.
          </p>
        )}

        {!writingTypesQuery.isLoading &&
          !organizationsQuery.isLoading &&
          !grantsQuery.isLoading &&
          !writingTypesQuery.isError &&
          !organizationsQuery.isError &&
          !grantsQuery.isError && (
            <WritingTypeSelector
              resolvedWritingTypes={resolvedWritingTypes}
              onSelect={(writingType) => onSelectWritingType?.(writingType)}
              onRequestAccess={handleRequestAccess}
              requestingWritingTypeId={requestingWritingTypeId}
              requestedWritingTypeIds={requestedWritingTypeIds}
            />
          )}
      </section>
    </div>
  );
}
