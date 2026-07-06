/**
 * `<OrgOwnerConsole>` — the connected top-level Org Owner business console
 * (task 19.3; Requirements 34.1, 34.2, 34.3, 34.4, 34.5).
 *
 * Composes a selector/list of owned Organizations (via `useOwnedOrganizations`)
 * and, once an Organization is selected, renders sections for: Writing Types,
 * Content Types, Metadata Fields, Topics, Members, and Analytics.
 *
 * Scoped to owned orgs only (Requirement 34.4) — never shows a platform-wide
 * view. Every hook accepts an optional {@link HttpClient} so a test can inject a
 * `MockApiClient` via the `client` prop.
 *
 * Route path: `/org-owner` (wired in App.tsx preview harness).
 */
import { useEffect, useState } from 'react';

import { ContentTypesList } from './ContentTypesList';
import { MembersList } from './MembersList';
import { MetadataFieldsList } from './MetadataFieldsList';
import { OrgAnalyticsView } from './OrgAnalyticsView';
import { TopicsList } from './TopicsList';
import { WritingTypesList } from './WritingTypesList';

import { useOwnedOrganizations } from '../useOrgOwner';

import { AiDisclaimerNotice } from '@/components/ui';
import { apiClient, type HttpClient } from '@/services';

export interface OrgOwnerConsoleProps {
  /** Injectable HTTP client (defaults to the shared app client). */
  readonly client?: HttpClient;
}

export function OrgOwnerConsole({ client = apiClient }: OrgOwnerConsoleProps) {
  const [selectedOrgId, setSelectedOrgId] = useState<string | undefined>(
    undefined,
  );

  const orgsQuery = useOwnedOrganizations(client);
  const organizations = orgsQuery.data ?? [];

  // Default to the first owned org once loaded.
  const firstOrgId = orgsQuery.data?.[0]?.id;
  useEffect(() => {
    if (selectedOrgId === undefined && firstOrgId !== undefined) {
      setSelectedOrgId(firstOrgId);
    }
  }, [selectedOrgId, firstOrgId]);

  return (
    <div className="flex w-full max-w-4xl flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <h2 className="text-heading2 font-sans font-semibold text-text-primary">
          Organization console
        </h2>
        <AiDisclaimerNotice />
      </header>

      {orgsQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading your organizations…
        </p>
      )}

      {orgsQuery.isError && (
        <div role="alert" className="flex flex-col gap-sm">
          <p className="text-bodySmall text-signal-critical">
            Something went wrong loading your organizations.
          </p>
          <button
            type="button"
            onClick={() => orgsQuery.refetch()}
            className="self-start rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall font-sans font-medium text-text-primary"
          >
            Retry
          </button>
        </div>
      )}

      {!orgsQuery.isLoading && !orgsQuery.isError && (
        <>
          {/* Organization selector */}
          <div className="flex flex-col gap-xs">
            <label
              htmlFor="org-selector"
              className="text-caption text-text-secondary"
            >
              Organization
            </label>
            <select
              id="org-selector"
              aria-label="Organization"
              value={selectedOrgId ?? ''}
              onChange={(e) => setSelectedOrgId(e.target.value || undefined)}
              className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
            >
              {organizations.length === 0 && (
                <option value="">No organizations</option>
              )}
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          {selectedOrgId && (
            <OrgPanels
              key={selectedOrgId}
              organizationId={selectedOrgId}
              client={client}
            />
          )}
        </>
      )}
    </div>
  );
}

interface OrgPanelsProps {
  readonly organizationId: string;
  readonly client: HttpClient;
}

/**
 * Per-Organization panels. Split into its own component (and remounted via
 * `key={organizationId}`) so the per-org hooks are scoped cleanly — selecting a
 * different org remounts the whole panel set.
 */
function OrgPanels({ organizationId, client }: OrgPanelsProps) {
  return (
    <div className="flex flex-col gap-2xl">
      <WritingTypesList organizationId={organizationId} client={client} />
      <ContentTypesList organizationId={organizationId} client={client} />
      <MetadataFieldsList organizationId={organizationId} client={client} />
      <TopicsList organizationId={organizationId} client={client} />
      <MembersList organizationId={organizationId} client={client} />
      <OrgAnalyticsView organizationId={organizationId} client={client} />
    </div>
  );
}
