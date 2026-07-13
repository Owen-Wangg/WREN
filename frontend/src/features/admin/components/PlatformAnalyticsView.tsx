/**
 * `<PlatformAnalyticsView>` — aggregate platform/org metrics with an optional
 * Writing Type filter (task 19.4; Requirements 41.1, 41.2).
 *
 * Shows metric cards (label + value + optional unit). Includes a Writing Type
 * filter dropdown that re-fetches analytics with the selected writingTypeId.
 *
 * DELIBERATE CONSTRAINT: NO per-user data, NO per-user scores, NO user
 * identities anywhere in this view (Requirements 41.3, 41.6). The schema
 * (`platformAnalyticsSchema`) enforces this structurally — there is no array
 * slot for individual-user rows.
 */
import { useState } from 'react';

import { usePlatformAnalytics } from '../useAdmin';

import type { HttpClient } from '@/services';

export interface PlatformAnalyticsViewProps {
  readonly client?: HttpClient;
  /** Optional list of Writing Type options for the filter dropdown. */
  readonly writingTypeOptions?: readonly { readonly id: string; readonly label: string }[];
}

export function PlatformAnalyticsView({
  client,
  writingTypeOptions = [],
}: PlatformAnalyticsViewProps) {
  const [selectedWritingTypeId, setSelectedWritingTypeId] = useState<
    string | undefined
  >(undefined);

  const analyticsQuery = usePlatformAnalytics(selectedWritingTypeId, client);

  return (
    <section
      aria-labelledby="platform-analytics-heading"
      aria-label="Platform Analytics"
      role="region"
      className="flex flex-col gap-md"
    >
      <h3
        id="platform-analytics-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Platform Analytics
      </h3>
      <p className="text-caption text-text-muted">
        All-users aggregate totals across the platform. No individual users are
        identified.
      </p>

      {/* Writing Type filter */}
      {writingTypeOptions.length > 0 && (
        <div className="flex flex-col gap-xs">
          <label
            htmlFor="analytics-wt-filter"
            className="text-caption text-text-secondary"
          >
            Filter by Writing Type
          </label>
          <select
            id="analytics-wt-filter"
            value={selectedWritingTypeId ?? ''}
            onChange={(e) =>
              setSelectedWritingTypeId(e.target.value || undefined)
            }
            className="rounded-md border border-border-strong bg-surface-primary px-md py-xs text-bodySmall text-text-primary"
          >
            <option value="">All writing types</option>
            {writingTypeOptions.map((wt) => (
              <option key={wt.id} value={wt.id}>
                {wt.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {analyticsQuery.isLoading && (
        <p role="status" className="text-bodySmall text-text-secondary">
          Loading analytics…
        </p>
      )}

      {analyticsQuery.isError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          Failed to load analytics.
        </p>
      )}

      {analyticsQuery.data && (
        <dl className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
          {analyticsQuery.data.metrics.map((metric) => (
            <div
              key={metric.label}
              className="flex flex-col gap-xs rounded-md border border-border-subtle bg-surface-primary px-md py-md"
            >
              <dt className="text-caption text-text-muted">{metric.label}</dt>
              <dd className="text-heading2 font-sans font-semibold text-text-primary">
                {metric.value}
                {metric.unit && (
                  <span className="ml-xs text-bodySmall font-normal text-text-secondary">
                    {metric.unit}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
