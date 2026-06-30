import type { App } from "aws-cdk-lib";
import type { Environment } from "aws-cdk-lib";

/**
 * Single-source defaults for the CDK application.
 *
 * The application name defaults to `leon` in code/dev and is overridden to the
 * desired display name (e.g. "WREN") purely through configuration (CDK context
 * or, at runtime, SSM) - never by editing source. See REQ-NFR-APPNAME-01 and
 * the design's Infrastructure section.
 */
export const DEFAULT_APP_NAME = "leon";
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
export const DEFAULT_BEDROCK_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0";

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
  /** Configurable application name; defaults to `leon`. Never a hardcoded brand literal. */
  readonly appName: string;
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
   * Defaults to `${appName}-${environmentName}` when not explicitly provided.
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
 *   - `appName`         -> defaults to `leon`
 *   - `environmentName` -> defaults to `dev`
 *   - `bedrockModelId`  -> defaults to DEFAULT_BEDROCK_MODEL_ID
 *   - `stackPrefix`     -> defaults to `${appName}-${environmentName}`
 *
 * Override at synth/deploy time, e.g.:
 *   cdk synth -c appName=wren -c environmentName=prod
 *   cdk synth -c bedrockModelId=anthropic.claude-3-5-haiku-20241022-v1:0
 */
export function resolveAppConfig(app: App): AppConfig {
  const appName = readContext(app, "appName") ?? DEFAULT_APP_NAME;
  const environmentName = readContext(app, "environmentName") ?? DEFAULT_ENVIRONMENT_NAME;
  const bedrockModelId = readContext(app, "bedrockModelId") ?? DEFAULT_BEDROCK_MODEL_ID;
  const stackPrefix = readContext(app, "stackPrefix") ?? `${appName}-${environmentName}`;

  return {
    appName,
    environmentName,
    bedrockModelId,
    stackPrefix,
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION ?? DEFAULT_REGION,
    },
  };
}

/**
 * Build the conventional stack id for a concern: `${StackPrefix}-<Concern>`
 * (e.g. `leon-dev-Vpc`). Later tasks (2.1+) use this to name concern stacks.
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
} as const;

/**
 * Conventional name for the DynamoDB conversation/session-state table.
 *
 * Scoped to `${StackPrefix}` only — it deliberately carries NO brand or
 * application name (no "leon"/"wren"), per the design's Storage stack note.
 */
export function conversationTableName(config: AppConfig): string {
  return `${config.stackPrefix}-ConversationHistory`;
}
