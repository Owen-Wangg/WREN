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
  setDepartmentAccessState: vi.fn(),
  getAnalyticsSummary: vi.fn(),
  deleteDepartment: vi.fn(),
  setDepartmentVisibilityState: vi.fn(),
  listDepartmentVisibilityGrants: vi.fn(),
  createDepartmentVisibilityGrant: vi.fn(),
  revokeDepartmentVisibilityGrant: vi.fn(),
  searchAllUsers: vi.fn(),
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
      'Visibility permission granted.',
    );

    await user.click(screen.getByRole('button', {
      name: "Revoke Explicit Student's explicit department visibility permission",
    }));
    await waitFor(() => {
      expect(apiMocks.revokeDepartmentVisibilityGrant).toHaveBeenCalledWith(
        'department-1',
        'grant-1',
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Visibility permission revoked.',
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
