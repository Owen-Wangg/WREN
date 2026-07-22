import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Trash2, ChevronDown } from 'lucide-react';

import { listDepartments, getAnalytics, getModelConfig, createDepartment, getPlatformUsageLimits, updatePlatformUsageLimits } from '@/features/system-admin/systemAdminApi';
import { SystemUsageLimitsForm } from '@/features/system-admin/components/SystemUsageLimitsForm';
import type { UsageLimits } from '@/features/system-admin/systemAdminSchemas';

export function SystemAdminDashboard() {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterState, setFilterState] = useState('All');
  const [expandedSection, setExpandedSection] = useState<'model' | 'limits' | null>(null);
  const [showCreateDept, setShowCreateDept] = useState(false);
  const [newDeptName, setNewDeptName] = useState('');

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['system-departments'],
    queryFn: () => listDepartments(),
  });

  // Analytics query not used in render but kept for future use
  useQuery({
    queryKey: ['system-analytics'],
    queryFn: () => getAnalytics(),
  });

  const { data: modelConfigData, isLoading: modelLoading } = useQuery({
    queryKey: ['system-model-config'],
    queryFn: () => getModelConfig(),
  });

  const queryClient = useQueryClient();

  const createDeptMutation = useMutation({
    mutationFn: (name: string) => createDepartment(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system-departments'] });
      setNewDeptName('');
      setShowCreateDept(false);
    },
  });

  const { data: usageLimits, isLoading: usageLimitsLoading } = useQuery({
    queryKey: ['system-usage-limits'],
    queryFn: () => getPlatformUsageLimits(),
  });

  const saveUsageLimitsMutation = useMutation({
    mutationFn: (limits: UsageLimits) => updatePlatformUsageLimits(limits),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['system-usage-limits'] });
    },
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
          {/* Model Configuration Card — read-only deploy-time value */}
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
                <p className="text-sm text-gray-600 mt-1">Deploy-time Bedrock model (read-only)</p>
              </div>
              <ChevronDown
                size={20}
                className={`text-gray-600 transition-transform flex-shrink-0 ${
                  expandedSection === 'model' ? 'rotate-180' : ''
                }`}
              />
            </div>

            {modelConfigData && !modelLoading && expandedSection !== 'model' && (
              <div className="mb-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600">Model:</span>
                  <span className="font-semibold text-gray-900 text-right break-all">
                    {modelConfigData.modelId}
                  </span>
                </div>
              </div>
            )}

            {expandedSection === 'model' && (
              <div className="border-t border-gray-200 pt-6 space-y-3">
                {modelLoading ? (
                  <div>Loading...</div>
                ) : modelConfigData ? (
                  <>
                    <div className="flex justify-between gap-4 text-sm">
                      <span className="text-gray-600">Active model ID</span>
                      <span className="font-semibold text-gray-900 text-right break-all">
                        {modelConfigData.modelId}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 rounded-lg bg-gray-50 p-3">
                      {modelConfigData.note ??
                        'This value comes from BEDROCK_MODEL_ID at deploy time. Runtime changes are not supported.'}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-red-600">Could not load model configuration.</p>
                )}
              </div>
            )}

            {expandedSection === null && modelConfigData && (
              <button className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition">
                View Details
              </button>
            )}
            </div>
          )}

          {/* Usage Limits Card — lifetime policy editor */}
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
                <p className="text-sm text-gray-600 mt-1">
                  Lifetime caps for Ask LEON, AI Debrief, uploads, and drafts
                </p>
              </div>
              <ChevronDown
                size={20}
                className={`text-gray-600 transition-transform flex-shrink-0 ${
                  expandedSection === 'limits' ? 'rotate-180' : ''
                }`}
              />
            </div>

            {!usageLimitsLoading && expandedSection !== 'limits' && usageLimits && (
              <div className="mb-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Debrief gens / document:</span>
                  <span className="font-semibold text-gray-900">
                    {usageLimits.debriefGenerationLimit}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ask messages / document:</span>
                  <span className="font-semibold text-gray-900">{usageLimits.messageLimit}</span>
                </div>
              </div>
            )}

            {expandedSection === 'limits' && (
              <div className="border-t border-gray-200 pt-6" onClick={(e) => e.stopPropagation()}>
                {usageLimitsLoading ? (
                  <div>Loading...</div>
                ) : (
                  <SystemUsageLimitsForm
                    initialData={usageLimits}
                    isLoading={saveUsageLimitsMutation.isPending}
                    onSubmit={(data) => saveUsageLimitsMutation.mutate(data)}
                  />
                )}
                {saveUsageLimitsMutation.isError && (
                  <p className="mt-3 text-sm text-red-600">
                    {saveUsageLimitsMutation.error instanceof Error
                      ? saveUsageLimitsMutation.error.message
                      : 'Failed to save usage limits'}
                  </p>
                )}
                {saveUsageLimitsMutation.isSuccess && (
                  <p className="mt-3 text-sm text-green-700">Usage limits saved.</p>
                )}
              </div>
            )}

            {expandedSection === null && (
              <button className="w-full rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition">
                View Usage
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
          <button
            onClick={() => setShowCreateDept(true)}
            className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800"
          >
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

      {/* Create Department Dialog */}
      {showCreateDept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-xl font-bold text-gray-900">Create New Department</h2>
            <label className="mb-1 block text-sm font-semibold text-gray-900">Department Name</label>
            <input
              type="text"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              placeholder="e.g. Law, Arts, Engineering"
              className="mb-4 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newDeptName.trim()) createDeptMutation.mutate(newDeptName.trim());
              }}
              autoFocus
            />
            {createDeptMutation.isError && (
              <p className="mb-3 text-sm text-red-600">Failed to create department. Please try again.</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowCreateDept(false); setNewDeptName(''); }}
                className="rounded-lg border border-gray-300 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { if (newDeptName.trim()) createDeptMutation.mutate(newDeptName.trim()); }}
                disabled={!newDeptName.trim() || createDeptMutation.isPending}
                className="rounded-lg bg-gray-900 px-4 py-2 font-semibold text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createDeptMutation.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
