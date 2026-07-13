/**
 * Integration tests for `<AdminConsole>` (task 19.4).
 *
 * **Validates: Requirements 33.1, 33.2, 33.3, 33.4, 33.5, 41.1, 41.2**
 *
 * Exercises the real React Query + mock-API wiring by injecting a
 * `MockApiClient` through the console's `client` prop. Asserts all sections
 * render correctly and the analytics view shows aggregate totals only (no
 * per-user data — Requirement 41.3/41.6). Verifies NO business Topics,
 * Content Types, or metadata fields appear anywhere (Requirement 33.5).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AdminConsole } from './AdminConsole';

import { MockApiClient, type MockRoutes } from '@/services/mockApi';

import type { ReactNode } from 'react';

const routes: MockRoutes = {
  'GET /admin/model-config': {
    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    temperature: 0.7,
    maxOutputTokens: 4096,
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  'GET /admin/system-prompt': {
    systemScaffold: 'You are WREN, a Socratic writing coach.',
    guardrailInstructions: 'Never produce replacement prose.',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  'GET /admin/app-settings': {
    appName: 'WREN',
    supportEmail: 'support@wren.ubc.ca',
    defaultSizeLimitWords: 5000,
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  'GET /admin/organizations': [
    { id: 'org-1', name: 'Allard Law', accessState: 'OPEN', ownerUserId: 'user-owner-1' },
    { id: 'org-2', name: 'Philosophy', accessState: 'LOCKED', ownerUserId: null },
  ],
  'GET /admin/users': [
    {
      id: 'user-1',
      firstName: 'Alice',
      lastName: 'Administrator',
      email: 'alice@ubc.ca',
      role: 'Admin',
    },
    {
      id: 'user-2',
      firstName: 'Bob',
      lastName: 'Student',
      email: 'bob@ubc.ca',
      role: 'User',
    },
  ],
  'GET /admin/usage-limits': [
    {
      id: 'limit-1',
      scope: 'platform',
      scopeRef: null,
      scopeLabel: 'Platform total',
      limitActions: 10000,
      currentUsage: 4231,
    },
    {
      id: 'limit-2',
      scope: 'organization',
      scopeRef: 'org-1',
      scopeLabel: 'Allard Law',
      limitActions: 5000,
      currentUsage: 2100,
    },
  ],
  'GET /admin/analytics': {
    scope: 'platform',
    writingTypeId: null,
    metrics: [
      { label: 'Total documents', value: 320, unit: 'documents' },
      { label: 'Total feedback items', value: 1580, unit: 'items' },
      { label: 'Active users', value: 47 },
    ],
  },
};

function renderConsole() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client = new MockApiClient(routes);
  const ui: ReactNode = (
    <QueryClientProvider client={queryClient}>
      <AdminConsole client={client} />
    </QueryClientProvider>
  );
  return render(ui);
}

describe('AdminConsole', () => {
  it('renders the page heading', async () => {
    renderConsole();

    expect(
      await screen.findByRole('heading', { name: 'Admin Console' }),
    ).toBeInTheDocument();
  });

  it('renders Model Configuration section with model id (Requirement 33.1)', async () => {
    renderConsole();

    expect(
      await screen.findByRole('heading', { name: 'Model Configuration' }),
    ).toBeInTheDocument();
    // The model id input should have the configured value.
    const modelInput = await screen.findByLabelText('Model ID');
    expect(modelInput).toHaveValue(
      'anthropic.claude-3-5-sonnet-20241022-v2:0',
    );
  });

  it('renders System Prompt / Guardrails section (Requirement 33.1)', async () => {
    renderConsole();

    expect(
      await screen.findByRole('heading', { name: 'System Prompt / Guardrails' }),
    ).toBeInTheDocument();
    const scaffoldInput = await screen.findByLabelText('System scaffold');
    expect(scaffoldInput).toHaveValue(
      'You are WREN, a Socratic writing coach.',
    );
  });

  it('renders Application Settings section (Requirement 33.1)', async () => {
    renderConsole();

    expect(
      await screen.findByRole('heading', { name: 'Application Settings' }),
    ).toBeInTheDocument();
    const appNameInput = await screen.findByLabelText('Application name');
    expect(appNameInput).toHaveValue('WREN');
  });

  it('renders Organizations list with OPEN/LOCKED state (Requirement 33.2)', async () => {
    renderConsole();

    expect(
      await screen.findByRole('heading', { name: 'Organizations' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Allard Law')).toBeInTheDocument();
    expect(screen.getByText('Philosophy')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
    expect(screen.getByText('LOCKED')).toBeInTheDocument();
  });

  it('renders System Users list (Requirement 33.3)', async () => {
    renderConsole();

    expect(
      await screen.findByRole('heading', { name: 'System Users' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Alice Administrator')).toBeInTheDocument();
    expect(screen.getByText('Bob Student')).toBeInTheDocument();
    expect(screen.getByText('alice@ubc.ca')).toBeInTheDocument();
  });

  it('renders Usage Limits with current usage (Requirement 33.4)', async () => {
    renderConsole();

    expect(
      await screen.findByRole('heading', { name: 'Usage Limits' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Platform total')).toBeInTheDocument();
    expect(screen.getByText('10000')).toBeInTheDocument();
    expect(screen.getByText('4231')).toBeInTheDocument();
  });

  it('renders Platform Analytics with aggregate metrics only (Requirements 41.1, 41.2)', async () => {
    renderConsole();

    const analyticsSection = await screen.findByRole('region', {
      name: 'Platform Analytics',
    });
    expect(analyticsSection).toBeInTheDocument();
    expect(await screen.findByText('Total documents')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(screen.getByText('1580')).toBeInTheDocument();
    expect(screen.getByText('47')).toBeInTheDocument();
  });

  it('does NOT render any business Topics, Content Types, or metadata fields (Requirement 33.5)', async () => {
    renderConsole();

    // Wait for the console to fully load by finding the analytics section.
    await screen.findByRole('region', { name: 'Platform Analytics' });

    // None of these Org-Owner business concepts should appear.
    expect(screen.queryByText(/topic/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/content type/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/metadata field/i)).not.toBeInTheDocument();
  });
});
