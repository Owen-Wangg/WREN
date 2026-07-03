/**
 * Validation schemas + inferred types for the (System) Admin technical console
 * (task 19.4; Requirements 33.1–33.5, 41.1, 41.2).
 *
 * These shapes are colocated with the Admin feature (frontend steering §5, §9)
 * and compose the shared domain contract (`@wren/types`) wherever a shared
 * shape already exists — `accessStateSchema` for Organization OPEN/LOCKED state
 * and `roleSchema` for the system-wide user/role view — rather than redefining
 * them inline (frontend steering §7: shared types are the single source of
 * truth). Every schema is `.strict()` so unknown keys fail at the API boundary.
 *
 * Deliberate boundary (Requirement 33.5): NOTHING in this module models a
 * business Topic, Content Type, or custom-metadata field. Those are Org-Owner
 * business concerns (task 19.3 / Requirement 34) and never appear in the
 * technical/platform-level Admin console.
 */
import { z } from 'zod';

import { accessStateSchema, idSchema, isoDateTimeSchema, roleSchema } from '@wren/types';

/* -------------------------------------------------------------------------- */
/* Model configuration (Requirement 33.1 → REQ-NFR-MODEL-01)                   */
/* -------------------------------------------------------------------------- */

/**
 * Bedrock model configuration. The model id is presented as an editable
 * configuration value — never a hardcoded model literal (tasks 1.4 / 9.3:
 * "changing the model is configuration only"). The default shown in the UI is
 * always sourced from the mock API fixture / live config, so this module ships
 * no model-id literal of its own.
 */
export const modelConfigSchema = z
  .object({
    /** The configured Bedrock model identifier (editable configuration). */
    modelId: z.string().min(1),
    /** Sampling temperature (0–1). */
    temperature: z.number().min(0).max(1),
    /** Upper bound on generated tokens per invocation. */
    maxOutputTokens: z.number().int().positive(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type ModelConfig = z.infer<typeof modelConfigSchema>;

/** Editable fields for a model-config update (server owns `updatedAt`). */
export const modelConfigInputSchema = modelConfigSchema
  .omit({ updatedAt: true })
  .strict();
export type ModelConfigInput = z.infer<typeof modelConfigInputSchema>;

/* -------------------------------------------------------------------------- */
/* System prompt / guardrail configuration (Requirement 33.1)                  */
/* -------------------------------------------------------------------------- */

/**
 * System-level prompt scaffolding + guardrail text owned by the Admin. This is
 * the authoritative outer layer that always takes precedence over Field-Expert
 * Writing-Type prompts (design "layered prompt assembly"; Requirement 32.3).
 */
export const systemPromptConfigSchema = z
  .object({
    /** Cross-domain system scaffolding (the authoritative outer layer). */
    systemScaffold: z.string().min(1),
    /** No-ghostwriting guardrail instructions applied to every generation. */
    guardrailInstructions: z.string().min(1),
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type SystemPromptConfig = z.infer<typeof systemPromptConfigSchema>;

export const systemPromptConfigInputSchema = systemPromptConfigSchema
  .omit({ updatedAt: true })
  .strict();
export type SystemPromptConfigInput = z.infer<typeof systemPromptConfigInputSchema>;

/* -------------------------------------------------------------------------- */
/* Application-level settings (Requirement 33.1 → REQ-NFR-APPNAME-01)          */
/* -------------------------------------------------------------------------- */

/**
 * Application-level settings. `appName` is the single application-name
 * configuration value (Requirement 53.2); the form seeds its default from the
 * single config source (`appConfig.appName`), never a brand literal.
 */
export const appSettingsSchema = z
  .object({
    appName: z.string().min(1),
    supportEmail: z.string().email(),
    /** Platform default document size limit in words. */
    defaultSizeLimitWords: z.number().int().positive(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type AppSettings = z.infer<typeof appSettingsSchema>;

export const appSettingsInputSchema = appSettingsSchema
  .omit({ updatedAt: true })
  .strict();
export type AppSettingsInput = z.infer<typeof appSettingsInputSchema>;

/* -------------------------------------------------------------------------- */
/* Organizations (Requirement 33.2 — create/remove + OPEN/LOCKED)              */
/* -------------------------------------------------------------------------- */

/**
 * An Organization grouping as seen by the Admin. `accessState` reuses the
 * shared `accessStateSchema` (OPEN/LOCKED) — the effective submission control
 * (Requirement 28). `ownerUserId` is the assigned Org Owner, if any.
 */
export const adminOrganizationSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    accessState: accessStateSchema,
    ownerUserId: idSchema.nullable(),
  })
  .strict();
export type AdminOrganization = z.infer<typeof adminOrganizationSchema>;

export const createOrganizationInputSchema = z
  .object({ name: z.string().min(1, 'Organization name is required.') })
  .strict();
export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;

export const setOrganizationAccessStateInputSchema = z
  .object({ organizationId: idSchema, accessState: accessStateSchema })
  .strict();
export type SetOrganizationAccessStateInput = z.infer<
  typeof setOrganizationAccessStateInputSchema
>;

export const assignOrgOwnerInputSchema = z
  .object({ organizationId: idSchema, userId: idSchema })
  .strict();
export type AssignOrgOwnerInput = z.infer<typeof assignOrgOwnerInputSchema>;

/* -------------------------------------------------------------------------- */
/* System-wide user/role view (Requirement 33.3)                               */
/* -------------------------------------------------------------------------- */

/**
 * A single row of the system-wide User/role view. Members are global (not
 * tenant-scoped); the Admin searches/filters across all Users by name, email,
 * and role (Requirement 29.1 / REQ-ORG-02).
 */
export const systemUserSchema = z
  .object({
    id: idSchema,
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    role: roleSchema,
  })
  .strict();
export type SystemUser = z.infer<typeof systemUserSchema>;

export const systemUsersSchema = z.array(systemUserSchema);

/* -------------------------------------------------------------------------- */
/* Usage limits + current usage (Requirement 33.4)                             */
/* -------------------------------------------------------------------------- */

/** The scope a usage limit is attributed to (never a "home org"). */
export const usageScopeSchema = z.enum(['platform', 'organization', 'writing-type']);
export type UsageScope = z.infer<typeof usageScopeSchema>;

/**
 * A configured usage/token limit with its current usage counter. `scopeRef` is
 * the Organization or Writing-Type id the limit applies to, or `null` for the
 * platform-wide scope.
 */
export const usageLimitViewSchema = z
  .object({
    id: idSchema,
    scope: usageScopeSchema,
    scopeRef: idSchema.nullable(),
    /** Human-readable label for the scope target (e.g. org / writing-type name). */
    scopeLabel: z.string().min(1),
    limitActions: z.number().int().positive(),
    currentUsage: z.number().int().nonnegative(),
  })
  .strict();
export type UsageLimitView = z.infer<typeof usageLimitViewSchema>;

export const usageLimitsSchema = z.array(usageLimitViewSchema);

export const updateUsageLimitInputSchema = z
  .object({ id: idSchema, limitActions: z.number().int().positive() })
  .strict();
export type UpdateUsageLimitInput = z.infer<typeof updateUsageLimitInputSchema>;

/* -------------------------------------------------------------------------- */
/* Platform / org aggregate analytics (Requirements 41.1, 41.2)                */
/* -------------------------------------------------------------------------- */

/**
 * A single aggregate analytics metric. Values are ALWAYS all-users aggregate
 * totals — never a per-User score or named entry (Requirement 41.3, 41.6).
 */
export const analyticsMetricSchema = z
  .object({
    label: z.string().min(1),
    value: z.number(),
    /** Optional unit hint for display (e.g. "documents", "actions"). */
    unit: z.string().min(1).optional(),
  })
  .strict();
export type AnalyticsMetric = z.infer<typeof analyticsMetricSchema>;

/**
 * Aggregate analytics across the platform or an Organization grouping,
 * optionally filtered by Writing Type (Requirement 41.1, 41.2). There is
 * deliberately no per-User array here — the shape cannot express named
 * per-User rows (Requirement 41.3).
 */
export const platformAnalyticsSchema = z
  .object({
    scope: z.enum(['platform', 'organization']),
    /** The Writing Type filter applied, or `null` for all writing types. */
    writingTypeId: idSchema.nullable(),
    /** All-users aggregate metrics only. */
    metrics: z.array(analyticsMetricSchema),
  })
  .strict();
export type PlatformAnalytics = z.infer<typeof platformAnalyticsSchema>;

/** Generic acknowledgement returned by Admin mutations. */
export const adminAckSchema = z.object({ ok: z.boolean() }).strict();
export type AdminAck = z.infer<typeof adminAckSchema>;
