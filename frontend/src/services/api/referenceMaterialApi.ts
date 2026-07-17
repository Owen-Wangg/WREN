/**
 * Reference Material API - Task 5.1
 * Two-tier store: Department-wide and Document-Type-scoped materials
 */
import { z } from 'zod';
import {
  referenceMaterialSchema,
  createReferenceMaterialInputSchema,
  type ReferenceMaterial,
  type CreateReferenceMaterialInput,
} from '@wren/types';
import type { HttpClient } from '@/services/apiClient';

/* -------------------------------------------------------------------------- */
/* Path Constants */
/* -------------------------------------------------------------------------- */

const REFERENCE_BASE_PATH = '/v1/departments';

/* -------------------------------------------------------------------------- */
/* Response Schemas */
/* -------------------------------------------------------------------------- */

const referenceMaterialListSchema = z.array(referenceMaterialSchema);

/* -------------------------------------------------------------------------- */
/* Department-wide Reference Material */
/* -------------------------------------------------------------------------- */

/**
 * List department-wide (tier 1) reference materials for a department.
 */
export async function listDepartmentReferenceMaterial(
  client: HttpClient,
  departmentId: string,
): Promise<ReferenceMaterial[]> {
  return client.request(
    `${REFERENCE_BASE_PATH}/${departmentId}/reference-material`,
    { schema: referenceMaterialListSchema },
  );
}

/**
 * Create a new department-wide reference material entry.
 */
export async function createDepartmentReferenceMaterial(
  client: HttpClient,
  departmentId: string,
  input: CreateReferenceMaterialInput,
): Promise<ReferenceMaterial> {
  const body = createReferenceMaterialInputSchema.parse(input);
  return client.request(
    `${REFERENCE_BASE_PATH}/${departmentId}/reference-material`,
    {
      method: 'POST',
      body,
      schema: referenceMaterialSchema,
    },
  );
}

/**
 * Delete a department-wide reference material entry.
 */
export async function deleteDepartmentReferenceMaterial(
  client: HttpClient,
  departmentId: string,
  referenceMaterialId: string,
): Promise<void> {
  await client.request(
    `${REFERENCE_BASE_PATH}/${departmentId}/reference-material/${referenceMaterialId}`,
    { method: 'DELETE' },
  );
}

/* -------------------------------------------------------------------------- */
/* Document-Type-Scoped Reference Material */
/* -------------------------------------------------------------------------- */

/**
 * List document-type-scoped (tier 2) reference materials.
 */
export async function listDocumentTypeReferenceMaterial(
  client: HttpClient,
  departmentId: string,
  documentTypeId: string,
): Promise<ReferenceMaterial[]> {
  return client.request(
    `${REFERENCE_BASE_PATH}/${departmentId}/document-types/${documentTypeId}/reference-material`,
    { schema: referenceMaterialListSchema },
  );
}

/**
 * Create a new document-type-scoped reference material entry.
 */
export async function createDocumentTypeReferenceMaterial(
  client: HttpClient,
  departmentId: string,
  documentTypeId: string,
  input: CreateReferenceMaterialInput,
): Promise<ReferenceMaterial> {
  const body = createReferenceMaterialInputSchema.parse(input);
  return client.request(
    `${REFERENCE_BASE_PATH}/${departmentId}/document-types/${documentTypeId}/reference-material`,
    {
      method: 'POST',
      body,
      schema: referenceMaterialSchema,
    },
  );
}

/**
 * Delete a document-type-scoped reference material entry.
 */
export async function deleteDocumentTypeReferenceMaterial(
  client: HttpClient,
  departmentId: string,
  documentTypeId: string,
  referenceMaterialId: string,
): Promise<void> {
  await client.request(
    `${REFERENCE_BASE_PATH}/${departmentId}/document-types/${documentTypeId}/reference-material/${referenceMaterialId}`,
    { method: 'DELETE' },
  );
}
