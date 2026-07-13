import { z } from 'zod';

import { apiClient } from '@/services';

const departmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  accessState: z.enum(['OPEN', 'LOCKED']),
  userCount: z.number(),
});

const documentTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  departmentId: z.string(),
  templateCount: z.number().optional(),
  createdAt: z.string().optional(),
});

export type Department = z.infer<typeof departmentSchema>;
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const departmentAdminApi = {
  getCurrentDepartment: async () =>
    apiClient.request('/api/dept-admin/current-department', {
      schema: departmentSchema,
    }),

  getDocumentTypes: async (departmentId: string) =>
    apiClient.request(`/api/dept-admin/departments/${departmentId}/document-types`, {
      schema: z.array(documentTypeSchema),
    }),

  createDocumentType: async (departmentId: string, data: { name: string }) =>
    apiClient.request(`/api/dept-admin/departments/${departmentId}/document-types`, {
      method: 'POST',
      body: data,
      schema: documentTypeSchema,
    }),

  updateDocumentType: async (
    departmentId: string,
    documentTypeId: string,
    data: { name: string }
  ) =>
    apiClient.request(
      `/api/dept-admin/departments/${departmentId}/document-types/${documentTypeId}`,
      {
        method: 'PUT',
        body: data,
        schema: documentTypeSchema,
      }
    ),

  deleteDocumentType: async (departmentId: string, documentTypeId: string) =>
    apiClient.request(
      `/api/dept-admin/departments/${departmentId}/document-types/${documentTypeId}`,
      {
        method: 'DELETE',
        schema: z.object({ success: z.boolean() }),
      }
    ),
};
