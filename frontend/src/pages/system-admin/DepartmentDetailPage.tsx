import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Edit2, Trash2, X } from 'lucide-react';
import { searchAllUsers, assignRole, revokeRole, updateDepartmentPrompt, getAnalyticsSummary } from '@/features/system-admin/systemAdminApi';
import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import { systemAdminApi } from '@/features/system-admin/systemAdminApi';

interface Department {
  id: string;
  name: string;
  accessState?: string;
}

interface EditingUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
}

const ASSIGNABLE_ROLES = ['Student', 'DepartmentAdmin', 'TechnicalAdmin'] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function DepartmentDetailPage() {
  const { departmentId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'users' | 'prompt' | 'analytics'>('users');
  const [editingUser, setEditingUser] = useState<EditingUser | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<AssignableRole[]>([]);
  const [roleSaveError, setRoleSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: departments = [] } = useQuery({
    queryKey: ['system-departments'],
    queryFn: () => systemAdminApi.listDepartments(),
  });

  const department = (departments as Department[]).find((d: Department) => d.id === departmentId);
  const isLocked = department?.accessState === 'LOCKED';

  const { data: analyticsSummary } = useQuery({
    queryKey: ['department-analytics-summary', departmentId],
    queryFn: () => getAnalyticsSummary(departmentId),
    enabled: activeTab === 'analytics',
  });

  const [userSearch, setUserSearch] = useState('');

  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['department-users', departmentId, userSearch],
    queryFn: () => searchAllUsers({ q: userSearch || undefined }),
    enabled: activeTab === 'users',
  });

  const assignMutation = useMutation({
    mutationFn: async ({
      userId,
      nextRoles,
      previousRoles,
    }: {
      userId: string;
      nextRoles: AssignableRole[];
      previousRoles: string[];
    }) => {
      const prev = new Set(previousRoles);
      const next = new Set(nextRoles);
      const toAdd = nextRoles.filter((role) => !prev.has(role));
      const toRemove = previousRoles.filter(
        (role): role is AssignableRole =>
          ASSIGNABLE_ROLES.includes(role as AssignableRole) && !next.has(role as AssignableRole),
      );

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
      setEditingUser(null);
      setSelectedRoles([]);
      setRoleSaveError(null);
    },
    onError: () => {
      setRoleSaveError('Failed to update roles. Please try again.');
    },
  });

  const [promptText, setPromptText] = useState('');
  useEffect(() => {
    setPromptText((department as any)?.prompt ?? '');
  }, [(department as any)?.prompt]);

  const promptMutation = useMutation({
    mutationFn: (text: string) =>
      updateDepartmentPrompt(departmentId!, text || null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system-departments'] });
    },
  });

  function openEditModal(user: EditingUser) {
    setEditingUser(user);
    setRoleSaveError(null);
    setSelectedRoles(
      ASSIGNABLE_ROLES.filter((role) => user.roles.includes(role)),
    );
  }

  function toggleRole(role: AssignableRole) {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  }

  function closeEditModal() {
    setEditingUser(null);
    setSelectedRoles([]);
    setRoleSaveError(null);
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
        <div className="bg-white border-b border-gray-200 px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Department: {department?.name}
          </h1>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-8">
          {/* Manage Users Tab */}
          {activeTab === 'users' && (
            <div>
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-3xl font-bold text-gray-900">Manage Users</h2>
              </div>

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
                          <td className="px-6 py-4 text-sm text-gray-900">{user.roles.join(', ')}</td>
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
                <p className="mb-4 text-sm text-gray-600">
                  Instructions applicable across all document types for this department. Include information about no ghostwriting rules, guardrails, model output format, etc. Do not include any specific guidance which will differ with document types.
                </p>

                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Prompt goes here..."
                  className="w-full h-64 p-4 border border-gray-300 rounded-lg focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 mb-4 font-mono text-sm"
                />

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => promptMutation.mutate(promptText)}
                    disabled={promptMutation.isPending}
                    className="rounded-lg bg-gray-900 px-6 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {promptMutation.isPending ? 'Saving...' : 'Save Prompt'}
                  </button>
                  <button
                    onClick={() => setPromptText('')}
                    className="rounded-lg border border-gray-300 px-6 py-2 font-semibold text-gray-900 hover:bg-gray-50"
                  >
                    Clear Prompt
                  </button>
                  {promptMutation.isSuccess && (
                    <span className="text-green-600 font-semibold text-sm">Saved successfully!</span>
                  )}
                  {promptMutation.isError && (
                    <span className="text-red-600 font-semibold text-sm">Error saving prompt</span>
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip formatter={(v: any) => [v, 'Feedback generated']} />
                            <Bar dataKey="feedbackGenerated" fill="#111827" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                        <h3 className="mb-6 text-lg font-semibold text-gray-900">Platform Total Usage with time</h3>
                        <ResponsiveContainer width="100%" height={240}>
                          <LineChart data={analyticsSummary.platformUsageOverTime}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} />
                            <Tooltip formatter={(v: any) => [v, 'Feedback generated']} />
                            <Line type="monotone" dataKey="feedbackGenerated" stroke="#111827" dot={{ r: 3 }} strokeWidth={2} />
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
                Select every role this user should have. Uncheck a role to remove it.
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
                <p className="mt-3 text-sm text-red-600">
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
                    previousRoles: editingUser.roles,
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
