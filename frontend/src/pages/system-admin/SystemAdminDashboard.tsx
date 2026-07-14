import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2, ChevronDown } from 'lucide-react';

import { listDepartments, getAnalytics } from '@/features/system-admin/systemAdminApi';
import { ModelConfigurationForm } from '@/features/system-admin/components/ModelConfigurationForm';

export function SystemAdminDashboard() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterState, setFilterState] = useState('All');
  const [expandedSection, setExpandedSection] = useState<'model' | 'limits' | null>(null);

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['system-departments'],
    queryFn: () => listDepartments(),
  });

  // Analytics query not used in render but kept for future use
  useQuery({
    queryKey: ['system-analytics'],
    queryFn: () => getAnalytics(),
  });

  const { data: modelConfig, isLoading: modelLoading } = useQuery({
    queryKey: ['system-model-config'],
    queryFn: () => ({ modelIdentifier: 'claude-3-5-sonnet', temperature: 0.7, maxTokens: 4096 }),
  });

  const { data: usageLimits, isLoading: usageLimitsLoading } = useQuery({
    queryKey: ['system-usage-limits'],
    queryFn: () => ({ platform: { used: 45000, limit: 100000 } }),
  });

  if (isLoading) {
    return <div className="p-8">Loading departments...</div>;
  }

  interface Department {
    id: string;
    name: string;
    accessState?: string;
    userCount?: number;
  }

  const filteredDepartments = (departments as Department[]).filter((dept) => {
    const matchesSearch = dept.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterState === 'All' || dept.accessState === filterState;
    return matchesSearch && matchesFilter;
  });

  const getAccessStateBadge = (state: string | undefined) => {
    if (!state) return null;
    if (state === 'LOCKED') {
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
          {state}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
        {state}
      </span>
    );
  };

  return (
    <div className="p-8">
      {/* System Settings Section - At the top for visibility */}
      <div className="mb-12">
        <h1 className="mb-6 text-3xl font-bold text-gray-900">System Configuration</h1>
        <div className={`gap-6 ${expandedSection ? 'space-y-6' : 'grid grid-cols-1 md:grid-cols-2'}`}>
          {/* Model Configuration Card */}
          {(expandedSection === null || expandedSection === 'model') && (
            <div
              className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() =>
                setExpandedSection(expandedSection === 'model' ? null : 'model')
              }
            >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Model Configuration</h3>
                <p className="text-sm text-gray-600 mt-1">System-wide settings applied to all departments</p>
              </div>
              <ChevronDown
                size={20}
                className={`text-gray-600 transition-transform flex-shrink-0 ${
                  expandedSection === 'model' ? 'rotate-180' : ''
                }`}
              />
            </div>

            {modelConfig && !modelLoading && expandedSection !== 'model' && (
              <div className="mb-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Model:</span>
                  <span className="font-semibold text-gray-900">{modelConfig.modelIdentifier}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Temperature:</span>
                  <span className="font-semibold text-gray-900">{modelConfig.temperature}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Max Tokens:</span>
                  <span className="font-semibold text-gray-900">{modelConfig.maxTokens}</span>
                </div>
              </div>
            )}

            {expandedSection === 'model' && (
              <div className="border-t border-gray-200 pt-6">
                {modelLoading ? (
                  <div>Loading...</div>
                ) : (
                  <ModelConfigurationForm
                    initialData={modelConfig}
                    onSubmit={(data) => console.log('Update model config:', data)}
                    isLoading={false}
                  />
                )}
              </div>
            )}

            {expandedSection === null && modelConfig && (
              <button className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition">
                Edit Configuration
              </button>
            )}
            </div>
          )}

          {/* Usage Limits Card */}
          {(expandedSection === null || expandedSection === 'limits') && (
            <div
              className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() =>
                setExpandedSection(expandedSection === 'limits' ? null : 'limits')
              }
            >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Usage Limits</h3>
                <p className="text-sm text-gray-600 mt-1">System-wide settings applied to all departments</p>
              </div>
              <ChevronDown
                size={20}
                className={`text-gray-600 transition-transform flex-shrink-0 ${
                  expandedSection === 'limits' ? 'rotate-180' : ''
                }`}
              />
            </div>

            {usageLimits && !usageLimitsLoading && expandedSection !== 'limits' && (
              <div className="mb-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Platform Usage:</span>
                  <span className="font-semibold text-gray-900">{usageLimits.platform.used} / {usageLimits.platform.limit}</span>
                </div>
              </div>
            )}

            {expandedSection === 'limits' && (
              <div className="border-t border-gray-200 pt-6">
                {usageLimitsLoading ? (
                  <div>Loading...</div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-900">Platform Usage</label>
                      <p className="mt-1 text-gray-600">{usageLimits?.platform?.used || 0} / {usageLimits?.platform?.limit || 0}</p>
                    </div>
                    <button
                      className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800"
                      onClick={() => console.log('Update usage limits')}
                    >
                      Save Changes
                    </button>
                  </div>
                )}
              </div>
            )}

            {expandedSection === null && usageLimits && (
              <button className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition">
                Edit Limits
              </button>
            )}
            </div>
          )}
        </div>
      </div>

      {/* Departments Section */}
      <div className="mb-12">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Departments</h1>
          <button className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800">
            Create new Department
          </button>
        </div>

        <p className="mb-6 font-semibold text-gray-900">My Departments ({departments.length})</p>

        <div className="mb-6 flex gap-4">
          <input
            type="text"
            placeholder="Search Departments"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
          <div className="relative">
            <select
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
              className="appearance-none rounded-lg border border-gray-300 bg-white px-4 py-2 font-semibold focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 pr-10"
            >
              <option value="All">All</option>
              <option value="LOCKED">Locked</option>
              <option value="OPEN">Open</option>
            </select>
            <ChevronDown size={18} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-600" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {filteredDepartments.map((dept) => (
            <div
              key={dept.id}
              className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => navigate(`/system-admin/department/${dept.id}`)}
            >
              <div className="mb-4 flex items-start justify-between">
                <h3 className="text-xl font-semibold text-gray-900">{dept.name}</h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 transition hover:bg-gray-100 rounded"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <div className="mb-6 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Access State:</span>
                  {getAccessStateBadge(dept.accessState)}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Users:</span>
                  <span className="font-semibold text-gray-900">{dept.userCount}</span>
                </div>
              </div>
              <button
                className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/system-admin/department/${dept.id}`);
                }}
              >
                Manage Department
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
