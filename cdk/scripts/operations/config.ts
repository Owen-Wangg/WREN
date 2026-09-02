import {
  DEFAULT_APP_NAME,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_ENVIRONMENT_NAME,
  DEFAULT_PROJECT_NAME,
  DEFAULT_REGION,
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
  readonly githubOwner?: string;
  readonly githubRepo?: string;
  readonly githubBranch: string;
  readonly githubToken?: string;
  readonly enableAmplify: boolean;
  readonly enableCicd: boolean;
  readonly ecrOwnership: EcrOwnership;
  readonly adminEmail?: string;
  readonly smokeAccessToken?: string;
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
    throw new Error("WREN_EXPECTED_ACCOUNT_ID must be a 12-digit AWS account ID.");
  }
}

function validateName(name: string, envName: string): void {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(name)) {
    throw new Error(`${envName} must start with a lowercase letter and contain only lowercase letters, digits, or hyphens.`);
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

export function parseDeploymentConfig(
  env: NodeJS.ProcessEnv = process.env,
  operation: "deploy" | "undeploy" = "deploy",
): DeploymentConfig {
  const expectedAccountId = value(env, "WREN_EXPECTED_ACCOUNT_ID");
  const region = value(env, "WREN_REGION") ?? DEFAULT_REGION;
  const appName = value(env, "WREN_APP_NAME") ?? DEFAULT_APP_NAME;
  const projectName = value(env, "WREN_PROJECT_NAME") ?? DEFAULT_PROJECT_NAME;
  const environmentName = value(env, "WREN_ENVIRONMENT") ?? DEFAULT_ENVIRONMENT_NAME;
  const derivedPrefix = `${projectName}-${environmentName}`;
  const stackPrefix = value(env, "WREN_STACK_PREFIX") ?? derivedPrefix;
  const bedrockModelId = value(env, "WREN_BEDROCK_MODEL_ID") ?? DEFAULT_BEDROCK_MODEL_ID;
  const githubOwner = value(env, "WREN_GITHUB_OWNER");
  const githubRepo = value(env, "WREN_GITHUB_REPO");
  const githubBranch = value(env, "WREN_GITHUB_BRANCH") ?? "main";
  const githubToken = value(env, "WREN_GITHUB_TOKEN");
  const enableAmplify = parseBoolean(env, "WREN_ENABLE_AMPLIFY", true);
  const enableCicd = parseBoolean(env, "WREN_ENABLE_CICD", false);
  const nonInteractive = parseBoolean(env, "WREN_NON_INTERACTIVE", env.CI === "true");
  const dryRun = parseBoolean(env, "WREN_DRY_RUN", false);
  const bootstrapMissing = parseBoolean(env, "WREN_BOOTSTRAP_MISSING", !nonInteractive);
  const adminEmail = value(env, "WREN_ADMIN_EMAIL");
  const smokeAccessToken = value(env, "WREN_SMOKE_ACCESS_TOKEN");
  const engineImageTag = value(env, "WREN_ENGINE_IMAGE_TAG");

  validateAccountId(expectedAccountId);
  validateRegion(region);
  validateName(projectName, "WREN_PROJECT_NAME");
  validateName(environmentName, "WREN_ENVIRONMENT");
  validateImageTag(engineImageTag);
  validateEmail(adminEmail);

  if (stackPrefix !== derivedPrefix) {
    throw new Error(`WREN_STACK_PREFIX must equal the derived prefix '${derivedPrefix}'.`);
  }
  if (operation === "deploy" && (enableAmplify || enableCicd) && (!githubOwner || !githubRepo)) {
    throw new Error("WREN_GITHUB_OWNER and WREN_GITHUB_REPO are required when Amplify or CI/CD is enabled.");
  }
  if ((nonInteractive || environmentName === "prod") && !expectedAccountId) {
    throw new Error("WREN_EXPECTED_ACCOUNT_ID is required in CI/non-interactive and production deployments.");
  }

  return {
    ...(expectedAccountId ? { expectedAccountId } : {}),
    region,
    appName,
    projectName,
    environmentName,
    stackPrefix,
    bedrockModelId,
    ...(githubOwner ? { githubOwner } : {}),
    ...(githubRepo ? { githubRepo } : {}),
    githubBranch,
    ...(githubToken ? { githubToken } : {}),
    enableAmplify,
    enableCicd,
    ecrOwnership: enumValue(env, "WREN_ECR_OWNERSHIP", ["managed", "external"], "managed"),
    ...(adminEmail ? { adminEmail } : {}),
    ...(smokeAccessToken ? { smokeAccessToken } : {}),
    adminAlreadyConfigured: parseBoolean(env, "WREN_ADMIN_ALREADY_CONFIGURED", false),
    dryRun,
    nonInteractive,
    bootstrapMissing,
    requireApproval: enumValue(env, "WREN_REQUIRE_APPROVAL", ["broadening", "never"], nonInteractive ? "never" : "broadening"),
    ...(engineImageTag ? { engineImageTag } : {}),
    ...(value(env, "WREN_UNDEPLOY_CONFIRM") ? { undeployConfirm: value(env, "WREN_UNDEPLOY_CONFIRM") } : {}),
  };
}

export function publicDeploymentConfig(config: DeploymentConfig): Record<string, unknown> {
  return {
    expectedAccountId: config.expectedAccountId,
    region: config.region,
    appName: config.appName,
    projectName: config.projectName,
    environmentName: config.environmentName,
    stackPrefix: config.stackPrefix,
    bedrockModelId: config.bedrockModelId,
    githubOwner: config.githubOwner,
    githubRepo: config.githubRepo,
    githubBranch: config.githubBranch,
    enableAmplify: config.enableAmplify,
    enableCicd: config.enableCicd,
    ecrOwnership: config.ecrOwnership,
    adminConfiguredOverride: config.adminAlreadyConfigured,
    dryRun: config.dryRun,
    nonInteractive: config.nonInteractive,
    bootstrapMissing: config.bootstrapMissing,
    requireApproval: config.requireApproval,
    engineImageTag: config.engineImageTag,
  };
}
