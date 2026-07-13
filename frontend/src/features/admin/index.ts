/**
 * Barrel for the (System) Admin technical console feature (task 19.4):
 * Model configuration, system prompt/guardrails, application settings,
 * Organizations management, system-wide user/role view, usage limits,
 * and platform aggregate analytics.
 *
 * Route path: `/admin`
 */

/* Top-level console component */
export { AdminConsole, type AdminConsoleProps } from './components/AdminConsole';

/* Sub-components */
export { ModelConfigForm, type ModelConfigFormProps } from './components/ModelConfigForm';
export { SystemPromptForm, type SystemPromptFormProps } from './components/SystemPromptForm';
export { AppSettingsForm, type AppSettingsFormProps } from './components/AppSettingsForm';
export { OrganizationsList, type OrganizationsListProps } from './components/OrganizationsList';
export { SystemUsersList, type SystemUsersListProps } from './components/SystemUsersList';
export { UsageLimitsPanel, type UsageLimitsPanelProps } from './components/UsageLimitsPanel';
export {
  PlatformAnalyticsView,
  type PlatformAnalyticsViewProps,
} from './components/PlatformAnalyticsView';

/* Data-fetching + mutation hooks */
export {
  useModelConfig,
  useSaveModelConfig,
  useSystemPromptConfig,
  useSaveSystemPromptConfig,
  useAppSettings,
  useSaveAppSettings,
  useAdminOrganizations,
  useCreateOrganization,
  useRemoveOrganization,
  useSetOrganizationAccessState,
  useAssignOrgOwner,
  useSystemUsers,
  useUsageLimits,
  useUpdateUsageLimit,
  usePlatformAnalytics,
} from './useAdmin';

/* API functions */
export {
  ADMIN_MODEL_CONFIG_PATH,
  ADMIN_SYSTEM_PROMPT_PATH,
  ADMIN_APP_SETTINGS_PATH,
  ADMIN_ORGANIZATIONS_PATH,
  ADMIN_USERS_PATH,
  ADMIN_USAGE_LIMITS_PATH,
  ADMIN_ANALYTICS_PATH,
  fetchModelConfig,
  saveModelConfig,
  fetchSystemPromptConfig,
  saveSystemPromptConfig,
  fetchAppSettings,
  saveAppSettings,
  fetchOrganizations,
  createOrganization,
  removeOrganization,
  setOrganizationAccessState,
  assignOrgOwner,
  fetchSystemUsers,
  fetchUsageLimits,
  updateUsageLimit,
  fetchPlatformAnalytics,
} from './adminApi';

/* Feature schemas + inferred types */
export {
  modelConfigSchema,
  modelConfigInputSchema,
  systemPromptConfigSchema,
  systemPromptConfigInputSchema,
  appSettingsSchema,
  appSettingsInputSchema,
  adminOrganizationSchema,
  createOrganizationInputSchema,
  setOrganizationAccessStateInputSchema,
  assignOrgOwnerInputSchema,
  systemUserSchema,
  systemUsersSchema,
  usageScopeSchema,
  usageLimitViewSchema,
  usageLimitsSchema,
  updateUsageLimitInputSchema,
  analyticsMetricSchema,
  platformAnalyticsSchema,
  adminAckSchema,
  type ModelConfig,
  type ModelConfigInput,
  type SystemPromptConfig,
  type SystemPromptConfigInput,
  type AppSettings,
  type AppSettingsInput,
  type AdminOrganization,
  type CreateOrganizationInput,
  type SetOrganizationAccessStateInput,
  type AssignOrgOwnerInput,
  type SystemUser,
  type UsageScope,
  type UsageLimitView,
  type UpdateUsageLimitInput,
  type AnalyticsMetric,
  type PlatformAnalytics,
  type AdminAck,
} from './adminSchemas';
