import { z } from 'zod';

import { apiClient, type HttpClient } from '@/services';

const analyticsSchema = z.object({
  totalDepartments: z.number(),
  totalUsers: z.number(),
  totalDocuments: z.number(),
  usageOverTime: z.array(
    z.object({ date: z.string(), activeUsers: z.number() })
  ),
  documentsByDepartment: z.array(
    z.object({ name: z.string(), count: z.number() })
  ),
  usersByDepartment: z.array(
    z.object({ name: z.string(), value: z.number() })
  ),
  modelUsage: z.array(z.object({ name: z.string(), requests: z.number() })),
});

const modelConfigResponseSchema = z.object({
  modelIdentifier: z.string(),
  temperature: z.number(),
  maxTokens: z.number(),
});

const availableModelSchema = z.array(
  z.object({ id: z.string(), name: z.string() })
);

const usageLimitsSchema = z.object({
  messageLimit: z.number(),
  debriefGenerationLimit: z.number(),
  documentUploadLimit: z.number(),
  draftsPerDocumentLimit: z.number(),
});

const departmentSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    accessState: z.string(),
    userCount: z.number(),
  })
);

const userSchema = z.array(
  z.object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    role: z.string(),
  })
);

export const systemAdminApi = {
  // Analytics
  getAnalytics: async () =>
    apiClient.request('/api/system-admin/analytics', {
      schema: analyticsSchema,
    }),

  // Model Configuration (System-wide)
  getModelConfig: async () =>
    apiClient.request('/api/system-admin/model-config', {
      schema: modelConfigResponseSchema,
    }),

  updateModelConfig: async (config: {
    modelIdentifier: string;
    temperature: number;
    maxTokens: number;
  }) =>
    apiClient.request('/api/system-admin/model-config', {
      method: 'PUT',
      body: config,
      schema: modelConfigResponseSchema,
    }),

  getAvailableModels: async () =>
    apiClient.request('/api/system-admin/available-models', {
      schema: availableModelSchema,
    }),

  // Usage Limits (System-wide)
  getUsageLimits: async () =>
    apiClient.request('/api/system-admin/usage-limits', {
      schema: usageLimitsSchema,
    }),

  updateUsageLimits: async (limits: {
    messageLimit: number;
    debriefGenerationLimit: number;
    documentUploadLimit: number;
    draftsPerDocumentLimit: number;
  }) =>
    apiClient.request('/api/system-admin/usage-limits', {
      method: 'PUT',
      body: limits,
      schema: usageLimitsSchema,
    }),

  // Departments
  getDepartments: async () =>
    apiClient.request('/api/system-admin/departments', {
      schema: departmentSchema,
    }),

  createDepartment: async (data: {
    name: string;
    description?: string;
  }) =>
    apiClient.request('/api/system-admin/departments', {
      method: 'POST',
      body: data,
      schema: departmentSchema,
    }),

  // Users
  getUsers: async (params?: {
    role?: string;
    department?: string;
    page?: number;
  }) =>
    apiClient.request('/api/system-admin/users', {
      schema: userSchema,
    }),

  updateUser: async (userId: string, data: any) =>
    apiClient.request(`/api/system-admin/users/${userId}`, {
      method: 'PUT',
      body: data,
      schema: userSchema,
    }),

  deleteUser: async (userId: string) =>
    apiClient.request(`/api/system-admin/users/${userId}`, {
      method: 'DELETE',
      schema: z.object({ success: z.boolean() }),
    }),
};
