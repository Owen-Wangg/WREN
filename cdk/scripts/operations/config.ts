import {
  isSignupEmailDomainAllowed,
  parseAllowedEmailDomains,
} from "../../lib/signupEmailDomains.js";

import {
  CACHE_WORKLOADS,
  DEFAULT_APP_NAME,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CACHE_MODE,
  DEFAULT_CACHE_TTL,
  DEFAULT_ENVIRONMENT_NAME,
  DEFAULT_PROJECT_NAME,
  DEFAULT_REGION,
  type CacheMode,
  type CacheTtl,
  type CacheWorkload,
} from "../../lib/config.js";

export type EcrOwnership = "managed" | "external";
export type ApprovalMode = "broadening" | "never";

export interface DeploymentConfig {
  readonly expectedAccountId?: string;
  readonly region: string;
  readonly appName: string;
  readonly projectName: string;
  readonly environmentName: string;
  readonly stackPrefix: string;
  readonly bedrockModelId: string;
  /** Prompt-cache mode (plan §15). Safe default `observe`. */
  readonly cacheMode: CacheMode;
  /** Prompt-cache write TTL (plan §7/§10). Safe default `5m`. */
  readonly cacheTtl: CacheTtl;
  /** Workloads with explicit caching enabled (plan §14/§15). Default: none. */
  readonly cacheEnabledWorkloads: readonly CacheWorkload[];
  readonly githubOwner?: string;
  readonly githubRepo?: string;
  readonly githubBranch: string;
  readonly githubToken?: string;
  readonly enableAmplify: boolean;
  readonly enableCicd: boolean;
  readonly ecrOwnership: EcrOwnership;
  /**
   * Optional custom domain (e.g. `example.com`) mapped to the Amplify
   * production branch (root + `www`). Absent by default, in which case the
   * frontend is reachable only via the Amplify default `*.amplifyapp.com`
   * domain. No domain is ever hard-coded.
   */
  readonly customDomain?: string;
  /**
   * Exact email hostnames allowed for new Cognito self-signups (e.g. `ubc.ca`).
   * Required for `deploy` (an empty list would deny every signup). Subdomains
   * are not implied.
   */
  readonly allowedEmailDomains: readonly string[];
  readonly adminEmail?: string;
  readonly adminAlreadyConfigured: boolean;
  readonly dryRun: boolean;
  readonly nonInteractive: boolean;
  readonly bootstrapMissing: boolean;
  readonly requireApproval: ApprovalMode;
  readonly engineImageTag?: string;
  readonly undeployConfirm?: string;
}

function value(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const candidate = env[name]?.trim();
  return candidate ? candidate : undefined;
}

export function parseBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
): boolean {
  const raw = value(env, name);
  if (raw === undefined) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be exactly 'true' or 'false'.`);
}

function enumValue<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: readonly T[],
  defaultValue: T,
): T {
  const raw = value(env, name);
  if (raw === undefined) return defaultValue;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
}

function validateAccountId(accountId: string | undefined): void {
  if (accountId !== undefined && !/^\d{12}$/.test(accountId)) {
    throw new Error(
      "WREN_EXPECTED_ACCOUNT_ID must be a 12-digit AWS account ID.",
    );
  }
}

function validateName(name: string, envName: string): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) {
    throw new Error(
      `${envName} must start with a lowercase letter and contain only lowercase letters, digits, or hyphens.`,
    );
  }
}

function validateRegion(region: string): void {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
    throw new Error("WREN_REGION must be a valid AWS region identifier.");
  }
}

function validateImageTag(tag: string | undefined): void {
  if (tag !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    throw new Error("WREN_ENGINE_IMAGE_TAG is not a valid ECR image tag.");
  }
}

function validateEmail(email: string | undefined): void {
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("WREN_ADMIN_EMAIL must be a valid email address.");
  }
}

/**
 * Validate an optional custom domain (e.g. `example.com`). Conservative
 * hostname check: two or more dot-separated labels, each label lowercase
 * `[a-z0-9-]` not starting/ending with a hyphen, no scheme, no trailing dot,
 * no path. Rejects uppercase, spaces, and empty labels so a typo is caught
 * before the Amplify domain association is synthesized.
 */
function validateCustomDomain(domain: string | undefined): void {
  if (domain === undefined) return;
  // Each label: 1–63 chars, lowercase `[a-z0-9]`, optional internal hyphens,
  // no leading/trailing hyphen. The `{0,61}` bound (plus the mandatory first
  // and last chars) caps a label at 63 characters, matching DNS and Amplify's
  // own per-label limit so an over-long label fails here with a clear message
  // instead of deep in CDK synth.
  const label = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  const hostname = new RegExp(`^(?:${label}\\.)+${label}$`);
  if (domain.length > 253 || !hostname.test(domain)) {
    throw new Error(
      "WREN_CUSTOM_DOMAIN must be a bare lowercase hostname like 'example.com' (no scheme, path, or trailing dot).",
    );
  }
}

/** Resolve WREN_CACHE_MODE; safe default `observe`, reject anything else. */
function resolveCacheModeEnv(raw: string | undefined): CacheMode {
  if (raw === undefined) return DEFAULT_CACHE_MODE;
  const v = raw.toLowerCase();
  if (v === "off" || v === "observe" || v === "explicit") return v;
  throw new Error("WREN_CACHE_MODE must be one of: off, observe, explicit.");
}

/** Resolve WREN_CACHE_TTL; safe default `5m`, reject anything else. */
function resolveCacheTtlEnv(raw: string | undefined): CacheTtl {
  if (raw === undefined) return DEFAULT_CACHE_TTL;
  const v = raw.toLowerCase();
  if (v === "5m" || v === "1h") return v;
  throw new Error("WREN_CACHE_TTL must be one of: 5m, 1h.");
}

/**
 * Resolve WREN_CACHE_ENABLED_WORKLOADS into canonical workload tokens. Empty /
 * absent yields NO workloads (safe default). Unknown tokens are rejected so a
 * typo is caught before deploy.
 */
function resolveCacheEnabledWorkloadsEnv(
  raw: string | undefined,
): CacheWorkload[] {
  if (raw === undefined) return [];
  const known = new Set<string>(CACHE_WORKLOADS);
  const result: CacheWorkload[] = [];
  for (const rawToken of raw.split(/[,\s]+/)) {
    const token = rawToken.trim().toLowerCase().replace(/-/g, "_");
    if (token.length === 0) continue;
    if (!known.has(token)) {
      throw new Error(
        `WREN_CACHE_ENABLED_WORKLOADS contains unknown workload '${rawToken}'. ` +
          `Allowed: ${CACHE_WORKLOADS.join(", ")}.`,
      );
    }
    if (!result.includes(token as CacheWorkload))
      result.push(token as CacheWorkload);
  }
  return result;
}

export function parseDeploymentConfig(
  env: NodeJS.ProcessEnv = process.env,
  operation: "deploy" | "undeploy" = "deploy",
): DeploymentConfig {
  const expectedAccountId = value(env, "WREN_EXPECTED_ACCOUNT_ID");
  const region = value(env, "WREN_REGION") ?? DEFAULT_REGION;
  const appName = value(env, "WREN_APP_NAME") ?? DEFAULT_APP_NAME;
  const projectName = value(env, "WREN_PROJECT_NAME") ?? DEFAULT_PROJECT_NAME;
  const environmentName =
    value(env, "WREN_ENVIRONMENT") ?? DEFAULT_ENVIRONMENT_NAME;
  const derivedPrefix = `${projectName}-${environmentName}`;
  const stackPrefix = value(env, "WREN_STACK_PREFIX") ?? derivedPrefix;
  const bedrockModelId =
    value(env, "WREN_BEDROCK_MODEL_ID") ?? DEFAULT_BEDROCK_MODEL_ID;
  const cacheMode = resolveCacheModeEnv(value(env, "WREN_CACHE_MODE"));
  const cacheTtl = resolveCacheTtlEnv(value(env, "WREN_CACHE_TTL"));
  const cacheEnabledWorkloads = resolveCacheEnabledWorkloadsEnv(
    value(env, "WREN_CACHE_ENABLED_WORKLOADS"),
  );
  const githubOwner = value(env, "WREN_GITHUB_OWNER");
  const githubRepo = value(env, "WREN_GITHUB_REPO");
  const githubBranch = value(env, "WREN_GITHUB_BRANCH") ?? "main";
  const githubToken = value(env, "WREN_GITHUB_TOKEN");
  const enableAmplify = parseBoolean(env, "WREN_ENABLE_AMPLIFY", true);
  const enableCicd = parseBoolean(env, "WREN_ENABLE_CICD", true);
  const nonInteractive = parseBoolean(
    env,
    "WREN_NON_INTERACTIVE",
    env.CI === "true",
  );
  const dryRun = parseBoolean(env, "WREN_DRY_RUN", false);
  const bootstrapMissing = parseBoolean(
    env,
    "WREN_BOOTSTRAP_MISSING",
    !nonInteractive,
  );
  const adminEmail = value(env, "WREN_ADMIN_EMAIL");
  const engineImageTag = value(env, "WREN_ENGINE_IMAGE_TAG");
  const customDomain = value(env, "WREN_CUSTOM_DOMAIN");
  const allowedEmailDomains = parseAllowedEmailDomains(
    value(env, "WREN_ALLOWED_EMAIL_DOMAINS"),
    "WREN_ALLOWED_EMAIL_DOMAINS",
  );

  validateAccountId(expectedAccountId);
  validateRegion(region);
  validateName(projectName, "WREN_PROJECT_NAME");
  validateName(environmentName, "WREN_ENVIRONMENT");
  validateImageTag(engineImageTag);
  validateEmail(adminEmail);
  validateCustomDomain(customDomain);
  if (
    allowedEmailDomains.length > 0 &&
    adminEmail !== undefined &&
    !isSignupEmailDomainAllowed(adminEmail, allowedEmailDomains)
  ) {
    throw new Error(
      "WREN_ADMIN_EMAIL must use a domain listed in WREN_ALLOWED_EMAIL_DOMAINS.",
    );
  }

  if (stackPrefix !== derivedPrefix) {
    throw new Error(
      `WREN_STACK_PREFIX must equal the derived prefix '${derivedPrefix}'.`,
    );
  }
  if (
    operation === "deploy" &&
    (enableAmplify || enableCicd) &&
    (!githubOwner || !githubRepo)
  ) {
    throw new Error(
      "WREN_GITHUB_OWNER and WREN_GITHUB_REPO are required when Amplify or CI/CD is enabled.",
    );
  }
  // Secure by default: the PreSignUp Lambda denies every signup when the list
  // is empty, so a deploy without one would lock out all new users.
  if (operation === "deploy" && allowedEmailDomains.length === 0) {
    throw new Error(
      "WREN_ALLOWED_EMAIL_DOMAINS is required: list the exact email domains allowed to sign up (for example 'ubc.ca,student.ubc.ca').",
    );
  }
  if ((nonInteractive || environmentName === "prod") && !expectedAccountId) {
    throw new Error(
      "WREN_EXPECTED_ACCOUNT_ID is required in CI/non-interactive and production deployments.",
    );
  }

  return {
    ...(expectedAccountId ? { expectedAccountId } : {}),
    region,
    appName,
    projectName,
    environmentName,
    stackPrefix,
    bedrockModelId,
    cacheMode,
    cacheTtl,
    cacheEnabledWorkloads,
    ...(githubOwner ? { githubOwner } : {}),
    ...(githubRepo ? { githubRepo } : {}),
    githubBranch,
    ...(githubToken ? { githubToken } : {}),
    enableAmplify,
    enableCicd,
    ecrOwnership: enumValue(
      env,
      "WREN_ECR_OWNERSHIP",
      ["managed", "external"],
      "managed",
    ),
    ...(customDomain ? { customDomain } : {}),
    allowedEmailDomains,
    ...(adminEmail ? { adminEmail } : {}),
    adminAlreadyConfigured: parseBoolean(
      env,
      "WREN_ADMIN_ALREADY_CONFIGURED",
      false,
    ),
    dryRun,
    nonInteractive,
    bootstrapMissing,
    requireApproval: enumValue(
      env,
      "WREN_REQUIRE_APPROVAL",
      ["broadening", "never"],
      nonInteractive ? "never" : "broadening",
    ),
    ...(engineImageTag ? { engineImageTag } : {}),
    ...(value(env, "WREN_UNDEPLOY_CONFIRM")
      ? { undeployConfirm: value(env, "WREN_UNDEPLOY_CONFIRM") }
      : {}),
  };
}

export function publicDeploymentConfig(
  config: DeploymentConfig,
): Record<string, unknown> {
  return {
    expectedAccountId: config.expectedAccountId,
    region: config.region,
    appName: config.appName,
    projectName: config.projectName,
    environmentName: config.environmentName,
    stackPrefix: config.stackPrefix,
    bedrockModelId: config.bedrockModelId,
    cacheMode: config.cacheMode,
    cacheTtl: config.cacheTtl,
    cacheEnabledWorkloads: config.cacheEnabledWorkloads.join(",") || "(none)",
    githubOwner: config.githubOwner,
    githubRepo: config.githubRepo,
    githubBranch: config.githubBranch,
    enableAmplify: config.enableAmplify,
    enableCicd: config.enableCicd,
    ecrOwnership: config.ecrOwnership,
    // Echoed for the deploy summary. NOTE: publicDeploymentConfig feeds the
    // checkpoint configFingerprint, so changing WREN_CUSTOM_DOMAIN invalidates
    // an in-flight checkpoint — intended, since a domain change is a real
    // config change that should force reconfirmation.
    customDomain: config.customDomain ?? "(amplify default)",
    allowedEmailDomains:
      config.allowedEmailDomains.join(",") || "(none: signup denied)",
    adminConfiguredOverride: config.adminAlreadyConfigured,
    dryRun: config.dryRun,
    nonInteractive: config.nonInteractive,
    bootstrapMissing: config.bootstrapMissing,
    requireApproval: config.requireApproval,
    engineImageTag: config.engineImageTag,
  };
}
