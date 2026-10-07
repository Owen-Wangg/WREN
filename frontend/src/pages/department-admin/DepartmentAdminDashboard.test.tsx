import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Department } from '@wren/types';

import { DepartmentAdminDashboard } from './DepartmentAdminDashboard';
import { useAuth } from '@/features/auth/AuthContext';
import { useActiveDepartment } from '@/features/department-admin/ActiveDepartmentContext';

const apiMocks = vi.hoisted(() => ({
  listDocumentTypes: vi.fn(),
  createDocumentType: vi.fn(),
  deleteDocumentType: vi.fn(),
  updateDepartmentAskWrenPrompt: vi.fn(),
  updateDepartmentPrompt: vi.fn(),
}));

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/department-admin/ActiveDepartmentContext', () => ({
  useActiveDepartment: vi.fn(),
}));
vi.mock('@/features/department-admin/departmentAdminApi', () => apiMocks);

const STORED_PROMPT = [
  '[Department Context]\nLaw students writing legal memoranda',
  '[Writing Standards]\nMcGill Guide citations',
  '[Restricted Topics]\nDo not assess the merits of arguments',
].join('\n\n');

const lawDepartment: Department = {
  id: 'dept-law',
  name: 'Law',
  prompt: STORED_PROMPT,
  askWrenPrompt: null,
  accessState: 'OPEN',
  visibilityState: 'VISIBLE',
  viewerCanDiscover: true,
};

function mockDepartmentAdmin(departments: Department[], active: Department) {
  vi.mocked(useAuth).mockReturnValue({
    user: {
      userId: 'user-1',
      roles: ['DepartmentAdmin'],
      administeredDepartmentIds: departments.map((d) => d.id),
    },
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useActiveDepartment).mockReturnValue({
    departments,
    activeDepartment: active,
    activeDepartmentId: active.id,
    setActiveDepartmentId: vi.fn(),
    isLoading: false,
  });
}

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DepartmentAdminDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DepartmentAdminDashboard — Department Prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listDocumentTypes.mockResolvedValue([]);
  });

  it('pre-fills the editor with the stored department prompt for a Department Admin', async () => {
    mockDepartmentAdmin([lawDepartment], lawDepartment);
    renderDashboard();

    expect(
      await screen.findByRole('heading', { name: 'Department Prompt' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Department Context')).toHaveValue(
      'Law students writing legal memoranda',
    );
    expect(screen.getByLabelText('Writing Standards')).toHaveValue('McGill Guide citations');
    expect(screen.getByLabelText('Restricted Topics')).toHaveValue(
      'Do not assess the merits of arguments',
    );
  });

  it('saves edits through the department-admin API', async () => {
    const user = userEvent.setup();
    mockDepartmentAdmin([lawDepartment], lawDepartment);
    apiMocks.updateDepartmentPrompt.mockResolvedValue(lawDepartment);
    renderDashboard();

    const standards = await screen.findByLabelText('Writing Standards');
    await user.clear(standards);
    await user.type(standards, 'APA 7');
    await user.click(screen.getByRole('button', { name: 'Save Prompt' }));

    await waitFor(() =>
      expect(apiMocks.updateDepartmentPrompt).toHaveBeenCalledWith(
        'dept-law',
        [
          '[Department Context]\nLaw students writing legal memoranda',
          '[Writing Standards]\nAPA 7',
          '[Restricted Topics]\nDo not assess the merits of arguments',
        ].join('\n\n'),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Saved successfully!');
  });

  it('re-syncs the editor when the active department changes', async () => {
    const otherDepartment: Department = {
      ...lawDepartment,
      id: 'dept-eng',
      name: 'Engineering',
      prompt: 'Engineering students writing lab reports',
    };
    mockDepartmentAdmin([lawDepartment, otherDepartment], lawDepartment);
    const { rerender } = renderDashboard();
    expect(await screen.findByLabelText('Department Context')).toHaveValue(
      'Law students writing legal memoranda',
    );

    mockDepartmentAdmin([lawDepartment, otherDepartment], otherDepartment);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <DepartmentAdminDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Department Context')).toHaveValue(
        'Engineering students writing lab reports',
      ),
    );
    expect(screen.getByLabelText('Writing Standards')).toHaveValue('');
  });
});
