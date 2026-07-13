/**
 * Integration tests for `<FieldExpertConsole>` (task 19.2).
 *
 * **Validates: Requirements 23.4, 24.1, 32.2, 40.1**
 *
 * Exercises the real React Query + mock-API wiring by injecting a
 * `MockApiClient` through the console's `client` prop (mirroring the
 * `<WriterDashboard>` test style). The headline assertion is that selecting a
 * different Active Writing Type re-scopes the whole surface (Requirement 23.4).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { FieldExpertConsole } from './FieldExpertConsole';

import { MockApiClient, type MockRoutes } from '@/services/mockApi';

import type { ReactNode } from 'react';

const routes: MockRoutes = {
  'GET /field-expert/writing-types': [
    {
      id: 'wt-legal-memo',
      organizationId: 'org-1',
      name: 'Legal Memo',
      accessState: 'OPEN',
      sizeLimitWords: null,
    },
    {
      id: 'wt-contract-clause',
      organizationId: 'org-1',
      name: 'Contract Clause',
      accessState: 'LOCKED',
      sizeLimitWords: null,
    },
  ],

  // wt-legal-memo — populated taxonomy.
  'GET /writing-types/wt-legal-memo/taxonomy': [
    {
      id: 'cat-clarity',
      writingTypeId: 'wt-legal-memo',
      label: 'Unclear Writing',
      order: 0,
    },
  ],
  'GET /writing-types/wt-legal-memo/prompt-config': {
    writingTypeId: 'wt-legal-memo',
    domainPrompt: {
      instructionText: 'Ask Socratic questions.',
      tone: 'Direct',
      density: 'standard',
      priority: 'Recurring issues first',
    },
    systemScaffolding: {
      systemInstructions: 'You are WREN.',
      guardrailTemplate: 'Discard any correct version.',
    },
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  'GET /writing-types/wt-legal-memo/reference-materials': [],
  'GET /writing-types/wt-legal-memo/aggregate-analytics': {
    writingTypeId: 'wt-legal-memo',
    totalDocuments: 42,
    totalDrafts: 118,
    totalFeedbackItems: 365,
    categoryTotals: [],
  },

  // wt-contract-clause — empty taxonomy.
  'GET /writing-types/wt-contract-clause/taxonomy': [],
  'GET /writing-types/wt-contract-clause/prompt-config': {
    writingTypeId: 'wt-contract-clause',
    domainPrompt: {
      instructionText: '',
      tone: '',
      density: 'standard',
      priority: '',
    },
    systemScaffolding: {
      systemInstructions: 'You are WREN.',
      guardrailTemplate: 'Discard any correct version.',
    },
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  'GET /writing-types/wt-contract-clause/reference-materials': [],
  'GET /writing-types/wt-contract-clause/aggregate-analytics': {
    writingTypeId: 'wt-contract-clause',
    totalDocuments: 7,
    totalDrafts: 12,
    totalFeedbackItems: 20,
    categoryTotals: [],
  },
};

function renderConsole() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = new MockApiClient(routes);
  const ui: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <FieldExpertConsole client={client} />
    </QueryClientProvider>
  );
  return render(ui);
}

describe('FieldExpertConsole', () => {
  it('defaults to the first assigned writing type and renders its taxonomy', async () => {
    renderConsole();

    // The Active-Writing-Type selector reflects the first assigned type.
    const selector = (await screen.findByLabelText(
      'Active writing type',
    )) as HTMLSelectElement;
    expect(selector.value).toBe('wt-legal-memo');

    // ...and the legal-memo taxonomy category renders.
    expect(await screen.findByText('Unclear Writing')).toBeInTheDocument();
  });

  it('re-scopes the whole surface when the active writing type changes (Requirement 23.4)', async () => {
    const user = userEvent.setup();
    renderConsole();

    // Legal Memo (default) shows its category.
    expect(await screen.findByText('Unclear Writing')).toBeInTheDocument();

    // Switch the active type to the (empty) Contract Clause.
    await user.selectOptions(
      screen.getByLabelText('Active writing type'),
      'wt-contract-clause',
    );

    // The prior type's taxonomy is gone and the new type's empty-state shows.
    await waitFor(() =>
      expect(screen.queryByText('Unclear Writing')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText('No categories yet. Add the first one below.'),
    ).toBeInTheDocument();
  });

  it('renders the aggregate analytics totals for the active type (Requirement 40.1)', async () => {
    renderConsole();

    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('118')).toBeInTheDocument();
    expect(screen.getByText('365')).toBeInTheDocument();
  });
});
