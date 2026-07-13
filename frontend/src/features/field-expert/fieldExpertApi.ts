/**
 * Field Expert configuration API calls — thin functions over the shared
 * {@link HttpClient} (frontend steering §11: never bypass the shared API client
 * wrapper), mirroring the `debriefApi.ts` / `dashboardApi.ts` convention (plain
 * functions taking the client, with a Zod schema validating every response at
 * the boundary — frontend steering §7).
 *
 * Everything here is scoped to a single Writing Type id (Requirement 23.4): a
 * Field Expert may be assigned several, and the active one scopes the whole
 * surface.
 *
 * Two invariants are enforced by the shapes / call style, not just by copy:
 *
 *  - **Rename is a label-only update that preserves the category id**
 *    (Requirement 24.1 / linkage-by-id). {@link renameCategory} issues a
 *    `PATCH` against the existing category id carrying only a new label — never
 *    a delete-then-create — so Feedback-Item linkage by id survives.
 *  - **No `replacementProse`, ever** (REQ-CORE-NOGHOST-01). Every request body
 *    is parsed through a `.strict()` schema before it leaves this module, so a
 *    payload trying to smuggle replacement prose fails validation at the
 *    boundary. The authoritative save-time guardrail is backend task 12.3.
 */
import { z } from 'zod';

import { writingTypeSchema } from '@wren/types';

import {
  addCategorySchema,
  addReferenceSchema,
  aggregateAnalyticsSchema,
  domainPromptFormSchema,
  errorCategorySchema,
  promptConfigSchema,
  referenceMaterialSchema,
  referenceMaterialsSchema,
  renameCategorySchema,
  taxonomySchema,
} from './fieldExpertSchemas';

import type {
  AddCategoryValues,
  AddReferenceValues,
  AggregateAnalytics,
  DomainPromptFormValues,
  ErrorCategory,
  PromptConfig,
  ReferenceMaterial,
  RenameCategoryValues,
  Taxonomy,
} from './fieldExpertSchemas';
import type { WritingType } from '@wren/types';
import type { HttpClient } from '@/services';

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

/** The Writing Types the current Field Expert is assigned to (Requirement 23.4). */
export const FIELD_EXPERT_WRITING_TYPES_PATH = '/field-expert/writing-types';

export function taxonomyPath(writingTypeId: string): string {
  return `/writing-types/${writingTypeId}/taxonomy`;
}

export function categoryPath(writingTypeId: string, categoryId: string): string {
  return `/writing-types/${writingTypeId}/taxonomy/${categoryId}`;
}

export function promptConfigPath(writingTypeId: string): string {
  return `/writing-types/${writingTypeId}/prompt-config`;
}

export function domainPromptPath(writingTypeId: string): string {
  return `/writing-types/${writingTypeId}/prompt-config/domain-prompt`;
}

export function referenceMaterialsPath(writingTypeId: string): string {
  return `/writing-types/${writingTypeId}/reference-materials`;
}

export function referenceMaterialPath(
  writingTypeId: string,
  referenceId: string,
): string {
  return `/writing-types/${writingTypeId}/reference-materials/${referenceId}`;
}

export function aggregateAnalyticsPath(writingTypeId: string): string {
  return `/writing-types/${writingTypeId}/aggregate-analytics`;
}

const writingTypesSchema = z.array(writingTypeSchema);

/* -------------------------------------------------------------------------- */
/* Active-Writing-Type selection (Requirement 23.4)                            */
/* -------------------------------------------------------------------------- */

/** The Writing Types the current Field Expert is assigned to (may be several). */
export function fetchFieldExpertWritingTypes(
  client: HttpClient,
): Promise<WritingType[]> {
  return client.request(FIELD_EXPERT_WRITING_TYPES_PATH, {
    schema: writingTypesSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Taxonomy (Requirement 24.1)                                                 */
/* -------------------------------------------------------------------------- */

/** The active Writing Type's error taxonomy (categories are data, not an enum). */
export function fetchTaxonomy(
  client: HttpClient,
  writingTypeId: string,
): Promise<Taxonomy> {
  return client.request(taxonomyPath(writingTypeId), { schema: taxonomySchema });
}

/** Adds a new error category; the server assigns the stable id. */
export function addCategory(
  client: HttpClient,
  writingTypeId: string,
  values: AddCategoryValues,
): Promise<ErrorCategory> {
  const body = addCategorySchema.parse(values);
  return client.request(taxonomyPath(writingTypeId), {
    method: 'POST',
    body,
    schema: errorCategorySchema,
  });
}

/**
 * Renames a category. This is a label-only `PATCH` against the existing id — it
 * never deletes and recreates — so Feedback-Item linkage by id is preserved
 * (Requirement 24.1). The response is the same category with its id intact.
 */
export function renameCategory(
  client: HttpClient,
  writingTypeId: string,
  categoryId: string,
  values: RenameCategoryValues,
): Promise<ErrorCategory> {
  const body = renameCategorySchema.parse(values);
  return client.request(categoryPath(writingTypeId, categoryId), {
    method: 'PATCH',
    body,
    schema: errorCategorySchema,
  });
}

/** Removes a category, returning the remaining taxonomy. */
export function removeCategory(
  client: HttpClient,
  writingTypeId: string,
  categoryId: string,
): Promise<Taxonomy> {
  return client.request(categoryPath(writingTypeId, categoryId), {
    method: 'DELETE',
    schema: taxonomySchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Prompt + convention config (Requirement 32.2)                               */
/* -------------------------------------------------------------------------- */

/** The active Writing Type's prompt config (editable domain prompt + read-only scaffolding). */
export function fetchPromptConfig(
  client: HttpClient,
  writingTypeId: string,
): Promise<PromptConfig> {
  return client.request(promptConfigPath(writingTypeId), {
    schema: promptConfigSchema,
  });
}

/**
 * Saves the Field-Expert-editable domain prompt (Requirement 32.2). Only the
 * inner prompt layer is sent — the Admin-owned system scaffolding is never part
 * of this payload. Returns the updated {@link PromptConfig}.
 */
export function saveDomainPrompt(
  client: HttpClient,
  writingTypeId: string,
  values: DomainPromptFormValues,
): Promise<PromptConfig> {
  const body = domainPromptFormSchema.parse(values);
  return client.request(domainPromptPath(writingTypeId), {
    method: 'PUT',
    body,
    schema: promptConfigSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Domain-scoped reference materials (Requirement 26)                          */
/* -------------------------------------------------------------------------- */

/** The active Writing Type's domain-scoped reference materials (tier 2). */
export function fetchReferenceMaterials(
  client: HttpClient,
  writingTypeId: string,
): Promise<ReferenceMaterial[]> {
  return client.request(referenceMaterialsPath(writingTypeId), {
    schema: referenceMaterialsSchema,
  });
}

/**
 * Adds a reference material via one of the three input types (file /
 * pasted-text / rich-html). The input is validated before it leaves this
 * module; the response is the created entry (no partial persistence — the
 * server returns the entry only once fully stored).
 */
export function addReferenceMaterial(
  client: HttpClient,
  writingTypeId: string,
  values: AddReferenceValues,
): Promise<ReferenceMaterial> {
  const body = addReferenceSchema.parse(values);
  return client.request(referenceMaterialsPath(writingTypeId), {
    method: 'POST',
    body,
    schema: referenceMaterialSchema,
  });
}

/** Removes a reference material, returning the remaining domain-scoped list. */
export function removeReferenceMaterial(
  client: HttpClient,
  writingTypeId: string,
  referenceId: string,
): Promise<ReferenceMaterial[]> {
  return client.request(referenceMaterialPath(writingTypeId, referenceId), {
    method: 'DELETE',
    schema: referenceMaterialsSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Aggregate, domain-scoped analytics (Requirement 40.1)                       */
/* -------------------------------------------------------------------------- */

/** All-users aggregate analytics for the active Writing Type (no per-user rows). */
export function fetchAggregateAnalytics(
  client: HttpClient,
  writingTypeId: string,
): Promise<AggregateAnalytics> {
  return client.request(aggregateAnalyticsPath(writingTypeId), {
    schema: aggregateAnalyticsSchema,
  });
}
