import type { App } from "aws-cdk-lib";
import type { Environment } from "aws-cdk-lib";

/**
 * Single-source defaults for the CDK application.
 *
 * The project/codebase identity is WREN: all stack, resource, and table names
 * derive from {@link DEFAULT_PROJECT_NAME} (`wren`), never from the display
 * name. The configurable application *display* name is decoupled from infra
 * naming (REQ-NFR-APPNAME-01) and is surfaced only through the SSM app-name
 * parameter the frontend reads.
 */

/**
 * The configurable application DISPLAY name (REQ-NFR-APPNAME-01).
 *
 * This is the SOLE permitted occurrence of the brand literal in the entire
 * codebase. It feeds only the SSM app-name parameter (the runtime display
 * name); it MUST NOT drive any stack/resource/table naming. The display name is
 * overridden purely through configuration (CDK context or, at runtime, SSM) —
 * never by editing other source. See REQ-NFR-APPNAME-01 and the design's
 * Infrastructure section.
 */
export const DEFAULT_APP_NAME = "LEON";

/**
 * The project identifier that drives ALL stack/resource/table naming.
 *
 * Decoupled from {@link DEFAULT_APP_NAME} so the display name never leaks into
 * infrastructure names. `stackPrefix` defaults to `${projectName}-${environmentName}`
 * (e.g. `wren-dev`).
 */
export const DEFAULT_PROJECT_NAME = "wren";
export const DEFAULT_ENVIRONMENT_NAME = "dev";

/**
 * Single-source default for the Bedrock model identifier (REQ-NFR-MODEL-01).
 *
 * Model invocation is model-agnostic (via `langchain-aws`); this is only a
 * *default* and is overridden at synth time with `-c bedrockModelId=...` or at
 * runtime via the SSM parameter published by the `Config` stack. No backend
 * code hardcodes a model id - it is resolved from configuration. Changing the
 * model is therefore a configuration edit, not a code change.
 */
export const DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-6";

/**
 * Data residency: all persistent stores live in ca-central-1 (design:
 * "all in `ca-central-1`", REQ 46.x). Used as the region fallback when
 * CDK_DEFAULT_REGION is not supplied by the environment.
 */
export const DEFAULT_REGION = "ca-central-1";

/**
 * Resolved, immutable configuration shared by every stack in the app.
 */
export interface AppConfig {
  /**
   * Configurable application DISPLAY name; defaults to {@link DEFAULT_APP_NAME}.
   * Used SOLELY for the SSM app-name value — never for resource naming.
   */
  readonly appName: string;
  /**
   * Project identifier that drives all stack/resource naming; defaults to
   * {@link DEFAULT_PROJECT_NAME} (`wren`). Decoupled from {@link appName}.
   */
  readonly projectName: string;
  /** Deployment environment name (e.g. `dev`, `staging`, `prod`). */
  readonly environmentName: string;
  /**
   * Configurable Bedrock model identifier (REQ-NFR-MODEL-01). Resolved from
   * configuration (CDK context for synth, SSM at runtime); never hardcoded in
   * backend orchestration logic. Defaults to {@link DEFAULT_BEDROCK_MODEL_ID}.
   */
  readonly bedrockModelId: string;
  /**
   * Prefix that drives all stack/resource naming: `${StackPrefix}-<Concern>`.
   * Defaults to `${projectName}-${environmentName}` when not explicitly
   * provided — it derives from the project name, never from {@link appName}.
   */
  readonly stackPrefix: string;
  /** Account/region passed to every stack. */
  readonly env: Required<Pick<Environment, "region">> & Environment;
}

function readContext(app: App, key: string): string | undefined {
  const value = app.node.tryGetContext(key) as unknown;
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the application configuration from CDK context with sensible
 * defaults, and the deployment account/region from the standard CDK
 * environment variables.
 *
 * Context keys (all optional):
 *   - `appName`         -> defaults to `LEON` (display name only)
 *   - `projectName`     -> defaults to `wren` (drives resource naming)
 *   - `environmentName` -> defaults to `dev`
 *   - `bedrockModelId`  -> defaults to DEFAULT_BEDROCK_MODEL_ID
 *   - `stackPrefix`     -> defaults to `${projectName}-${environmentName}`
 *
 * Override at synth/deploy time, e.g.:
 *   cdk synth -c appName="My Coach" -c environmentName=prod
 *   cdk synth -c bedrockModelId=anthropic.claude-3-5-haiku-20241022-v1:0
 */
export function resolveAppConfig(app: App): AppConfig {
  const appName = readContext(app, "appName") ?? DEFAULT_APP_NAME;
  const projectName = readContext(app, "projectName") ?? DEFAULT_PROJECT_NAME;
  const environmentName = readContext(app, "environmentName") ?? DEFAULT_ENVIRONMENT_NAME;
  const bedrockModelId = readContext(app, "bedrockModelId") ?? DEFAULT_BEDROCK_MODEL_ID;
  const stackPrefix = readContext(app, "stackPrefix") ?? `${projectName}-${environmentName}`;

  // Data residency (REQ 46.x): persistent stores MUST live in ca-central-1.
  // The region is resolved from the `region` context key and otherwise pinned
  // to ca-central-1 — deliberately NOT read from CDK_DEFAULT_REGION, so a
  // deployer's ambient AWS profile region can never silently place resources
  // outside the residency boundary. Override explicitly with `-c region=...`.
  const region = readContext(app, "region") ?? DEFAULT_REGION;

  return {
    appName,
    projectName,
    environmentName,
    bedrockModelId,
    stackPrefix,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region,
    },
  };
}

/**
 * Build the conventional stack id for a concern: `${StackPrefix}-<Concern>`
 * (e.g. `wren-dev-Vpc`). Later tasks (2.1+) use this to name concern stacks.
 */
export function stackName(config: AppConfig, concern: string): string {
  return `${config.stackPrefix}-${concern}`;
}

/**
 * SSM Parameter Store path for the runtime application name (REQ-NFR-APPNAME-01).
 *
 * Backend Lambdas read the application name from this parameter at runtime
 * instead of from any source literal. The path is scoped to `StackPrefix`
 * only and carries no separate brand literal.
 */
export function appNameParameterName(config: AppConfig): string {
  return `/${config.stackPrefix}/config/app-name`;
}

/**
 * SSM Parameter Store path for the runtime Bedrock model id (REQ-NFR-MODEL-01).
 *
 * Backend Lambdas resolve the model id from this parameter at runtime so the
 * model can change with no code change beyond configuration.
 */
export function bedrockModelIdParameterName(config: AppConfig): string {
  return `/${config.stackPrefix}/config/bedrock-model-id`;
}

/**
 * Cross-stack SSM parameter paths.
 *
 * Per the CDK steering, foundational stacks publish their resource identifiers
 * to SSM Parameter Store rather than via CloudFormation cross-stack exports, so
 * downstream stacks (Api / Compute / ...) can resolve them without tight
 * coupling. Every path is scoped to `${StackPrefix}` only and carries no brand
 * literal.
 */
export const ssmParameterNames = {
  /** VPC id published by the `Vpc` stack. */
  vpcId: (config: AppConfig): string => `/${config.stackPrefix}/network/vpc-id`,
  /** RDS Proxy endpoint hostname published by the `Database` stack. */
  databaseProxyEndpoint: (config: AppConfig): string =>
    `/${config.stackPrefix}/database/proxy-endpoint`,
  /** ARN of the Secrets Manager secret holding DB admin credentials. */
  databaseSecretArn: (config: AppConfig): string =>
    `/${config.stackPrefix}/database/secret-arn`,
  /** Name of the S3 bucket holding submitted document bytes. */
  documentsBucketName: (config: AppConfig): string =>
    `/${config.stackPrefix}/storage/documents-bucket-name`,
  /** Name of the S3 bucket holding Reference Material bytes. */
  referenceBucketName: (config: AppConfig): string =>
    `/${config.stackPrefix}/storage/reference-bucket-name`,
  /** Name of the DynamoDB conversation/session-state table. */
  conversationTableName: (config: AppConfig): string =>
    `/${config.stackPrefix}/storage/conversation-table-name`,
  /** Cognito User Pool ID published by the `Cognito` stack. */
  userPoolId: (config: AppConfig): string => `/${config.stackPrefix}/auth/user-pool-id`,
  /** Cognito User Pool Client ID published by the `Cognito` stack. */
  userPoolClientId: (config: AppConfig): string => `/${config.stackPrefix}/auth/client-id`,
} as const;

/**
 * Conventional name for the DynamoDB conversation/session-state table.
 *
 * Scoped to `${StackPrefix}` only (e.g. `wren-dev-ConversationHistory`) — it
 * carries NO display/brand literal. The prefix derives from the project name
 * (`wren`), per the design's Storage stack note.
 */
export function conversationTableName(config: AppConfig): string {
  return `${config.stackPrefix}-ConversationHistory`;
}
