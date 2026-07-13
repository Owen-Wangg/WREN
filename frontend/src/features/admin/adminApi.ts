/**
 * Admin console API calls — thin functions over the shared {@link HttpClient}
 * (frontend steering §11: never bypass the shared API client wrapper),
 * mirroring the `fieldExpertApi.ts` convention (plain functions taking the
 * client, with a Zod schema validating every response at the boundary —
 * frontend steering §7).
 *
 * Scope is platform-wide (Requirements 33.1–33.4, 41.1, 41.2). NOTHING in this
 * module touches business Topics, Content Types, or custom-metadata fields
 * (Requirement 33.5 — those are Org-Owner territory).
 */
import { z } from 'zod';

import {
  adminAckSchema,
  adminOrganizationSchema,
  appSettingsInputSchema,
  appSettingsSchema,
  assignOrgOwnerInputSchema,
  createOrganizationInputSchema,
  modelConfigInputSchema,
  modelConfigSchema,
  platformAnalyticsSchema,
  setOrganizationAccessStateInputSchema,
  systemPromptConfigInputSchema,
  systemPromptConfigSchema,
  systemUsersSchema,
  updateUsageLimitInputSchema,
  usageLimitsSchema,
} from './adminSchemas';

import type {
  AdminAck,
  AdminOrganization,
  AppSettings,
  AppSettingsInput,
  AssignOrgOwnerInput,
  CreateOrganizationInput,
  ModelConfig,
  ModelConfigInput,
  PlatformAnalytics,
  SetOrganizationAccessStateInput,
  SystemPromptConfig,
  SystemPromptConfigInput,
  SystemUser,
  UpdateUsageLimitInput,
  UsageLimitView,
} from './adminSchemas';
import type { HttpClient } from '@/services';

/* -------------------------------------------------------------------------- */
/* Paths                                                                       */
/* -------------------------------------------------------------------------- */

export const ADMIN_MODEL_CONFIG_PATH = '/admin/model-config';
export const ADMIN_SYSTEM_PROMPT_PATH = '/admin/system-prompt';
export const ADMIN_APP_SETTINGS_PATH = '/admin/app-settings';
export const ADMIN_ORGANIZATIONS_PATH = '/admin/organizations';
export const ADMIN_USERS_PATH = '/admin/users';
export const ADMIN_USAGE_LIMITS_PATH = '/admin/usage-limits';
export const ADMIN_ANALYTICS_PATH = '/admin/analytics';

const adminOrganizationsSchema = z.array(adminOrganizationSchema);

/* -------------------------------------------------------------------------- */
/* Model configuration (Requirement 33.1)                                      */
/* -------------------------------------------------------------------------- */

export function fetchModelConfig(client: HttpClient): Promise<ModelConfig> {
  return client.request(ADMIN_MODEL_CONFIG_PATH, { schema: modelConfigSchema });
}

export function saveModelConfig(
  client: HttpClient,
  values: ModelConfigInput,
): Promise<ModelConfig> {
  const body = modelConfigInputSchema.parse(values);
  return client.request(ADMIN_MODEL_CONFIG_PATH, {
    method: 'PUT',
    body,
    schema: modelConfigSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* System prompt / guardrail configuration (Requirement 33.1)                  */
/* -------------------------------------------------------------------------- */

export function fetchSystemPromptConfig(
  client: HttpClient,
): Promise<SystemPromptConfig> {
  return client.request(ADMIN_SYSTEM_PROMPT_PATH, {
    schema: systemPromptConfigSchema,
  });
}

export function saveSystemPromptConfig(
  client: HttpClient,
  values: SystemPromptConfigInput,
): Promise<SystemPromptConfig> {
  const body = systemPromptConfigInputSchema.parse(values);
  return client.request(ADMIN_SYSTEM_PROMPT_PATH, {
    method: 'PUT',
    body,
    schema: systemPromptConfigSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Application-level settings (Requirement 33.1)                               */
/* -------------------------------------------------------------------------- */

export function fetchAppSettings(client: HttpClient): Promise<AppSettings> {
  return client.request(ADMIN_APP_SETTINGS_PATH, { schema: appSettingsSchema });
}

export function saveAppSettings(
  client: HttpClient,
  values: AppSettingsInput,
): Promise<AppSettings> {
  const body = appSettingsInputSchema.parse(values);
  return client.request(ADMIN_APP_SETTINGS_PATH, {
    method: 'PUT',
    body,
    schema: appSettingsSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Organizations (Requirement 33.2)                                            */
/* -------------------------------------------------------------------------- */

export function fetchOrganizations(
  client: HttpClient,
): Promise<AdminOrganization[]> {
  return client.request(ADMIN_ORGANIZATIONS_PATH, {
    schema: adminOrganizationsSchema,
  });
}

export function createOrganization(
  client: HttpClient,
  values: CreateOrganizationInput,
): Promise<AdminOrganization> {
  const body = createOrganizationInputSchema.parse(values);
  return client.request(ADMIN_ORGANIZATIONS_PATH, {
    method: 'POST',
    body,
    schema: adminOrganizationSchema,
  });
}

export function removeOrganization(
  client: HttpClient,
  organizationId: string,
): Promise<AdminAck> {
  return client.request(`${ADMIN_ORGANIZATIONS_PATH}/${organizationId}`, {
    method: 'DELETE',
    schema: adminAckSchema,
  });
}

export function setOrganizationAccessState(
  client: HttpClient,
  values: SetOrganizationAccessStateInput,
): Promise<AdminOrganization> {
  const body = setOrganizationAccessStateInputSchema.parse(values);
  return client.request(
    `${ADMIN_ORGANIZATIONS_PATH}/${values.organizationId}/access-state`,
    { method: 'PUT', body, schema: adminOrganizationSchema },
  );
}

export function assignOrgOwner(
  client: HttpClient,
  values: AssignOrgOwnerInput,
): Promise<AdminOrganization> {
  const body = assignOrgOwnerInputSchema.parse(values);
  return client.request(
    `${ADMIN_ORGANIZATIONS_PATH}/${values.organizationId}/owner`,
    { method: 'PUT', body, schema: adminOrganizationSchema },
  );
}

/* -------------------------------------------------------------------------- */
/* System-wide user/role view (Requirement 33.3)                               */
/* -------------------------------------------------------------------------- */

export function fetchSystemUsers(client: HttpClient): Promise<SystemUser[]> {
  return client.request(ADMIN_USERS_PATH, { schema: systemUsersSchema });
}

/* -------------------------------------------------------------------------- */
/* Usage limits (Requirement 33.4)                                             */
/* -------------------------------------------------------------------------- */

export function fetchUsageLimits(
  client: HttpClient,
): Promise<UsageLimitView[]> {
  return client.request(ADMIN_USAGE_LIMITS_PATH, { schema: usageLimitsSchema });
}

export function updateUsageLimit(
  client: HttpClient,
  values: UpdateUsageLimitInput,
): Promise<AdminAck> {
  const body = updateUsageLimitInputSchema.parse(values);
  return client.request(`${ADMIN_USAGE_LIMITS_PATH}/${values.id}`, {
    method: 'PUT',
    body,
    schema: adminAckSchema,
  });
}

/* -------------------------------------------------------------------------- */
/* Platform / org aggregate analytics (Requirements 41.1, 41.2)                */
/* -------------------------------------------------------------------------- */

export function fetchPlatformAnalytics(
  client: HttpClient,
  writingTypeId?: string,
): Promise<PlatformAnalytics> {
  const path = writingTypeId
    ? `${ADMIN_ANALYTICS_PATH}?writingTypeId=${writingTypeId}`
    : ADMIN_ANALYTICS_PATH;
  return client.request(path, { schema: platformAnalyticsSchema });
}
