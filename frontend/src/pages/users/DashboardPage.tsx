import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { StatusFilter } from '@/features/dashboard/components/StatusFilter';
import { WritingEnvironmentCard } from '@/features/dashboard/components/WritingEnvironmentCard';
import { WritingEnvironmentSearch } from '@/features/dashboard/components/WritingEnvironmentSearch';
import {
  ALL_STATUSES,
  filterDocuments,
  type StatusFilterValue,
} from '@/features/dashboard/documentFilters';
import { useDocuments, useOrganizations } from '@/features/dashboard/useDashboard';
import { useDeleteDocument } from '@/hooks/useDocument';
import { AiDisclaimerNotice } from '@/components/ui';
import { apiClient } from '@/services';

import type { Document } from '@wren/types';

const ALL_WRITING_TYPES = 'all' as const;

export function DashboardPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilterValue>(ALL_STATUSES);
  const [writingTypeFilter, setWritingTypeFilter] = useState<string>(ALL_WRITING_TYPES);

  const documentsQuery = useDocuments(apiClient);
  const organizationsQuery = useOrganizations(apiClient);
  const documents = documentsQuery.data ?? [];
  const organizations = organizationsQuery.data ?? [];

  const filteredByType = writingTypeFilter === ALL_WRITING_TYPES
    ? documents
    : documents.filter((doc) => doc.metadata['Writing Type'] === writingTypeFilter);

  const filteredDocuments = filterDocuments(filteredByType, { search, status });

  const deleteDocument = useDeleteDocument();

  const handleOpenDocument = (document: Document) => {
    navigate(`/dashboard/document/${document.id}`);
  };

  const handleDeleteDocument = (document: Document) => {
    deleteDocument.mutate(document.id);
  };

  return (
    <div className="flex flex-col gap-xl">
      <h1 className="text-title-page font-sans font-bold text-text-primary">
        My Documents
      </h1>

      <div className="flex flex-col gap-lg sm:flex-row sm:items-end">
        <div className="sm:flex-1">
          <WritingEnvironmentSearch value={search} onChange={setSearch} />
        </div>
        <div className="flex items-end gap-md">
          <div className="flex flex-col gap-xs">
            <label
              htmlFor="writing-type-filter"
              className="text-bodySmall font-sans font-medium text-text-secondary"
            >
              Writing Type
            </label>
            <select
              id="writing-type-filter"
              value={writingTypeFilter}
              onChange={(e) => setWritingTypeFilter(e.target.value)}
              className="rounded-md border border-border-subtle bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
            >
              <option value={ALL_WRITING_TYPES}>All Writing Types</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.name}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
          <StatusFilter value={status} onChange={setStatus} />
        </div>
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
            <AiDisclaimerNotice />
          ) : filteredDocuments.length === 0 ? (
            <p className="text-bodySmall text-text-secondary">
              No documents match your filters.
            </p>
          ) : (
            <>
              <AiDisclaimerNotice />
              <div className="grid grid-cols-1 gap-lg sm:grid-cols-2 lg:grid-cols-3">
                {filteredDocuments.map((document) => (
                  <WritingEnvironmentCard
                    key={document.id}
                    document={document}
                    onOpen={handleOpenDocument}
                    onDelete={handleDeleteDocument}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
