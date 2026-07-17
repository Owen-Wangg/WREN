import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Edit2, Trash2 } from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { systemAdminApi } from '@/features/system-admin/systemAdminApi';

interface Department {
  id: string;
  name: string;
  accessState?: string;
}

export function DepartmentDetailPage() {
  const { departmentId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'users' | 'prompt' | 'analytics'>('users');

  const { data: departments = [] } = useQuery({
    queryKey: ['system-departments'],
    queryFn: () => systemAdminApi.listDepartments(),
  });

  const department = (departments as Department[]).find((d: Department) => d.id === departmentId);
  const isLocked = department?.accessState === 'LOCKED';

  const { data: analyticsData } = useQuery({
    queryKey: ['department-analytics', departmentId],
    queryFn: () => systemAdminApi.getAnalytics(),
  });

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
              <h2 className="mb-6 text-3xl font-bold text-gray-900">Manage Users</h2>

              {/* Search and Filter */}
              <div className="mb-6 flex gap-4">
                <input
                  type="text"
                  placeholder="Search by First Name, Last Name, or Email"
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                />
                <select className="rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900">
                  <option>All Roles</option>
                </select>
              </div>

              {/* Users Table */}
              <div className="rounded-lg border border-gray-200 bg-white overflow-hidden mb-8">
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
                        Role
                      </th>
                      <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">Jovan</td>
                      <td className="px-6 py-4 text-sm text-gray-900">S</td>
                      <td className="px-6 py-4 text-sm text-gray-600">JovanS@example.com</td>
                      <td className="px-6 py-4 text-sm text-gray-900">Department Admin</td>
                      <td className="px-6 py-4 text-sm flex gap-2">
                        <button className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded">
                          <Edit2 size={16} />
                        </button>
                        <button className="p-1 text-red-600 hover:text-red-900 hover:bg-red-50 rounded">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                    <tr className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">John</td>
                      <td className="px-6 py-4 text-sm text-gray-900">Doe</td>
                      <td className="px-6 py-4 text-sm text-gray-600">JohnDoe@example.com</td>
                      <td className="px-6 py-4 text-sm text-gray-900">Student</td>
                      <td className="px-6 py-4 text-sm flex gap-2">
                        <button className="p-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded">
                          <Edit2 size={16} />
                        </button>
                        <button className="p-1 text-red-600 hover:text-red-900 hover:bg-red-50 rounded">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
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
                  placeholder="Prompt goes here..."
                  className="w-full h-64 p-4 border border-gray-300 rounded-lg focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 mb-4 font-mono text-sm"
                  defaultValue="System instructions applicable across all document types for this department..."
                />

                <div className="flex gap-3">
                  <button className="rounded-lg bg-gray-900 px-6 py-2 font-semibold text-white hover:bg-gray-800">
                    Save Prompt
                  </button>
                  <button className="rounded-lg border border-gray-300 px-6 py-2 font-semibold text-gray-900 hover:bg-gray-50">
                    Clear Prompt
                  </button>
                </div>

                {/* Prompt History */}
                <div className="mt-8 border-t border-gray-200 pt-8">
                  <h3 className="mb-4 text-2xl font-semibold text-gray-900">Department Prompt History</h3>
                  <div className="flex items-center justify-center mb-4">
                    <span className="text-sm text-gray-600">Version 1 of 1</span>
                  </div>

                  <div className="rounded-lg border border-gray-200 p-4 bg-gray-50 mb-4">
                    <p className="text-sm text-gray-700">Previous Prompt goes here...</p>
                  </div>

                  <button className="rounded-lg border border-gray-300 px-6 py-2 font-semibold text-gray-900 hover:bg-gray-50">
                    Restore Prompt Version
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && analyticsData && (
            <div>
              <h2 className="mb-6 text-3xl font-bold text-gray-900">Analytics Dashboard</h2>

              {/* Key Metrics */}
              <div className="mb-8 grid grid-cols-3 gap-6">
                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <p className="text-sm text-gray-600">Total Analytics Points</p>
                  <p className="text-4xl font-bold">{analyticsData?.totals?.length || 0}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <p className="text-sm text-gray-600">Platform Scope</p>
                  <p className="text-4xl font-bold">{analyticsData?.totals?.filter((t: any) => t.scopeKind === 'platform').length || 0}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <p className="text-sm text-gray-600">Document Type Metrics</p>
                  <p className="text-4xl font-bold">{analyticsData?.totals?.filter((t: any) => t.scopeKind === 'documentType').length || 0}</p>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-2 gap-8">
                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-6 text-lg font-semibold text-gray-900">Metrics by Scope</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={(analyticsData?.totals || []).map((t: any) => ({ name: t.scopeKind, value: t.value }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <h3 className="mb-6 text-lg font-semibold text-gray-900">All Metrics</h3>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={(analyticsData?.totals || []).map((t: any, i: number) => ({ index: i, metric: t.metric, value: t.value }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="index" />
                      <YAxis />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="value"
                        stroke="#3b82f6"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
