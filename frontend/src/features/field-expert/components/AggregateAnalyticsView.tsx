/**
 * `<AggregateAnalyticsView>` — the all-users aggregate analytics view for a
 * Field Expert's assigned Writing Type (task 19.2; Requirements 40.1, 40.6).
 *
 * IMPORTANT — this is an aggregate cohort view. Aggregate totals across ALL
 * users are intentionally allowed here (total documents / drafts / feedback
 * items, plus per-category totals). There are deliberately NO per-user rows,
 * names, or per-user scores. The writer-facing no-numeric-scoring rule
 * (Requirement 18.3 / Property 19) does NOT apply to this Field-Expert view, so
 * the numeric aggregate totals below are correct and expected.
 */
import type { AggregateAnalytics } from '../fieldExpertSchemas';

export interface AggregateAnalyticsViewProps {
  readonly analytics: AggregateAnalytics;
}

export function AggregateAnalyticsView({
  analytics,
}: AggregateAnalyticsViewProps) {
  return (
    <section
      aria-labelledby="aggregate-analytics-heading"
      className="flex flex-col gap-md"
    >
      <h3
        id="aggregate-analytics-heading"
        className="text-heading3 font-sans font-semibold text-text-primary"
      >
        Aggregate analytics
      </h3>
      <p className="text-caption text-text-muted">
        All-users totals across this writing type. No individual writers are
        shown.
      </p>

      <dl className="grid grid-cols-1 gap-md sm:grid-cols-3">
        <AggregateTotal label="Documents" value={analytics.totalDocuments} />
        <AggregateTotal label="Drafts" value={analytics.totalDrafts} />
        <AggregateTotal
          label="Feedback items"
          value={analytics.totalFeedbackItems}
        />
      </dl>

      <div className="flex flex-col gap-sm">
        <h4 className="text-bodySmall font-sans font-semibold text-text-primary">
          Totals by error category
        </h4>
        {analytics.categoryTotals.length === 0 ? (
          <p className="text-bodySmall text-text-secondary">
            No category totals yet.
          </p>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
                >
                  Category
                </th>
                <th
                  scope="col"
                  className="border-b border-border-subtle px-md py-sm text-caption font-sans font-semibold text-text-secondary"
                >
                  All-users total
                </th>
              </tr>
            </thead>
            <tbody>
              {analytics.categoryTotals.map((category) => (
                <tr key={category.errorCategoryId}>
                  <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                    {category.label}
                  </td>
                  <td className="border-b border-border-subtle px-md py-sm text-bodySmall text-text-primary">
                    {category.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
