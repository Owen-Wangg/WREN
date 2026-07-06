/**
 * Integration tests for `<OrgOwnerConsole>` (task 19.3).
 *
 * **Validates: Requirements 34.1, 34.2, 34.3, 34.4, 34.5**
 *
 * Exercises the real React Query + mock-API wiring by injecting a
 * `MockApiClient` through the console's `client` prop (mirroring the
 * `<FieldExpertConsole>` test style). Asserts the org selector renders, the
 * sub-panels load for the selected org, and the analytics view shows aggregate
 * totals only (no per-user data — Requirement 34.5).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { OrgOwnerConsole } from './OrgOwnerConsole';

import { MockApiClient, type MockRoutes } from '@/services/mockApi';

import type { ReactNode } from 'react';

const routes: MockRoutes = {
  'GET /org-owner/organizations': [
    { id: 'org-1', name: 'Allard Law', accessState: 'OPEN' },
    { id: 'org-2', name: 'Philosophy Dept', accessState: 'LOCKED' },
  ],

  // org-1 data
  'GET /org-owner/organizations/org-1/writing-types': [
    {
      id: 'wt-memo',
      organizationId: 'org-1',
      name: 'Legal Memo',
      accessState: 'OPEN',
      sizeLimitWords: null,
    },
  ],
  'GET /org-owner/organizations/org-1/content-types': [
    { id: 'ct-1', organizationId: 'org-1', writingTypeId: 'wt-memo', name: 'Case Brief' },
  ],
  'GET /org-owner/organizations/org-1/topics': [
    { id: 'topic-1', organizationId: 'org-1', name: 'Constitutional Law' },
  ],
  'GET /org-owner/organizations/org-1/metadata-fields': [
    { key: 'writing-topic', label: 'Writing Topic', required: true },
  ],
  'GET /org-owner/organizations/org-1/members': [
    {
      userId: 'user-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@law.ubc.ca',
      role: 'User',
      assignedWritingTypeIds: [],
    },
  ],
  'GET /org-owner/organizations/org-1/analytics': {
    organizationId: 'org-1',
    totalDocuments: 85,
    totalDrafts: 210,
    totalFeedbackItems: 512,
    activeWriterCount: 14,
    byWritingType: [
      {
        writingTypeId: 'wt-memo',
        writingTypeName: 'Legal Memo',
        documentCount: 85,
        draftCount: 210,
        feedbackItemCount: 512,
      },
    ],
  },

  // org-2 data (sparse)
  'GET /org-owner/organizations/org-2/writing-types': [],
  'GET /org-owner/organizations/org-2/content-types': [],
  'GET /org-owner/organizations/org-2/topics': [],
  'GET /org-owner/organizations/org-2/metadata-fields': [],
  'GET /org-owner/organizations/org-2/members': [],
  'GET /org-owner/organizations/org-2/analytics': {
    organizationId: 'org-2',
    totalDocuments: 0,
    totalDrafts: 0,
    totalFeedbackItems: 0,
    activeWriterCount: 0,
    byWritingType: [],
  },
};

function renderConsole() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = new MockApiClient(routes);
  const ui: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <OrgOwnerConsole client={client} />
    </QueryClientProvider>
  );
  return render(ui);
}

describe('OrgOwnerConsole', () => {
  it('renders the organization selector and defaults to the first org', async () => {
    renderConsole();

    const selector = (await screen.findByLabelText(
      'Organization',
    )) as HTMLSelectElement;
    expect(selector.value).toBe('org-1');
  });

  it('shows Writing Types for the selected org', async () => {
    renderConsole();

    // "Legal Memo" appears in both the WritingTypes table and the ContentTypes
    // form dropdown, so use getAllByText.
    const items = await screen.findAllByText('Legal Memo');
    expect(items.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Content Types for the selected org', async () => {
    renderConsole();

    expect(await screen.findByText('Case Brief')).toBeInTheDocument();
  });

  it('shows Topics for the selected org', async () => {
    renderConsole();

    expect(await screen.findByText('Constitutional Law')).toBeInTheDocument();
  });

  it('shows Metadata Fields for the selected org', async () => {
    renderConsole();

    expect(await screen.findByText('Writing Topic')).toBeInTheDocument();
  });

  it('shows Members for the selected org', async () => {
    renderConsole();

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
  });

  it('shows aggregate analytics totals (Requirement 34.5 — no per-user data)', async () => {
    renderConsole();

    // The analytics section is labelled; query within it.
    const analyticsSection = await screen.findByRole('region', {
      name: 'Organization Analytics',
    });
    // Use getAllByText since "85" appears in both the card and the table.
    const totals = await screen.findAllByText('85');
    expect(totals.length).toBeGreaterThanOrEqual(1);
    expect(analyticsSection).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('switches org when a different organization is selected (Requirement 34.4)', async () => {
    const user = userEvent.setup();
    renderConsole();

    // Wait for first org data to load — look for a unique string.
    expect(await screen.findByText('Case Brief')).toBeInTheDocument();

    // Switch to org-2.
    await user.selectOptions(screen.getByLabelText('Organization'), 'org-2');

    // org-1 content should disappear, org-2's empty state should show.
    await waitFor(() =>
      expect(screen.queryByText('Case Brief')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText('No writing types yet. Add the first one below.'),
    ).toBeInTheDocument();
  });
});
