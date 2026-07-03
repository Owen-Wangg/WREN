/**
 * Integration tests for `<WriterDashboard>` (task 19.1).
 *
 * **Validates: Requirements 4.2, 4.6, 6.8, 28.2**
 *
 * These exercise the real React Query + mock-API wiring by injecting a
 * `MockApiClient` (with task-specific fixtures) through the component's `client`
 * prop — mirroring the injection style the other feature tests use — rather
 * than mocking the query hooks.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WriterDashboard } from './WriterDashboard';

import { MockApiClient, type MockRoutes } from '@/services/mockApi';

import type { ReactNode } from 'react';

function renderWithClient(routes: MockRoutes) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = new MockApiClient(routes);
  const ui: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <WriterDashboard client={client} />
    </QueryClientProvider>
  );
  return render(ui);
}

const populatedRoutes: MockRoutes = {
  'GET /documents': [
    {
      id: 'doc-1',
      ownerUserId: 'user-1',
      writingTypeId: 'wt-legal-memo',
      contentTypeId: 'ct-1',
      name: 'Charter s.8 analysis',
      metadata: { 'Writing Topic': 'Search and seizure' },
      status: 'Still Drafting',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    {
      id: 'doc-2',
      ownerUserId: 'user-1',
      writingTypeId: 'wt-legal-memo',
      contentTypeId: 'ct-1',
      name: 'Contract formation notes',
      metadata: { 'Writing Topic': 'Offer and acceptance' },
      status: 'Polishing',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
  ],
  'GET /writing-types': [
    {
      id: 'wt-legal-memo',
      organizationId: 'org-1',
      name: 'Legal Memo',
      accessState: 'OPEN',
      sizeLimitWords: null,
    },
  ],
  'GET /organizations': [{ id: 'org-1', name: 'Allard Law', accessState: 'OPEN' }],
  'GET /access-grants': [],
};

const lockedRoutes: MockRoutes = {
  'GET /documents': [],
  'GET /writing-types': [
    {
      id: 'wt-locked',
      organizationId: 'org-1',
      name: 'Locked Brief',
      accessState: 'LOCKED',
      sizeLimitWords: null,
    },
  ],
  'GET /organizations': [{ id: 'org-1', name: 'Allard Law', accessState: 'OPEN' }],
  'GET /access-grants': [],
  'POST /access-requests': { requested: true },
};

describe('WriterDashboard', () => {
  it('renders a "My Documents" card with Topic and Status for each document (Requirement 4.2)', async () => {
    renderWithClient(populatedRoutes);

    expect(await screen.findByText('Charter s.8 analysis')).toBeInTheDocument();
    expect(screen.getByText('Search and seizure')).toBeInTheDocument();
    expect(screen.getByText('Contract formation notes')).toBeInTheDocument();
    expect(screen.getByText('Offer and acceptance')).toBeInTheDocument();

    // Status is rendered through the shared StatusBadge. ("Still Drafting" /
    // "Polishing" also appear as StatusFilter <option>s, so scope to the badges
    // by their statusColorMap-backed surface classes.)
    const draftingBadge = screen
      .getAllByText('Still Drafting')
      .find((el) => el.className.includes('rounded-full'));
    const polishingBadge = screen
      .getAllByText('Polishing')
      .find((el) => el.className.includes('rounded-full'));
    expect(draftingBadge).toBeDefined();
    expect(polishingBadge).toBeDefined();
  });

  it('narrows the document list with the search input', async () => {
    const user = userEvent.setup();
    renderWithClient(populatedRoutes);

    await screen.findByText('Charter s.8 analysis');

    await user.type(
      screen.getByLabelText('Search documents', { exact: false }),
      'contract',
    );

    expect(screen.queryByText('Charter s.8 analysis')).not.toBeInTheDocument();
    expect(screen.getByText('Contract formation notes')).toBeInTheDocument();
  });

  it('narrows the document list with the status filter', async () => {
    const user = userEvent.setup();
    renderWithClient(populatedRoutes);

    await screen.findByText('Charter s.8 analysis');

    await user.selectOptions(screen.getByLabelText('Status'), 'Polishing');

    expect(screen.queryByText('Charter s.8 analysis')).not.toBeInTheDocument();
    expect(screen.getByText('Contract formation notes')).toBeInTheDocument();
  });

  it('lets the writer self-select an OPEN writing type (Requirements 4.2, 28.2)', async () => {
    renderWithClient(populatedRoutes);

    expect(await screen.findByText('Legal Memo')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Start a document' }),
    ).toBeInTheDocument();
  });

  it('offers Request access for a LOCKED writing type and calls the mock on click (Requirement 4.6)', async () => {
    const user = userEvent.setup();
    renderWithClient(lockedRoutes);

    const requestButton = await screen.findByRole('button', {
      name: 'Request access',
    });
    expect(
      screen.queryByRole('button', { name: 'Start a document' }),
    ).not.toBeInTheDocument();

    await user.click(requestButton);

    // The mock POST /access-requests resolves, and onSuccess flips the button
    // into the "Access requested" state.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Access requested' }),
      ).toBeInTheDocument(),
    );
  });

  it('renders the AiDisclaimerNotice on the empty state (steering §3/§4)', async () => {
    renderWithClient(lockedRoutes);

    // Wait for the documents query to settle into the empty state...
    expect(
      await screen.findByText(/You don't have any documents yet\./),
    ).toBeInTheDocument();
    // ...and the shared disclaimer is present (role="note").
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});
