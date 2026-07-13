/**
 * `<OrgAnalyticsView>` — displays the aggregate analytics for an owned
 * Organization (task 19.3; Requirement 34.5).
 *
 * Shows totalDocuments, totalDrafts, totalFeedbackItems, activeWriterCount (a
 * COUNT — never a list of writers), and a per-Writing-Type breakdown. There are
 * NO per-user rows, NO user identities, and NO per-user scores anywhere in this
 * view (Requirement 34.5; REQ-AUDIT-01c). This is structurally enforced by the
 * schema (`.strict()`), and the component also provides no UI slots for
 * individual user data.
 */
import { useOrgAnalytics } from '../useOrgOwner';

import type { HttpClient } from '@/services';

export interface OrgAnalyticsViewProps {
  readonly organizationId: string;
  readonly client?: HttpClient;
}

export function OrgAnalyticsView({
  organizationId,
  client,
}: OrgAnalyticsViewProps) {
  const analyticsQuery = useOrgAnalytics(organizationId, client);

  return (
    <section aria-labelledby="org-analytics-heading" className="flex flex-col gap-md">
      <h3
        id="org-analytics-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Organization Analytics
      </h3>
      <p className="text-caption text-text-muted">
        All-users aggregate totals for this organization. No individual writers
        are identified.
      </p>

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
        <>
          <dl className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
            <AggregateTotal
              label="Documents"
              value={analyticsQuery.data.totalDocuments}
            />
            <AggregateTotal
              label="Drafts"
              value={analyticsQuery.data.totalDrafts}
            />
            <AggregateTotal
              label="Feedback items"
              value={analyticsQuery.data.totalFeedbackItems}
            />
            <AggregateTotal
              label="Active writers"
              value={analyticsQuery.data.activeWriterCount}
            />
          </dl>

          <div className="flex flex-col gap-sm">
            <h4 className="text-bodySmall font-sans font-semibold text-text-primary">
              Totals by writing type
            </h4>
            {analyticsQuery.data.byWritingType.length === 0 ? (
              <p className="text-bodySmall text-text-secondary">
                No per-writing-type data yet.
              </p>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
                    >
                      Writing Type
                    </th>
                    <th
                      scope="col"
                      className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
                    >
                      Documents
                    </th>
                    <th
                      scope="col"
                      className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
                    >
                      Drafts
                    </th>
                    <th
                      scope="col"
                      className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
                    >
                      Feedback items
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analyticsQuery.data.byWritingType.map((wt) => (
                    <tr key={wt.writingTypeId}>
                      <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                        {wt.writingTypeName}
                      </td>
                      <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                        {wt.documentCount}
                      </td>
                      <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                        {wt.draftCount}
                      </td>
                      <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                        {wt.feedbackItemCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function AggregateTotal({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="flex flex-col gap-xs rounded-md border border-border-subtle bg-surface-primary px-md py-md">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-heading2 font-sans font-semibold text-text-primary">
        {value}
      </dd>
    </div>
  );
}
