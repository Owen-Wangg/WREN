/**
 * Org Owner business-console API calls — thin functions over the shared
 * {@link HttpClient} (frontend steering §11: never bypass the shared API client
 * wrapper), mirroring the `fieldExpertApi.ts` / `dashboardApi.ts` convention
 * (plain functions taking the client, with a Zod schema validating every
 * response at the boundary — frontend steering §7).
 *
 * Everything here is scoped to owned Organizations only (Requirement 34.4):
 * the console never fetches or renders a platform-wide projection.
 *
 * Analytics responses are validated through `orgAggregateAnalyticsSchema`
 * (`.strict()`) which structurally rejects per-user rows, user identities, or
 * per-user scores (Requirement 34.5; REQ-AUDIT-01c).
 */
import { z } from 'zod';

import { writingTypeSchema } from '@wren/types';

import {
  contentTypesSchema,
  metadataFieldsSchema,
  orgAggregateAnalyticsSchema,
  orgMembersSchema,
  organizationsSchema,
  topicsSchema,
} from './orgOwnerTypes';

import type {
  AddMemberInput,
  AssignFieldExpertInput,
  ContentType,
  CreateContentTypeInput,
  CreateMetadataFieldInput,
  CreateTopicInput,
  CreateWritingTypeInput,
  MetadataFieldConfigDto,
  OrgAggregateAnalytics,
  OrgMember,
  Organization,
  Topic,
} from './orgOwnerTypes';
import type { WritingType } from '@wren/types';
import type { HttpClient } from '@/services';

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

export function ownedOrganizationsPath(): string {
  return '/org-owner/organizations';
}

export function orgWritingTypesPath(organizationId: string): string {
  return `/org-owner/organizations/${organizationId}/writing-types`;
}

export function orgContentTypesPath(organizationId: string): string {
  return `/org-owner/organizations/${organizationId}/content-types`;
}

export function orgTopicsPath(organizationId: string): string {
  return `/org-owner/organizations/${organizationId}/topics`;
}

export function orgMetadataFieldsPath(organizationId: string): string {
  return `/org-owner/organizations/${organizationId}/metadata-fields`;
}

export function orgMembersPath(organizationId: string): string {
  return `/org-owner/organizations/${organizationId}/members`;
}

export function orgAnalyticsPath(organizationId: string): string {
  return `/org-owner/organizations/${organizationId}/analytics`;
}

const writingTypesSchema = z.array(writingTypeSchema);

/* -------------------------------------------------------------------------- */
/* Owned Organizations list (Requirement 34.1)                                 */
/* -------------------------------------------------------------------------- */

/** The Organizations the current Org Owner owns (never a system-wide list). */
export function fetchOwnedOrganizations(
  client: HttpClient,
): Promise<Organization[]> {
  return client.request(ownedOrganizationsPath(), {
    schema: organizationsSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Writing Types within an owned Organization                                  */
/* -------------------------------------------------------------------------- */

export function fetchOrgWritingTypes(
  client: HttpClient,
  organizationId: string,
): Promise<WritingType[]> {
  return client.request(orgWritingTypesPath(organizationId), {
    schema: writingTypesSchema,
  });
}

export function createWritingType(
  client: HttpClient,
  values: CreateWritingTypeInput,
): Promise<WritingType> {
  return client.request(orgWritingTypesPath(values.organizationId), {
    method: 'POST',
    body: values,
    schema: writingTypeSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Content Types within an owned Organization                                  */
/* -------------------------------------------------------------------------- */

export function fetchOrgContentTypes(
  client: HttpClient,
  organizationId: string,
): Promise<ContentType[]> {
  return client.request(orgContentTypesPath(organizationId), {
    schema: contentTypesSchema,
  });
}

export function createContentType(
  client: HttpClient,
  values: CreateContentTypeInput,
): Promise<ContentType> {
  return client.request(orgContentTypesPath(values.organizationId), {
    method: 'POST',
    body: values,
    schema: contentTypesSchema.element,
  });
}

/* -------------------------------------------------------------------------- */
/* Topics within an owned Organization                                         */
/* -------------------------------------------------------------------------- */

export function fetchOrgTopics(
  client: HttpClient,
  organizationId: string,
): Promise<Topic[]> {
  return client.request(orgTopicsPath(organizationId), {
    schema: topicsSchema,
  });
}

export function createTopic(
  client: HttpClient,
  values: CreateTopicInput,
): Promise<Topic> {
  return client.request(orgTopicsPath(values.organizationId), {
    method: 'POST',
    body: values,
    schema: topicsSchema.element,
  });
}

/* -------------------------------------------------------------------------- */
/* Metadata fields within an owned Organization                                */
/* -------------------------------------------------------------------------- */

export function fetchOrgMetadataFields(
  client: HttpClient,
  organizationId: string,
): Promise<MetadataFieldConfigDto[]> {
  return client.request(orgMetadataFieldsPath(organizationId), {
    schema: metadataFieldsSchema,
  });
}

export function createMetadataField(
  client: HttpClient,
  values: CreateMetadataFieldInput,
): Promise<MetadataFieldConfigDto> {
  return client.request(orgMetadataFieldsPath(values.organizationId), {
    method: 'POST',
    body: values,
    schema: metadataFieldsSchema.element,
  });
}

/* -------------------------------------------------------------------------- */
/* Members (Access Grants) within an owned Organization                        */
/* -------------------------------------------------------------------------- */

export function fetchOrgMembers(
  client: HttpClient,
  organizationId: string,
): Promise<OrgMember[]> {
  return client.request(orgMembersPath(organizationId), {
    schema: orgMembersSchema,
  });
}

export function addMember(
  client: HttpClient,
  values: AddMemberInput,
): Promise<OrgMember> {
  return client.request(orgMembersPath(values.organizationId), {
    method: 'POST',
    body: values,
    schema: orgMembersSchema.element,
  });
}

export function assignFieldExpert(
  client: HttpClient,
  values: AssignFieldExpertInput,
): Promise<OrgMember> {
  return client.request(
    `${orgMembersPath(values.organizationId)}/${values.userId}/assign-field-expert`,
    {
      method: 'POST',
      body: values,
      schema: orgMembersSchema.element,
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Aggregate analytics for an owned Organization (Requirement 34.5)            */
/* -------------------------------------------------------------------------- */

/**
 * All-users aggregate analytics for an owned Organization. The response is
 * validated through `orgAggregateAnalyticsSchema` (`.strict()`) which
 * structurally rejects any per-user row or identity field.
 */
export function fetchOrgAnalytics(
  client: HttpClient,
  organizationId: string,
): Promise<OrgAggregateAnalytics> {
  return client.request(orgAnalyticsPath(organizationId), {
    schema: orgAggregateAnalyticsSchema,
  });
}
