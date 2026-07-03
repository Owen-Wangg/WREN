/**
 * Render tests for `<AggregateAnalyticsView>` (task 19.2).
 *
 * **Validates: Requirements 40.1, 40.6**
 *
 * Aggregate all-users totals ARE allowed in this Field-Expert cohort view; the
 * key compliance assertion is that there are NO per-user rows/names/scores.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AggregateAnalyticsView } from './AggregateAnalyticsView';

import type { AggregateAnalytics } from '../fieldExpertSchemas';

const analytics: AggregateAnalytics = {
  writingTypeId: 'wt-legal-memo',
  totalDocuments: 42,
  totalDrafts: 118,
  totalFeedbackItems: 365,
  categoryTotals: [
    { errorCategoryId: 'cat-clarity', label: 'Unclear Writing', total: 120 },
    { errorCategoryId: 'cat-summary', label: 'Inaccurate Summary', total: 64 },
  ],
};

describe('AggregateAnalyticsView', () => {
  it('renders the all-users aggregate totals', () => {
    render(<AggregateAnalyticsView analytics={analytics} />);

    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.getByText('365')).toBeInTheDocument();
  });

  it('renders per-category all-users totals', () => {
    render(<AggregateAnalyticsView analytics={analytics} />);

    const table = screen.getByRole('table');
    expect(within(table).getByText('Unclear Writing')).toBeInTheDocument();
    expect(within(table).getByText('120')).toBeInTheDocument();
    expect(within(table).getByText('Inaccurate Summary')).toBeInTheDocument();
    expect(within(table).getByText('64')).toBeInTheDocument();
  });

  it('shows only aggregate/cohort rows — no per-user rows (Requirement 40.6)', () => {
    render(<AggregateAnalyticsView analytics={analytics} />);

    // The only table has exactly one row per error category (plus the header
    // row) — no per-user rows exist.
    const table = screen.getByRole('table');
    const bodyRows = within(table)
      .getAllByRole('row')
      // drop the header row
      .slice(1);
    expect(bodyRows).toHaveLength(analytics.categoryTotals.length);

    // And the view explicitly states individual writers are not shown.
    expect(
      screen.getByText(/No individual writers are shown\./i),
    ).toBeInTheDocument();
  });
});
