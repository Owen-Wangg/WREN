import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Department, UserSummary } from '@wren/types';
import { useAuth } from '@/features/auth/AuthContext';

/** Extracts a user-facing message from an API error response when available. */
function getServerErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'details' in error) {
    const details = (error as { details?: unknown }).details;
    if (details && typeof details === 'object' && 'message' in details) {
      const msg = (details as { message?: unknown }).message;
      if (typeof msg === 'string' && msg.trim()) return msg;
    }
  }
  return fallback;
}
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Edit2, Trash2, X } from 'lucide-react';
import { purgeDeletedCatalogCaches } from '@/hooks/purgeDeletedCatalog';
import {
  assignRole,
  createDepartmentVisibilityGrant,
  deleteDepartment,
  departmentRosterQueryKey,
  getAnalyticsSummary,
  getDepartmentUsers,
  listDepartmentVisibilityGrants,
  revokeDepartmentVisibilityGrant,
  revokeRole,
  searchAllUsers,
  setDepartmentAccessState,
  setDepartmentVisibilityState,
  updateDepartmentPrompt,
  updateDepartmentAskWrenPrompt,
} from '@/features/system-admin/systemAdminApi';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { systemAdminApi } from '@/features/system-admin/systemAdminApi';
import { DepartmentPromptEditor } from '@/features/department-admin/DepartmentPromptEditor';
import { DepartmentRosterSection } from '@/features/system-admin/components/DepartmentRosterSection';
import { ImportStudentsDialog } from '@/features/system-admin/components/ImportStudentsDialog';

interface EditingUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles?: string[];
  administeredDepartmentIds?: string[];
}

const ASSIGNABLE_ROLES = ['Student', 'DepartmentAdmin', 'TechnicalAdmin'] as const;
const PERMISSION_PAGE_SIZE = 20;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Roles to show/edit on a department screen — DepartmentAdmin only if for THIS dept. */
function rolesForDepartmentView(
  user: {
    id: string;
    roles?: readonly string[];
    administeredDepartmentIds?: readonly string[];
  },
  departmentId: string,
): AssignableRole[] {
  const selected: AssignableRole[] = [];
  const roles = user.roles ?? [];
  if (roles.includes('Student')) selected.push('Student');
  if (roles.includes('TechnicalAdmin')) selected.push('TechnicalAdmin');
  const adminDepts = user.administeredDepartmentIds ?? [];
  if (adminDepts.includes(departmentId)) selected.push('DepartmentAdmin');
  return selected;
}

function formatRolesForDepartment(
  user: {
    id: string;
    roles?: readonly string[];
    administeredDepartmentIds?: readonly string[];
  },
  departmentId: string,
): string {
  const labels = rolesForDepartmentView(user, departmentId);
  return labels.length > 0 ? labels.join(', ') : '—';
}

function automaticVisibilityLabel(
  user: Pick<UserSummary, 'roles' | 'administeredDepartmentIds'>,
  departmentId: string,
): string | null {
  if (user.roles.includes('TechnicalAdmin')) {
    return 'Automatic access — Technical Admin';
  }
  if (user.administeredDepartmentIds.includes(departmentId)) {
    return 'Automatic access — Department Admin for this department';
  }
  return null;
}

export function DepartmentDetailPage() {
  const { departmentId } = useParams();
  const navigate = useNavigate();
  const { dbRoles, user } = useAuth();
  const canManageVisibility = dbRoles.includes('TechnicalAdmin');
  // Ask WREN prompt editing is a shared capability: TechnicalAdmins (platform
  // scope) and DepartmentAdmins appointed to this department.
  const canManageAskWrenPrompt = Boolean(
    dbRoles.includes('TechnicalAdmin') ||
    (departmentId &&
      dbRoles.includes('DepartmentAdmin') &&
      user?.administeredDepartmentIds.includes(departmentId)),
  );
  const [activeTab, setActiveTab] = useState<'users' | 'prompt' | 'ask-wren' | 'analytics'>('users');
  const [editingUser, setEditingUser] = useState<EditingUser | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<AssignableRole[]>([]);
  /** Snapshot of dept-scoped roles when the modal opened — used for assign/revoke diffs. */
  const [rolesAtOpen, setRolesAtOpen] = useState<AssignableRole[]>([]);
  const [roleSaveError, setRoleSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [visibilityConfirmOpen, setVisibilityConfirmOpen] = useState(false);
  const [importStudentsOpen, setImportStudentsOpen] = useState(false);
  const [visibilityStatus, setVisibilityStatus] = useState<string | null>(null);
  const visibilityToggleRef = useRef<HTMLButtonElement>(null);
  const visibilityCancelRef = useRef<HTMLButtonElement>(null);

  const deleteMutation = useMutation({
    mutationFn: () => deleteDepartment(departmentId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system-departments'] });
      void purgeDeletedCatalogCaches(queryClient);
      navigate('/system-admin');
    },
  });

  const { data: departments = [], isLoading: departmentsLoading } = useQuery({
    queryKey: ['system-departments'],
    queryFn: () => systemAdminApi.listDepartments(),
  });

  const department = (departments as Department[]).find((d) => d.id === departmentId);
  const isLocked = department?.accessState === 'LOCKED';
  const isPermittedOnly = department?.visibilityState === 'PERMITTED_ONLY';
  const departmentPrompt = department?.prompt;
  const departmentAskWrenPrompt = department?.askWrenPrompt;

  const { data: analyticsSummary } = useQuery({
    queryKey: ['department-analytics-summary', departmentId],
    queryFn: () => getAnalyticsSummary(departmentId),
    enabled: activeTab === 'analytics',
  });

  const [userSearch, setUserSearch] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [debouncedPermissionSearch, setDebouncedPermissionSearch] = useState('');
  const [permissionOffset, setPermissionOffset] = useState(0);
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedPermissionSearch(permissionSearch.trim()),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [permissionSearch]);

  const directorySearchPending = permissionSearch.trim() !== debouncedPermissionSearch;

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['department-users', departmentId, userSearch],
    queryFn: () => getDepartmentUsers(departmentId!, { q: userSearch || undefined }),
    enabled: activeTab === 'users',
  });

  const directoryQuery = useQuery({
    queryKey: ['system-users', 'visibility-permission-search', debouncedPermissionSearch],
    queryFn: () => searchAllUsers({ q: debouncedPermissionSearch || undefined }),
    enabled: activeTab === 'users' && canManageVisibility && Boolean(departmentId),
  });

  const permissionsQuery = useQuery({
    queryKey: ['department-visibility-grants', departmentId, permissionOffset],
    queryFn: () => listDepartmentVisibilityGrants(departmentId!, {
      limit: PERMISSION_PAGE_SIZE,
      offset: permissionOffset,
    }),
    enabled: activeTab === 'users' && canManageVisibility && Boolean(departmentId),
  });

  const explicitlyPermittedUserIds = useMemo(
    () => new Set((permissionsQuery.data?.items ?? []).map((item) => item.user.id)),
    [permissionsQuery.data?.items],
  );

  const assignMutation = useMutation({
    mutationFn: async ({
      userId,
      nextRoles,
      previousRoles,
    }: {
      userId: string;
      nextRoles: AssignableRole[];
      previousRoles: AssignableRole[];
    }) => {
      // previousRoles is already scoped for this department (DepartmentAdmin only
      // if appointed here). Diffing against it assigns/revokes only this dept.
      const prev = new Set(previousRoles);
      const next = new Set(nextRoles);
      const toAdd = nextRoles.filter((role) => !prev.has(role));
      const toRemove = previousRoles.filter((role) => !next.has(role));

      for (const role of toAdd) {
        await assignRole({
          userId,
          role,
          ...(role === 'DepartmentAdmin' ? { departmentId: departmentId! } : {}),
        });
      }
      for (const role of toRemove) {
        await revokeRole({
          userId,
          role,
          ...(role === 'DepartmentAdmin' ? { departmentId: departmentId! } : {}),
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['department-users', departmentId] });
      void queryClient.invalidateQueries({ queryKey: ['system-users'] });
      void queryClient.invalidateQueries({ queryKey: ['department-visibility-grants', departmentId] });
      setEditingUser(null);
      setSelectedRoles([]);
      setRolesAtOpen([]);
      setRoleSaveError(null);
    },
    onError: (error) => {
      // Surface the server's reason (e.g. the first System Admin cannot be
      // demoted) and refresh, since earlier assign/revoke calls may have applied.
      setRoleSaveError(
        getServerErrorMessage(error, 'Failed to update roles. Please try again.'),
      );
      void queryClient.invalidateQueries({ queryKey: ['department-users', departmentId] });
      void queryClient.invalidateQueries({ queryKey: ['system-users'] });
    },
  });

  // Department-level Ask WREN coaching prompt (department.askWrenPrompt).
  // Free-text; initialized once from the loaded department.
  const [askWrenPromptText, setAskWrenPromptText] = useState('');
  const [askWrenInitialized, setAskWrenInitialized] = useState(false);

  useEffect(() => {
    if (askWrenInitialized) return;
    if (departmentAskWrenPrompt === undefined) return;
    setAskWrenPromptText(departmentAskWrenPrompt ?? '');
    setAskWrenInitialized(true);
  }, [departmentAskWrenPrompt, askWrenInitialized]);

  const askWrenPromptMutation = useMutation({
    mutationFn: (text: string) =>
      updateDepartmentAskWrenPrompt(departmentId!, text.trim() ? text : null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system-departments'] });
    },
  });

  const accessMutation = useMutation({
    mutationFn: (accessState: 'OPEN' | 'LOCKED') =>
      setDepartmentAccessState(departmentId!, accessState),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system-departments'] });
    },
  });

  const visibilityMutation = useMutation({
    mutationFn: (visibilityState: 'VISIBLE' | 'PERMITTED_ONLY') =>
      setDepartmentVisibilityState(departmentId!, visibilityState),
    onSuccess: (updatedDepartment, visibilityState) => {
      queryClient.setQueryData<Department[]>(['system-departments'], (current) =>
        current?.map((item) =>
          item.id === updatedDepartment.id ? updatedDepartment : item,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ['system-departments'] });
      setVisibilityStatus(
        visibilityState === 'PERMITTED_ONLY'
          ? 'Department visibility is now limited to permitted users.'
          : 'Department is now visible to all students.',
      );
      if (visibilityState === 'PERMITTED_ONLY') setVisibilityConfirmOpen(false);
    },
  });

  const grantVisibilityMutation = useMutation({
    mutationFn: (userId: string) =>
      createDepartmentVisibilityGrant(departmentId!, userId),
    onSuccess: () => {
      setPermissionStatus('Visibility permission granted.');
      setPermissionOffset(0);
      void queryClient.invalidateQueries({
        queryKey: ['department-visibility-grants', departmentId],
      });
    },
  });

  const revokeVisibilityMutation = useMutation({
    mutationFn: (grantId: string) =>
      revokeDepartmentVisibilityGrant(departmentId!, grantId),
    onSuccess: () => {
      setPermissionStatus('Visibility permission revoked.');
      if ((permissionsQuery.data?.items.length ?? 0) === 1 && permissionOffset > 0) {
        setPermissionOffset(Math.max(0, permissionOffset - PERMISSION_PAGE_SIZE));
      }
      void queryClient.invalidateQueries({
        queryKey: ['department-visibility-grants', departmentId],
      });
    },
  });

  function requestVisibilityChange() {
    visibilityMutation.reset();
    setVisibilityStatus(null);
    if (isPermittedOnly) {
      visibilityMutation.mutate('VISIBLE');
    } else {
      setVisibilityConfirmOpen(true);
    }
  }

  function grantVisibility(user: UserSummary) {
    if (!departmentId) return;
    if (automaticVisibilityLabel(user, departmentId)) return;
    if (explicitlyPermittedUserIds.has(user.id)) return;
    setPermissionStatus(null);
    grantVisibilityMutation.reset();
    grantVisibilityMutation.mutate(user.id);
  }

  function openEditModal(user: EditingUser) {
    if (!departmentId) return;
    setEditingUser(user);
    setRoleSaveError(null);
    const initial = rolesForDepartmentView(user, departmentId);
    setSelectedRoles(initial);
    setRolesAtOpen(initial);
  }

  function closeEditModal() {
    setEditingUser(null);
    setSelectedRoles([]);
    setRolesAtOpen([]);
    setRoleSaveError(null);
  }

  function toggleRole(role: AssignableRole) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-gray-100 border-r border-gray-200 flex flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            <button
              onClick={() => navigate('/system-admin')}
              className="mb-6 flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-gray-900"
            >
              <ChevronLeft size={18} />
              Back
            </button>

            <h2 className="mb-6 text-lg font-bold text-gray-900">{department?.name}</h2>

            <div className="mb-6 rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">Student access</p>
                  <p className="text-xs text-gray-500">
                    {isLocked
                      ? 'Locked — students need a grant for document types in this department'
                      : 'Open — no document-type Access Grant is required; catalog visibility is separate'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!departmentId || accessMutation.isPending}
                  onClick={() => accessMutation.mutate(isLocked ? 'OPEN' : 'LOCKED')}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                    isLocked
                      ? 'bg-gray-900 text-white hover:bg-gray-800'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                  } disabled:opacity-50`}
                >
                  {accessMutation.isPending ? 'Saving…' : isLocked ? 'Open' : 'Lock'}
                </button>
              </div>
              {accessMutation.isError && (
                <p className="mt-2 text-xs text-red-600">Failed to update access. Try again.</p>
              )}
            </div>

            {canManageVisibility && (
              <div className="mb-6 rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Department visibility</p>
                    <p className="text-xs text-gray-500">
                      {isPermittedOnly
                        ? 'Permitted users only — hidden from other students in catalog views'
                        : 'Visible — shown to all students in catalog views'}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Submission access remains controlled independently by Open or Locked.
                    </p>
                  </div>
                  <button
                    ref={visibilityToggleRef}
                    type="button"
                    aria-label={isPermittedOnly ? 'Make department visible to all students' : 'Limit department visibility to permitted users'}
                    aria-busy={visibilityMutation.isPending}
                    disabled={!departmentId || !department || departmentsLoading || visibilityMutation.isPending}
                    onClick={requestVisibilityChange}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      isPermittedOnly
                        ? 'bg-gray-900 text-white hover:bg-gray-800'
                        : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                    } disabled:opacity-50`}
                  >
                    {visibilityMutation.isPending && !visibilityConfirmOpen
                      ? 'Saving…'
                      : isPermittedOnly
                        ? 'Make visible'
                        : 'Limit visibility'}
                  </button>
                </div>
                {visibilityMutation.isError && !visibilityConfirmOpen && (
                  <p role="alert" className="mt-2 text-xs text-red-600">
                    {getServerErrorMessage(
                      visibilityMutation.error,
                      'Failed to update visibility. Please try again.',
                    )}
                  </p>
                )}
                {visibilityStatus && (
                  <p role="status" className="mt-2 text-xs text-green-700">
                    {visibilityStatus}
                  </p>
                )}
              </div>
            )}

            <div className="mb-6">
              <p className="mb-2 text-xs font-semibold uppercase text-gray-600">Actions</p>
              <nav className="space-y-1">
                <button
                  onClick={() => setActiveTab('users')}
                  className={`block w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition ${
                    activeTab === 'users'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Manage Users
                </button>

                <button
                  onClick={() => setActiveTab('prompt')}
                  className={`block w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition ${
                    activeTab === 'prompt'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Manage Department Prompt
                </button>

                {canManageAskWrenPrompt && (
                  <button
                    onClick={() => setActiveTab('ask-wren')}
                    className={`block w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition ${
                      activeTab === 'ask-wren'
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Manage Ask WREN Prompt
                  </button>
                )}

                <button
                  onClick={() => setActiveTab('analytics')}
                  className={`block w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition ${
                    activeTab === 'analytics'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  View Analytics
                </button>
              </nav>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">
            Department: {department?.name}
          </h1>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
          >
            <Trash2 className="h-4 w-4" />
            Delete department
          </button>
        </div>

        {/* Delete confirmation modal */}
        {showDeleteConfirm && (() => {
          const hasDocuments = (department?.activeUserCount ?? 0) > 0;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
                <h2 className="text-lg font-semibold text-gray-900">Delete department?</h2>

                <p className="mt-2 text-sm text-gray-600">
                  <strong>{department?.name}</strong> will be permanently deleted, along with all of its document types and every student document, draft, and piece of feedback in them. Department Admin appointments for it are removed. This cannot be undone.
                </p>
                {hasDocuments && (
                  <p className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    This department has active student submissions. Their work will be deleted too.
                  </p>
                )}

                {deleteMutation.isError && (
                  <p role="alert" className="mt-3 text-sm text-red-600">
                    {getServerErrorMessage(deleteMutation.error, 'Failed to delete department. Please try again.')}
                  </p>
                )}

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => { setShowDeleteConfirm(false); deleteMutation.reset(); }}
                    disabled={deleteMutation.isPending}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? 'Deleting…' : 'Yes, delete'}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-8">
          {/* Manage Users Tab */}
          {activeTab === 'users' && (
            <div>
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-3xl font-bold text-gray-900">Manage Users</h2>
              </div>

              {canManageVisibility && departmentId && (
                <DepartmentRosterSection
                  departmentId={departmentId}
                  departmentName={department?.name}
                  onImport={() => setImportStudentsOpen(true)}
                />
              )}

              {canManageVisibility && departmentId && (
                <section
                  aria-labelledby="permitted-users-heading"
                  className="mb-8 rounded-lg border border-gray-200 bg-white p-6"
                >
                  <h3 id="permitted-users-heading" className="text-xl font-semibold text-gray-900">
                    Permitted users
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Explicit permissions are retained in both visibility modes and take effect when
                    this department is set to Permitted users only. Technical Admins and appointed
                    Department Admins can always discover it automatically.
                  </p>
                  {!isPermittedOnly && (
                    <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      This department is currently visible to all students. These permissions will be
                      used if visibility is limited later.
                    </p>
                  )}

                  <div className="mt-5 grid gap-6 xl:grid-cols-2">
                    <div>
                      <label
                        htmlFor="visibility-user-search"
                        className="block text-sm font-semibold text-gray-900"
                      >
                        Find a user
                      </label>
                      <input
                        id="visibility-user-search"
                        type="search"
                        value={permissionSearch}
                        onChange={(event) => {
                          setPermissionSearch(event.target.value);
                          setPermissionStatus(null);
                          grantVisibilityMutation.reset();
                        }}
                        placeholder="Search by first name or email"
                        className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                      />

                      <div
                        className="mt-3 rounded-lg border border-gray-200"
                        aria-busy={directorySearchPending || directoryQuery.isLoading}
                      >
                        {directorySearchPending && (
                          <p role="status" className="p-4 text-sm text-gray-600">
                            Updating search results…
                          </p>
                        )}
                        {!directorySearchPending && directoryQuery.isLoading && (
                          <p role="status" className="p-4 text-sm text-gray-600">Loading user directory…</p>
                        )}
                        {!directorySearchPending && directoryQuery.isError && (
                          <div className="p-4 text-sm">
                            <p role="alert" className="text-red-600">Could not load the user directory.</p>
                            <button
                              type="button"
                              onClick={() => void directoryQuery.refetch()}
                              className="mt-2 font-semibold text-gray-900 underline"
                            >
                              Retry user search
                            </button>
                          </div>
                        )}
                        {!directorySearchPending && directoryQuery.isSuccess && directoryQuery.data.items.length === 0 && (
                          <p className="p-4 text-sm text-gray-500">No users match this search.</p>
                        )}
                        {!directorySearchPending && directoryQuery.isSuccess && directoryQuery.data.items.map((user) => {
                          const automaticLabel = automaticVisibilityLabel(user, departmentId);
                          const isExplicit = explicitlyPermittedUserIds.has(user.id);
                          const isGranting =
                            grantVisibilityMutation.isPending &&
                            grantVisibilityMutation.variables === user.id;
                          return (
                            <div
                              key={user.id}
                              className="flex items-center justify-between gap-3 border-b border-gray-100 p-3 last:border-b-0"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {user.firstName} {user.lastName}
                                </p>
                                <p className="truncate text-xs text-gray-500">{user.email}</p>
                                {(automaticLabel || isExplicit) && (
                                  <p className="mt-1 text-xs font-medium text-gray-700">
                                    {automaticLabel ?? 'Explicitly permitted'}
                                  </p>
                                )}
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditModal(user)}
                                  disabled={assignMutation.isPending}
                                  aria-label={`Edit roles for ${user.firstName} ${user.lastName}`}
                                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                >
                                  Edit roles
                                </button>
                                <button
                                  type="button"
                                  onClick={() => grantVisibility(user)}
                                  disabled={
                                    Boolean(automaticLabel) ||
                                    isExplicit ||
                                    directorySearchPending ||
                                    grantVisibilityMutation.isPending ||
                                    revokeVisibilityMutation.isPending
                                  }
                                  aria-label={`Permit ${user.firstName} ${user.lastName} to discover this department`}
                                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-600"
                                >
                                  {isGranting
                                    ? 'Granting…'
                                    : automaticLabel
                                      ? 'Automatic'
                                      : isExplicit
                                        ? 'Permitted'
                                        : 'Grant'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {grantVisibilityMutation.isError && (
                        <p role="alert" className="mt-2 text-sm text-red-600">
                          {getServerErrorMessage(
                            grantVisibilityMutation.error,
                            'Failed to grant visibility. Please try again.',
                          )}
                        </p>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Active explicit permissions</h4>
                      <div className="mt-2 rounded-lg border border-gray-200">
                        {permissionsQuery.isLoading && (
                          <p role="status" className="p-4 text-sm text-gray-600">Loading permissions…</p>
                        )}
                        {permissionsQuery.isError && (
                          <div className="p-4 text-sm">
                            <p role="alert" className="text-red-600">Could not load permitted users.</p>
                            <button
                              type="button"
                              onClick={() => void permissionsQuery.refetch()}
                              className="mt-2 font-semibold text-gray-900 underline"
                            >
                              Retry permissions
                            </button>
                          </div>
                        )}
                        {permissionsQuery.isSuccess && permissionsQuery.data.items.length === 0 && (
                          <p className="p-4 text-sm text-gray-500">No explicit permitted users.</p>
                        )}
                        {permissionsQuery.isSuccess && permissionsQuery.data.items.map((permission) => {
                          const automaticLabel = automaticVisibilityLabel(permission.user, departmentId);
                          const isRevoking =
                            revokeVisibilityMutation.isPending &&
                            revokeVisibilityMutation.variables === permission.grant.id;
                          return (
                            <div
                              key={permission.grant.id}
                              className="flex items-center justify-between gap-3 border-b border-gray-100 p-3 last:border-b-0"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">
                                  {permission.user.firstName} {permission.user.lastName}
                                </p>
                                <p className="truncate text-xs text-gray-500">{permission.user.email}</p>
                                {automaticLabel && (
                                  <p className="mt-1 text-xs text-gray-600">
                                    {automaticLabel}; revoking this explicit permission will not remove automatic access.
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setPermissionStatus(null);
                                  revokeVisibilityMutation.reset();
                                  revokeVisibilityMutation.mutate(permission.grant.id);
                                }}
                                disabled={
                                  revokeVisibilityMutation.isPending ||
                                  grantVisibilityMutation.isPending
                                }
                                aria-label={`Revoke ${permission.user.firstName} ${permission.user.lastName}'s explicit department visibility permission`}
                                className="shrink-0 rounded-md border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                              >
                                {isRevoking ? 'Revoking…' : 'Revoke'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {permissionsQuery.isSuccess && permissionsQuery.data.total > 0 && (
                        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-600">
                          <span>
                            Showing {permissionOffset + 1}–{Math.min(
                              permissionOffset + permissionsQuery.data.items.length,
                              permissionsQuery.data.total,
                            )} of {permissionsQuery.data.total}
                          </span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setPermissionOffset((current) =>
                                Math.max(0, current - PERMISSION_PAGE_SIZE),
                              )}
                              disabled={permissionOffset === 0 || permissionsQuery.isFetching}
                              className="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-700 disabled:opacity-50"
                            >
                              Previous permissions
                            </button>
                            <button
                              type="button"
                              onClick={() => setPermissionOffset((current) =>
                                current + PERMISSION_PAGE_SIZE,
                              )}
                              disabled={
                                permissionOffset + permissionsQuery.data.items.length >=
                                  permissionsQuery.data.total ||
                                permissionsQuery.isFetching
                              }
                              className="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-700 disabled:opacity-50"
                            >
                              Next permissions
                            </button>
                          </div>
                        </div>
                      )}
                      {revokeVisibilityMutation.isError && (
                        <p role="alert" className="mt-2 text-sm text-red-600">
                          {getServerErrorMessage(
                            revokeVisibilityMutation.error,
                            'Failed to revoke visibility. Please try again.',
                          )}
                        </p>
                      )}
                      {permissionStatus && (
                        <p role="status" className="mt-2 text-sm text-green-700">
                          {permissionStatus}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}

              <h3 className="mb-3 text-xl font-semibold text-gray-900">Department participants</h3>

              {/* Search and Filter */}
              <div className="mb-6 flex gap-4">
                <input
                  type="text"
                  placeholder="Search by First Name, Last Name, or Email"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
                <select className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900">
                  <option>All Roles</option>
                </select>
              </div>

              {/* Users Table */}
              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden mb-8">
                {usersLoading ? (
                  <div className="px-6 py-4 text-sm text-gray-600">Loading users...</div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Name</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Email</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Role</th>
                        <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(usersData?.items ?? []).map((user) => (
                        <tr key={user.id} className="border-b border-gray-200 hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-900">{user.firstName} {user.lastName}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                          <td className="px-6 py-4 text-sm text-gray-900">
                            {formatRolesForDepartment(user, departmentId!)}
                          </td>
                          <td className="px-6 py-4 text-sm flex gap-2">
                            <button
                              onClick={() => openEditModal(user)}
                              title="Edit role"
                              className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button className="p-1 text-red-600 hover:text-red-900 hover:bg-red-50 rounded">
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {usersData?.items.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-6 py-4 text-sm text-gray-500 text-center">No users found</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Access Requests - only show if department is LOCKED */}
              {isLocked && (
                <div>
                  <h3 className="mb-4 text-2xl font-semibold text-gray-900">Manage Access Requests</h3>
                  <p className="mb-4 text-sm text-gray-600">
                    This section shows pending requests from users who want access but don't have it yet, and will only populate for departments with "LOCKED" access. Only users with approved access can submit documents.
                  </p>

                  <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                            First Name
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                            Last Name
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                            Email
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                            Requested
                          </th>
                          <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b border-gray-200 hover:bg-gray-50">
                          <td className="px-6 py-4 text-sm text-gray-900">User</td>
                          <td className="px-6 py-4 text-sm text-gray-900">One</td>
                          <td className="px-6 py-4 text-sm text-gray-600">userone@example.com</td>
                          <td className="px-6 py-4 text-sm text-gray-600">2026-03-01</td>
                          <td className="px-6 py-4 text-sm flex gap-2">
                            <button className="px-3 py-1 text-sm font-semibold text-green-600 hover:text-green-900 hover:bg-green-50 rounded">
                              Approve
                            </button>
                            <button className="px-3 py-1 text-sm font-semibold text-red-600 hover:text-red-900 hover:bg-red-50 rounded">
                              Deny
                            </button>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manage Department Level Prompt Tab */}
          {activeTab === 'prompt' && (
            <div>
              <h2 className="mb-6 text-3xl font-bold text-gray-900">Department Prompt</h2>

              <div className="rounded-lg border border-gray-200 bg-white p-8 max-w-4xl">
                {departmentId && (
                  <DepartmentPromptEditor
                    departmentId={departmentId}
                    prompt={departmentPrompt}
                    save={updateDepartmentPrompt}
                    onSaved={() => {
                      void queryClient.invalidateQueries({ queryKey: ['system-departments'] });
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Manage Ask WREN Prompt Tab */}
          {activeTab === 'ask-wren' && canManageAskWrenPrompt && (
            <div>
              <h2 className="mb-6 text-3xl font-bold text-gray-900">Ask WREN Prompt</h2>

              <div className="rounded-lg border border-gray-200 bg-white p-8 max-w-4xl space-y-6">
                <p className="text-sm text-gray-600">
                  Add department-specific context for Ask WREN, the Socratic writing coach students
                  chat with about their draft. This shapes how Ask WREN frames its coaching questions
                  across every document type in this department. It does not change automated feedback
                  generation, and it never overrides Ask WREN's core coaching rules (it will still
                  never rewrite student text).
                </p>

                <div>
                  <label
                    htmlFor="ask-wren-prompt"
                    className="block text-sm font-semibold text-gray-900 mb-1"
                  >
                    Ask WREN Coaching Context
                  </label>
                  <p className="text-xs text-gray-500 mb-2">
                    Who are the writers, what discipline are they in, and what conventions should Ask
                    WREN keep in mind when asking guiding questions?
                  </p>
                  <textarea
                    id="ask-wren-prompt"
                    value={askWrenPromptText}
                    onChange={(e) => setAskWrenPromptText(e.target.value)}
                    placeholder="e.g. Law students writing legal memoranda. Encourage IRAC structure and precise use of authority. Keep a formal register."
                    className="w-full h-40 p-3 border border-gray-300 rounded-lg focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 text-sm"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => askWrenPromptMutation.mutate(askWrenPromptText)}
                    disabled={askWrenPromptMutation.isPending}
                    className="rounded-lg bg-gray-900 px-6 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {askWrenPromptMutation.isPending ? 'Saving...' : 'Save Ask WREN Prompt'}
                  </button>
                  <button
                    onClick={() => setAskWrenPromptText('')}
                    className="rounded-lg border border-gray-300 px-6 py-2 font-semibold text-gray-900 hover:bg-gray-50"
                  >
                    Clear
                  </button>
                  {askWrenPromptMutation.isSuccess && (
                    <span className="text-green-600 font-semibold text-sm">Saved successfully!</span>
                  )}
                  {askWrenPromptMutation.isError && (
                    <p role="alert" className="text-sm font-medium text-red-600">
                      {getServerErrorMessage(
                        askWrenPromptMutation.error,
                        'Error saving Ask WREN prompt — please try again.',
                      )}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <div>
              <h2 className="mb-6 text-3xl font-bold text-gray-900">Analytics Dashboard</h2>

              {!analyticsSummary ? (
                <div className="text-sm text-gray-500">Loading analytics...</div>
              ) : (
                <>
                  <div className="mb-8 grid grid-cols-3 gap-6">
                    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                      <p className="text-sm text-gray-600">Total Documents</p>
                      <p className="text-4xl font-bold mt-2">{analyticsSummary.totalDocuments}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                      <p className="text-sm text-gray-600">Total Drafts</p>
                      <p className="text-4xl font-bold mt-2">{analyticsSummary.totalDrafts}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                      <p className="text-sm text-gray-600">Active Users</p>
                      <p className="text-4xl font-bold mt-2">{analyticsSummary.activeUsers}</p>
                    </div>
                  </div>

                  {analyticsSummary.breakdownByDocumentType.length === 0 && analyticsSummary.platformUsageOverTime.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-sm text-gray-500">
                      No feedback has been generated yet for document types in this department.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-6">
                      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                        <h3 className="mb-6 text-lg font-semibold text-gray-900">Breakdown by Document Type</h3>
                        <ResponsiveContainer width="100%" height={240}>
                          <BarChart data={analyticsSummary.breakdownByDocumentType}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip formatter={(value) => [value, 'Feedback generated']} />
                            <Bar dataKey="feedbackGenerated" fill="var(--color-accent-primary)" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                        <h3 className="mb-6 text-lg font-semibold text-gray-900">Platform Total Usage with time</h3>
                        <ResponsiveContainer width="100%" height={240}>
                          <LineChart data={analyticsSummary.platformUsageOverTime}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip formatter={(value) => [value, 'Feedback generated']} />
                            <Line type="monotone" dataKey="feedbackGenerated" stroke="var(--color-accent-primary)" dot={{ r: 3 }} strokeWidth={2} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <Dialog.Root
        open={visibilityConfirmOpen}
        onOpenChange={(open) => {
          if (visibilityMutation.isPending) return;
          setVisibilityConfirmOpen(open);
          if (!open) visibilityMutation.reset();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50" />
          <Dialog.Content
            aria-busy={visibilityMutation.isPending}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              visibilityCancelRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              visibilityToggleRef.current?.focus();
            }}
            onEscapeKeyDown={(event) => {
              if (visibilityMutation.isPending) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (visibilityMutation.isPending) event.preventDefault();
            }}
            className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 shadow-xl focus:outline-none"
          >
            <Dialog.Title className="text-lg font-semibold text-gray-900">
              Limit department visibility?
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-gray-600">
              Ordinary students without an explicit permission will immediately stop seeing{' '}
              <strong>{department?.name ?? 'this department'}</strong> in department catalog
              views. Technical Admins and Department Admins appointed to this department retain
              automatic discovery. Existing documents and configuration are preserved, and Open
              or Locked submission rules remain unchanged. Visibility filters catalog UI only;
              it is not a confidentiality or direct-API authorization boundary.
            </Dialog.Description>
            {visibilityMutation.isError && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {getServerErrorMessage(
                  visibilityMutation.error,
                  'Failed to update visibility. Please try again.',
                )}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button
                ref={visibilityCancelRef}
                type="button"
                onClick={() => {
                  setVisibilityConfirmOpen(false);
                  visibilityMutation.reset();
                }}
                disabled={visibilityMutation.isPending}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  visibilityMutation.reset();
                  visibilityMutation.mutate('PERMITTED_ONLY');
                }}
                disabled={visibilityMutation.isPending}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {visibilityMutation.isPending ? 'Saving…' : 'Limit visibility'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {canManageVisibility && departmentId && (
        <ImportStudentsDialog
          open={importStudentsOpen}
          onOpenChange={setImportStudentsOpen}
          departmentId={departmentId}
          departmentName={department?.name}
          isLocked={isLocked}
          onImported={() => {
            void queryClient.invalidateQueries({ queryKey: departmentRosterQueryKey(departmentId) });
            void queryClient.invalidateQueries({ queryKey: ['department-users', departmentId] });
            void queryClient.invalidateQueries({
              queryKey: ['department-visibility-grants', departmentId],
            });
          }}
        />
      )}

      {/* Edit Role Dialog */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Edit Roles</h2>
              <button
                onClick={closeEditModal}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>

            {/* User info */}
            <div className="px-6 pt-5 pb-2">
              <p className="text-sm font-medium text-gray-900">
                {editingUser.firstName} {editingUser.lastName}
              </p>
              <p className="text-sm text-gray-500">{editingUser.email}</p>
            </div>

            {/* Role selector — multi-select so users can hold several roles */}
            <div className="px-6 pb-5">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Roles
              </label>
              <p className="mb-3 text-xs text-gray-500">
                Department Admin applies only to {department?.name ?? 'this department'}.
                Unchecking it here does not remove admin status in other departments.
              </p>
              <div className="flex flex-col gap-2">
                {ASSIGNABLE_ROLES.map((role) => {
                  const checked = selectedRoles.includes(role);
                  return (
                    <label
                      key={role}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition ${
                        checked
                          ? 'border-gray-900 bg-gray-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRole(role)}
                        className="mt-0.5 accent-gray-900"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{role}</p>
                        <p className="text-xs text-gray-500">
                          {role === 'TechnicalAdmin' && 'Full platform access — manage all departments and system settings'}
                          {role === 'DepartmentAdmin' && `Admin for ${department?.name ?? 'this department'} — manage document types and prompts`}
                          {role === 'Student' && 'Can submit documents and receive feedback'}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {(assignMutation.isError || roleSaveError) && (
                <p role="alert" className="mt-3 text-sm text-red-600">
                  {roleSaveError ?? 'Failed to update roles. Please try again.'}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button
                onClick={closeEditModal}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  assignMutation.mutate({
                    userId: editingUser.id,
                    nextRoles: selectedRoles,
                    previousRoles: rolesAtOpen,
                  })
                }
                disabled={assignMutation.isPending}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {assignMutation.isPending ? 'Saving…' : 'Save Roles'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
