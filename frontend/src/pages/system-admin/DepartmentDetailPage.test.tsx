import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Department, UserSummary } from '@wren/types';
import { DepartmentDetailPage } from './DepartmentDetailPage';
import { useAuth } from '@/features/auth/AuthContext';

const apiMocks = vi.hoisted(() => ({
  listDepartments: vi.fn(),
  getDepartmentUsers: vi.fn(),
  assignRole: vi.fn(),
  revokeRole: vi.fn(),
  updateDepartmentPrompt: vi.fn(),
  updateDepartmentAskWrenPrompt: vi.fn(),
  setDepartmentAccessState: vi.fn(),
  getAnalyticsSummary: vi.fn(),
  deleteDepartment: vi.fn(),
  setDepartmentVisibilityState: vi.fn(),
  listDepartmentVisibilityGrants: vi.fn(),
  createDepartmentVisibilityGrant: vi.fn(),
  revokeDepartmentVisibilityGrant: vi.fn(),
  searchAllUsers: vi.fn(),
  listDepartmentEnrollments: vi.fn(),
  removeDepartmentEnrollment: vi.fn(),
  importDepartmentEnrollments: vi.fn(),
  departmentRosterQueryKey: (departmentId: string) => ['department-enrollments', departmentId],
}));

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/system-admin/systemAdminApi', () => ({
  ...apiMocks,
  systemAdminApi: { listDepartments: apiMocks.listDepartments },
}));

const department: Department = {
  id: 'department-1',
  name: 'Test Department',
  accessState: 'OPEN',
  visibilityState: 'VISIBLE',
  viewerCanDiscover: true,
};

const ordinaryUser: UserSummary = {
  id: 'user-ordinary',
  email: 'ordinary@example.com',
  firstName: 'Ordinary',
  lastName: 'Student',
  roles: ['Student'],
  administeredDepartmentIds: [],
};

const explicitUser: UserSummary = {
  id: 'user-explicit',
  email: 'explicit@example.com',
  firstName: 'Explicit',
  lastName: 'Student',
  roles: ['Student'],
  administeredDepartmentIds: [],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/system-admin/department/department-1']}>
        <Routes>
          <Route
            path="/system-admin/department/:departmentId"
            element={<DepartmentDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockTechnicalAdmin() {
  vi.mocked(useAuth).mockReturnValue({ dbRoles: ['TechnicalAdmin'] } as ReturnType<typeof useAuth>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTechnicalAdmin();
  apiMocks.listDepartments.mockResolvedValue([department]);
  apiMocks.getDepartmentUsers.mockResolvedValue({ items: [], total: 0 });
  apiMocks.searchAllUsers.mockResolvedValue({ items: [], total: 0 });
  apiMocks.listDepartmentVisibilityGrants.mockResolvedValue({
    items: [],
    total: 0,
    limit: 100,
    offset: 0,
  });
  apiMocks.listDepartmentEnrollments.mockResolvedValue({
    items: [],
    total: 0,
    limit: 20,
    offset: 0,
  });
  apiMocks.setDepartmentVisibilityState.mockImplementation(
    async (_departmentId: string, visibilityState: Department['visibilityState']) => ({
      ...department,
      visibilityState,
    }),
  );
});

describe('DepartmentDetailPage visibility management', () => {
  it('requires confirmation before hiding and restores focus when cancelled', async () => {
    const user = userEvent.setup();
    renderPage();

    const toggle = await screen.findByRole('button', {
      name: 'Limit department visibility to permitted users',
    });
    await user.click(toggle);

    const dialog = screen.getByRole('dialog', { name: 'Limit department visibility?' });
    expect(apiMocks.setDepartmentVisibilityState).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(apiMocks.setDepartmentVisibilityState).not.toHaveBeenCalled();
  });

  it('sends PERMITTED_ONLY only after confirmation', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', {
      name: 'Limit department visibility to permitted users',
    }));
    const dialog = screen.getByRole('dialog', { name: 'Limit department visibility?' });
    await user.click(within(dialog).getByRole('button', { name: 'Limit visibility' }));

    await waitFor(() => {
      expect(apiMocks.setDepartmentVisibilityState).toHaveBeenCalledWith(
        'department-1',
        'PERMITTED_ONLY',
      );
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('makes a permitted-only department visible without a confirmation dialog', async () => {
    const user = userEvent.setup();
    apiMocks.listDepartments.mockResolvedValue([
      { ...department, visibilityState: 'PERMITTED_ONLY', viewerCanDiscover: true },
    ]);
    renderPage();

    await user.click(await screen.findByRole('button', {
      name: 'Make department visible to all students',
    }));

    await waitFor(() => {
      expect(apiMocks.setDepartmentVisibilityState).toHaveBeenCalledWith(
        'department-1',
        'VISIBLE',
      );
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render visibility controls for a non-TechnicalAdmin database role', async () => {
    vi.mocked(useAuth).mockReturnValue({ dbRoles: ['DepartmentAdmin'] } as ReturnType<typeof useAuth>);
    renderPage();

    await screen.findByText('Department: Test Department');
    expect(screen.queryByText('Department visibility')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Permitted users' })).not.toBeInTheDocument();
  });

  it('distinguishes automatic bypasses, explicit permissions, grants, and revokes', async () => {
    const user = userEvent.setup();
    const technicalAdmin: UserSummary = {
      id: 'user-tech',
      email: 'tech@example.com',
      firstName: 'Technical',
      lastName: 'Admin',
      roles: ['TechnicalAdmin'],
      administeredDepartmentIds: [],
    };
    const sameDepartmentAdmin: UserSummary = {
      id: 'user-dept-admin',
      email: 'deptadmin@example.com',
      firstName: 'Department',
      lastName: 'Admin',
      roles: ['DepartmentAdmin'],
      administeredDepartmentIds: ['department-1'],
    };
    const otherDepartmentAdmin: UserSummary = {
      id: 'user-other-admin',
      email: 'otheradmin@example.com',
      firstName: 'Other',
      lastName: 'Admin',
      roles: ['DepartmentAdmin'],
      administeredDepartmentIds: ['department-2'],
    };
    apiMocks.searchAllUsers.mockResolvedValue({
      items: [ordinaryUser, explicitUser, technicalAdmin, sameDepartmentAdmin, otherDepartmentAdmin],
      total: 5,
    });
    apiMocks.listDepartmentVisibilityGrants.mockResolvedValue({
      items: [{
        grant: {
          id: 'grant-1',
          departmentId: 'department-1',
          userId: explicitUser.id,
          grantedBy: 'user-tech',
          grantedAt: '2026-09-02T12:00:00.000Z',
        },
        user: explicitUser,
      }],
      total: 1,
      limit: 100,
      offset: 0,
    });
    apiMocks.createDepartmentVisibilityGrant.mockResolvedValue({
      id: 'grant-2',
      departmentId: 'department-1',
      userId: ordinaryUser.id,
      grantedBy: 'user-tech',
      grantedAt: '2026-09-02T12:00:00.000Z',
    });
    apiMocks.revokeDepartmentVisibilityGrant.mockResolvedValue({
      id: 'grant-1',
      departmentId: 'department-1',
      userId: explicitUser.id,
      grantedBy: 'user-tech',
      grantedAt: '2026-09-02T12:00:00.000Z',
      revokedAt: '2026-09-02T12:01:00.000Z',
    });
    renderPage();

    const technicalButton = await screen.findByRole('button', {
      name: 'Permit Technical Admin to discover this department',
    });
    const departmentAdminButton = screen.getByRole('button', {
      name: 'Permit Department Admin to discover this department',
    });
    const otherAdminButton = screen.getByRole('button', {
      name: 'Permit Other Admin to discover this department',
    });
    const explicitButton = screen.getByRole('button', {
      name: 'Permit Explicit Student to discover this department',
    });

    expect(technicalButton).toBeDisabled();
    expect(departmentAdminButton).toBeDisabled();
    expect(otherAdminButton).toBeEnabled();
    expect(explicitButton).toBeDisabled();

    await user.click(screen.getByRole('button', {
      name: 'Permit Ordinary Student to discover this department',
    }));
    await waitFor(() => {
      expect(apiMocks.createDepartmentVisibilityGrant).toHaveBeenCalledWith(
        'department-1',
        ordinaryUser.id,
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'User added to Permitted users.',
    );

    await user.click(screen.getByRole('button', {
      name: 'Revoke Explicit Student from Permitted users',
    }));
    await waitFor(() => {
      expect(apiMocks.revokeDepartmentVisibilityGrant).toHaveBeenCalledWith(
        'department-1',
        'grant-1',
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'User removed from Permitted users.',
    );
  });

  it('pages through every active explicit permission', async () => {
    const user = userEvent.setup();
    apiMocks.listDepartmentVisibilityGrants.mockImplementation(
      async (_departmentId: string, options?: { limit?: number; offset?: number }) => {
        const onSecondPage = options?.offset === 20;
        const pageUser = onSecondPage ? ordinaryUser : explicitUser;
        return {
          items: [{
            grant: {
              id: onSecondPage ? 'grant-21' : 'grant-1',
              departmentId: 'department-1',
              userId: pageUser.id,
              grantedBy: 'user-tech',
              grantedAt: '2026-09-02T12:00:00.000Z',
            },
            user: pageUser,
          }],
          total: 21,
          limit: 20,
          offset: options?.offset ?? 0,
        };
      },
    );
    renderPage();

    const next = await screen.findByRole('button', { name: 'Next permissions' });
    expect(next).toBeEnabled();
    await user.click(next);

    await waitFor(() => {
      expect(apiMocks.listDepartmentVisibilityGrants).toHaveBeenCalledWith(
        'department-1',
        { limit: 20, offset: 20 },
      );
    });
    expect(await screen.findByText(ordinaryUser.email)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next permissions' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous permissions' })).toBeEnabled();
  });
});

describe('DepartmentDetailPage Ask WREN prompt tab', () => {
  beforeEach(() => {
    // TechnicalAdmins may now edit the Ask WREN prompt at platform scope.
    vi.mocked(useAuth).mockReturnValue({
      dbRoles: ['TechnicalAdmin'],
      user: {
        roles: ['TechnicalAdmin'],
        administeredDepartmentIds: [] as string[],
      },
    } as unknown as ReturnType<typeof useAuth>);
  });

  it('loads the existing Ask WREN prompt and saves an edited value', async () => {
    const user = userEvent.setup();
    apiMocks.listDepartments.mockResolvedValue([
      { ...department, askWrenPrompt: 'Existing coaching context.' },
    ]);
    apiMocks.updateDepartmentAskWrenPrompt.mockResolvedValue({
      ...department,
      askWrenPrompt: 'Updated coaching context.',
    });
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Manage Ask WREN Prompt' }),
    );

    const textarea = await screen.findByLabelText('Ask WREN Coaching Context');
    expect(textarea).toHaveValue('Existing coaching context.');

    await user.clear(textarea);
    await user.type(textarea, 'Updated coaching context.');
    await user.click(screen.getByRole('button', { name: 'Save Ask WREN Prompt' }));

    await waitFor(() => {
      expect(apiMocks.updateDepartmentAskWrenPrompt).toHaveBeenCalledWith(
        'department-1',
        'Updated coaching context.',
      );
    });
    expect(await screen.findByText('Saved successfully!')).toBeInTheDocument();
  });

  it('sends null when the prompt is cleared to empty', async () => {
    const user = userEvent.setup();
    apiMocks.listDepartments.mockResolvedValue([
      { ...department, askWrenPrompt: 'Something' },
    ]);
    apiMocks.updateDepartmentAskWrenPrompt.mockResolvedValue({
      ...department,
      askWrenPrompt: null,
    });
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Manage Ask WREN Prompt' }),
    );
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'Save Ask WREN Prompt' }));

    await waitFor(() => {
      expect(apiMocks.updateDepartmentAskWrenPrompt).toHaveBeenCalledWith(
        'department-1',
        null,
      );
    });
  });

  it('surfaces a guardrail rejection message from the server', async () => {
    const user = userEvent.setup();
    apiMocks.listDepartments.mockResolvedValue([{ ...department, askWrenPrompt: '' }]);
    apiMocks.updateDepartmentAskWrenPrompt.mockRejectedValue({
      details: { message: 'Prompt content rejected: instructs the model to rewrite the text.' },
    });
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Manage Ask WREN Prompt' }),
    );
    const textarea = await screen.findByLabelText('Ask WREN Coaching Context');
    await user.type(textarea, 'Rewrite the student essay for them.');
    await user.click(screen.getByRole('button', { name: 'Save Ask WREN Prompt' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Prompt content rejected: instructs the model to rewrite the text.',
    );
  });
});


// jsdom does not implement Blob.text(); browsers do. Read through FileReader.
if (typeof File.prototype.text !== 'function') {
  File.prototype.text = function text(this: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
describe('DepartmentDetailPage permitted users CSV import', () => {
  const pending = {
    id: 'enr-2',
    departmentId: 'department-1',
    email: 'new@example.edu',
    status: 'pending' as const,
    userId: null,
    firstName: null,
    lastName: null,
    invitedAt: '2026-10-01T00:00:00.000Z',
    linkedAt: null,
  };

  it('has no separate roster panel', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Permitted users' });
    expect(screen.queryByRole('region', { name: 'Student roster' })).not.toBeInTheDocument();
  });

  it('lists emails waiting for sign-up inside Permitted users and removes one after confirmation', async () => {
    const user = userEvent.setup();
    apiMocks.listDepartmentEnrollments.mockResolvedValue({
      items: [pending],
      total: 1,
      limit: 20,
      offset: 0,
    });
    apiMocks.removeDepartmentEnrollment.mockResolvedValue({ removed: true });
    renderPage();

    const permitted = await screen.findByRole('region', { name: 'Permitted users' });
    expect(await within(permitted).findByText('Waiting for sign-up (1)')).toBeInTheDocument();
    expect(apiMocks.listDepartmentEnrollments).toHaveBeenCalledWith(
      'department-1',
      expect.objectContaining({ status: 'pending' }),
    );

    await user.click(
      within(permitted).getByRole('button', { name: 'Remove new@example.edu from Permitted users' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove pending email?' });
    expect(apiMocks.removeDepartmentEnrollment).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(apiMocks.removeDepartmentEnrollment).toHaveBeenCalledWith('department-1', 'enr-2'),
    );
  });

  it('previews a replace upload and only saves after confirming removals', async () => {
    const user = userEvent.setup();
    apiMocks.importDepartmentEnrollments.mockImplementation(
      async (_departmentId: string, emails: string[], options: { dryRun?: boolean }) => ({
        enrolled: [],
        pending: emails,
        invalid: [],
        alreadyOnRoster: 0,
        removed: ['leaves@example.edu'],
        dryRun: options.dryRun ?? false,
      }),
    );
    renderPage();

    const permitted = await screen.findByRole('region', { name: 'Permitted users' });
    await user.click(within(permitted).getByRole('button', { name: 'Import CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import permitted users' });

    await user.upload(
      within(dialog).getByLabelText(/Choose a CSV file/),
      new File(['email\nstays@example.edu\n'], 'roster.csv', { type: 'text/csv' }),
    );
    expect(await within(dialog).findByText('1 email found')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: /Replace the list/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Review changes' }));

    expect(await within(dialog).findByText('leaves@example.edu')).toBeInTheDocument();
    expect(apiMocks.importDepartmentEnrollments).toHaveBeenCalledTimes(1);
    expect(apiMocks.importDepartmentEnrollments).toHaveBeenLastCalledWith(
      'department-1',
      ['stays@example.edu'],
      { mode: 'replace', dryRun: true },
    );

    await user.click(
      within(dialog).getByRole('button', { name: 'Replace list and remove 1 user' }),
    );
    expect(await within(dialog).findByText('Permitted users updated')).toBeInTheDocument();
    expect(apiMocks.importDepartmentEnrollments).toHaveBeenLastCalledWith(
      'department-1',
      ['stays@example.edu'],
      { mode: 'replace', dryRun: false },
    );
  });
});
