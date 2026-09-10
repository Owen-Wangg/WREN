import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizationAccess } from '@/features/dashboard/dashboardTypes';
import { useAuth } from '@/features/auth/AuthContext';
import {
  useDocumentTypes,
  useMetadataFields,
  useOrganizations,
} from '@/features/dashboard/useDashboard';
import { useUploadConfig } from '@/hooks/useUploadConfig';
import { NewDocumentPage } from './NewDocumentPage';

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/features/dashboard/useDashboard', () => ({
  useDocumentTypes: vi.fn(),
  useMetadataFields: vi.fn(),
  useOrganizations: vi.fn(),
}));
vi.mock('@/hooks/useUploadConfig', () => ({ useUploadConfig: vi.fn() }));

const visibleTestDepartment: OrganizationAccess = {
  id: 'department-test',
  name: 'Test Department',
  accessState: 'OPEN',
  viewerCanDiscover: true,
};
const hiddenAdministered: OrganizationAccess = {
  id: 'department-administered',
  name: 'Administered Hidden Department',
  accessState: 'LOCKED',
  viewerCanDiscover: false,
};
const hiddenOther: OrganizationAccess = {
  id: 'department-hidden',
  name: 'Other Hidden Department',
  accessState: 'OPEN',
  viewerCanDiscover: false,
};

let organizations: OrganizationAccess[];

function queryResult<T>(data: T) {
  return {
    data,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useOrganizations>;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NewDocumentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  organizations = [visibleTestDepartment, hiddenAdministered, hiddenOther];
  vi.mocked(useAuth).mockReturnValue({
    dbRoles: ['Student'],
    activeRole: 'Student',
    user: {
      userId: 'student-1',
      email: 'student@example.com',
      firstName: 'Student',
      lastName: 'User',
      roles: ['Student'],
      administeredDepartmentIds: [],
    },
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(useOrganizations).mockImplementation(() => queryResult(organizations));
  vi.mocked(useDocumentTypes).mockImplementation((departmentId) => ({
    data: departmentId
      ? [{
          id: 'document-type-1',
          organizationId: departmentId,
          name: 'Memo',
          accessState: 'OPEN',
          sizeLimitWords: null,
        }]
      : [],
    isLoading: false,
    isError: false,
  }) as unknown as ReturnType<typeof useDocumentTypes>);
  vi.mocked(useMetadataFields).mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useMetadataFields>);
  vi.mocked(useUploadConfig).mockReturnValue({ data: undefined } as ReturnType<typeof useUploadConfig>);
});

describe('NewDocumentPage department discovery', () => {
  it('shows a discoverable Test Department and hides a denied department for a student', () => {
    renderPage();

    expect(screen.getByRole('option', { name: 'Test Department' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Other Hidden Department' })).not.toBeInTheDocument();
  });

  it('uses database TechnicalAdmin roles even while the active persona is Student', () => {
    vi.mocked(useAuth).mockReturnValue({
      dbRoles: ['TechnicalAdmin', 'Student'],
      activeRole: 'Student',
      user: {
        userId: 'admin-1',
        email: 'admin@example.com',
        firstName: 'Technical',
        lastName: 'Admin',
        roles: ['TechnicalAdmin', 'Student'],
        administeredDepartmentIds: [],
      },
    } as unknown as ReturnType<typeof useAuth>);

    renderPage();

    expect(screen.getByRole('option', { name: 'Other Hidden Department' })).toBeInTheDocument();
  });

  it('bypasses visibility only for the DepartmentAdmin appointed department', () => {
    vi.mocked(useAuth).mockReturnValue({
      dbRoles: ['DepartmentAdmin', 'Student'],
      activeRole: 'Student',
      user: {
        userId: 'department-admin-1',
        email: 'department-admin@example.com',
        firstName: 'Department',
        lastName: 'Admin',
        roles: ['DepartmentAdmin', 'Student'],
        administeredDepartmentIds: [hiddenAdministered.id],
      },
    } as unknown as ReturnType<typeof useAuth>);

    renderPage();

    expect(screen.getByRole('option', { name: hiddenAdministered.name })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: hiddenOther.name })).not.toBeInTheDocument();
  });

  it('clears dependent selection when a refresh removes the selected department', async () => {
    const user = userEvent.setup();
    const view = renderPage();

    const departmentSelect = screen.getByRole('combobox', { name: 'Department' });
    await user.selectOptions(departmentSelect, visibleTestDepartment.id);
    const documentTypeSelect = await screen.findByRole('combobox', { name: 'Document Type' });
    await user.selectOptions(documentTypeSelect, 'document-type-1');
    expect(screen.getByRole('textbox', { name: 'Document Name' })).toBeInTheDocument();

    organizations = [hiddenOther];
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <NewDocumentPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(departmentSelect).toHaveValue(''));
    expect(screen.queryByRole('combobox', { name: 'Document Type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Document Name' })).not.toBeInTheDocument();
  });
});
