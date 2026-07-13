import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

import { systemAdminApi } from '@/features/system-admin/systemAdminApi';
import { ModelConfigurationForm } from '@/features/system-admin/components/ModelConfigurationForm';
import { SystemUsageLimitsForm } from '@/features/system-admin/components/SystemUsageLimitsForm';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export function SystemConfigPage() {
  const queryClient = useQueryClient();

  const { data: analyticsData } = useQuery({
    queryKey: ['system-analytics'],
    queryFn: () => systemAdminApi.getAnalytics(),
  });

  const { data: modelConfig, isLoading: modelLoading } = useQuery({
    queryKey: ['system-model-config'],
    queryFn: () => systemAdminApi.getModelConfig(),
  });

  const { data: usageLimits, isLoading: limitsLoading } = useQuery({
    queryKey: ['system-usage-limits'],
    queryFn: () => systemAdminApi.getUsageLimits(),
  });

  const updateModelConfigMutation = useMutation({
    mutationFn: (config) => systemAdminApi.updateModelConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-model-config'] });
    },
  });

  const updateUsageLimitsMutation = useMutation({
    mutationFn: (limits) => systemAdminApi.updateUsageLimits(limits),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-usage-limits'] });
    },
  });

  return (
    <div className="p-8">
      <h1 className="mb-8 text-4xl font-bold">System Analytics Dashboard</h1>

      {/* Key Metrics */}
      {analyticsData && (
        <>
          <div className="mb-8 grid grid-cols-3 gap-6">
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-600">Total Documents</p>
              <p className="text-4xl font-bold">{analyticsData.totalDocuments}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-600">Total Drafts</p>
              <p className="text-4xl font-bold">95</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <p className="text-sm text-gray-600">Active Users</p>
              <p className="text-4xl font-bold">30</p>
            </div>
          </div>

          {/* Charts */}
          <div className="mb-12 grid grid-cols-2 gap-8">
            {/* Document Type Breakdown */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-6 text-xl font-semibold">Breakdown by Document Type</h2>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={analyticsData.documentsByDepartment}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Platform Usage Over Time */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-6 text-xl font-semibold">Platform Total Usage with time</h2>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={analyticsData.usageOverTime}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="activeUsers"
                    stroke="#3b82f6"
                    dot={false}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

      {/* Configuration Sections */}
      <div className="space-y-8">
        {/* Model Configuration */}
        <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="mb-6 text-2xl font-semibold">Model Configuration</h2>
          {modelLoading ? (
            <div>Loading...</div>
          ) : (
            <ModelConfigurationForm
              initialData={modelConfig}
              onSubmit={(data) => updateModelConfigMutation.mutate(data)}
              isLoading={updateModelConfigMutation.isPending}
            />
          )}
        </div>

        {/* Usage Limits */}
        <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <h2 className="mb-6 text-2xl font-semibold">Usage Limits</h2>
          {limitsLoading ? (
            <div>Loading...</div>
          ) : (
            <SystemUsageLimitsForm
              initialData={usageLimits}
              onSubmit={(data) => updateUsageLimitsMutation.mutate(data)}
              isLoading={updateUsageLimitsMutation.isPending}
            />
          )}
        </div>
      </div>
    </div>
  );
}
