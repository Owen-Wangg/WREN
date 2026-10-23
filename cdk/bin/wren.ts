#!/usr/bin/env node
import { App, aws_iam as iam } from "aws-cdk-lib";
import { resolveAppConfig, stackName } from "../lib/config.js";
import { applyStandardTags } from "../lib/tags.js";
import { ConfigStack } from "../lib/stacks/ConfigStack.js";
import { VpcStack } from "../lib/stacks/VpcStack.js";
import { CognitoStack } from "../lib/stacks/CognitoStack.js";
import { DatabaseStack } from "../lib/stacks/DatabaseStack.js";
import { StorageStack } from "../lib/stacks/StorageStack.js";
import { ApiStack } from "../lib/stacks/ApiStack.js";
import { ComputeStack } from "../lib/stacks/ComputeStack.js";
import { CloudFrontWafStack } from "../lib/stacks/CloudFrontWafStack.js";
import { AmplifyStack } from "../lib/stacks/AmplifyStack.js";
import { ObservabilityStack } from "../lib/stacks/ObservabilityStack.js";
import { CicdStack } from "../lib/stacks/CicdStack.js";

/**
 * CDK application entry point for the WREN Writing Coach infrastructure.
 *
 * This file resolves the shared configuration (StackPrefix / environmentName /
 * account / region), applies cost-allocation tags at the app scope so every
 * stack inherits them, and wires up the foundational concern stacks. Each stack
 * is named `${StackPrefix}-<Concern>` via the `stackName` helper in
 * lib/config.ts:
 *
 *   - Config   — SSM config parameters (app name + Bedrock model id)
 *   - Vpc      — three-tier VPC, VPC endpoints, flow logs
 *   - Database — RDS PostgreSQL 16 + RDS Proxy
 *   - Storage  — S3 buckets + DynamoDB conversation table
 *
 * Additional concern stacks (Api / Compute / ...) are added in later tasks.
 */
const app = new App();

const config = resolveAppConfig(app);

// Cost-allocation + governance tags. Applied at the app scope so they
// propagate to every stack (per-stack: cdk.Tags.of(stack).add("Project", StackPrefix)).
applyStandardTags(app, config);

/** Read a value from CDK context, falling back to an environment variable. */
function ctxOrEnv(key: string, envVar: string): string | undefined {
  const ctx = app.node.tryGetContext(key) as unknown;
  if (typeof ctx === "string" && ctx.trim().length > 0) return ctx.trim();
  const value = process.env[envVar];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function boolCtxOrEnv(key: string, envVar: string, fallback = false): boolean {
  const raw = ctxOrEnv(key, envVar);
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${key}/${envVar} must be exactly 'true' or 'false'`);
}

// GitHub source configuration for Amplify hosting + the CI/CD pipeline. Read
// from CDK context (`-c githubOwner=… -c githubRepo=… -c codestarConnectionArn=…`)
// or the GITHUB_* environment variables — never hardcoded. When absent, the
// Amplify/CICD stacks are skipped so the core app still deploys (see below).
const github = {
  owner: ctxOrEnv("githubOwner", "GITHUB_OWNER"),
  repo: ctxOrEnv("githubRepo", "GITHUB_REPO"),
  branch: ctxOrEnv("githubBranch", "GITHUB_BRANCH") ?? "main",
};
// Default ON, matching the deploy workflow (config.ts defaults WREN_ENABLE_CICD
// to true). cdk.json also sets `enableCicd: true` in context; this explicit
// fallback keeps a bare `cdk deploy` (no context, no env var) from silently
// dropping the pipeline. Opt out with `-c enableCicd=false` or WREN_ENABLE_CICD=false.
const enableCicd = boolCtxOrEnv("enableCicd", "WREN_ENABLE_CICD", true);
const ecrOwnership =
  ctxOrEnv("ecrOwnership", "WREN_ECR_OWNERSHIP") ?? "managed";
if (ecrOwnership !== "managed" && ecrOwnership !== "external") {
  throw new Error(
    "ecrOwnership/WREN_ECR_OWNERSHIP must be 'managed' or 'external'",
  );
}
if (enableCicd && (!github.owner || !github.repo)) {
  throw new Error(
    "GitHub owner and repository are required when CI/CD is enabled",
  );
}

// Mandatory deployment prerequisites retain their historical Cicd stack
// ownership. Only the pipeline resources are optional.
const cicdStack = new CicdStack(app, stackName(config, "Cicd"), {
  env: config.env,
  config,
  ecrOwnership,
  enablePipeline: enableCicd,
  ...(github.owner ? { repositoryOwner: github.owner } : {}),
  ...(github.repo ? { repositoryName: github.repo } : {}),
  branch: github.branch,
});

// Single-source application configuration (app name + Bedrock model id) is
// published to SSM by the Config stack so backend Lambdas resolve it at runtime
// rather than via source literals (REQ-NFR-APPNAME-01, REQ-NFR-MODEL-01).
const configStack = new ConfigStack(app, stackName(config, "Config"), {
  env: config.env,
  config,
});

// Foundational persistence + network stacks (Track A · A0). Each is named
// `${StackPrefix}-<Concern>` and lives in the configured region (default
// ca-central-1) so all persistent stores honour data residency (REQ 46.x).
const vpcStack = new VpcStack(app, stackName(config, "Vpc"), {
  env: config.env,
  config,
});

// The Database stack receives the concrete VPC from the Vpc stack (stacks wire
// resources together; constructs receive concrete objects per CDK steering).
// It also exposes the RDS Proxy endpoint + credentials-secret ARN so the
// Compute stack wires Lambdas to the real database (no placeholders).
const databaseStack = new DatabaseStack(app, stackName(config, "Database"), {
  env: config.env,
  config,
  vpc: vpcStack.vpc,
});

const storageStack = new StorageStack(app, stackName(config, "Storage"), {
  env: config.env,
  config,
});

// Cognito stack - User authentication
const cognitoStack = new CognitoStack(app, stackName(config, "Cognito"), {
  env: config.env,
  config,
});

// Compute stack - Lambda functions (depends on VPC, Database, Storage, Cognito)
const computeStack = new ComputeStack(app, stackName(config, "Compute"), {
  env: config.env,
  config,
  vpc: vpcStack.vpc,
  feedbackEngineRepository: cicdStack.ecrRepository,
  databaseProxyEndpoint: databaseStack.proxyEndpoint,
  databaseSecretArns: databaseStack.appDbSecretArns,
  documentsBucketName: storageStack.documentsBucketName,
  referenceBucketName: storageStack.referenceBucketName,
  storageEncryptionKey: storageStack.storage.encryptionKey,
  conversationTableName: storageStack.conversationTableName,
  userPoolId: cognitoStack.userPoolId,
  userPoolClientId: cognitoStack.userPoolClientId,
  promptGuardrailId:
    configStack.parameters.promptGuardrailIdParameter.stringValue,
});

// The prerequisite stack is always present, so use its real managed-policy
// reference. This creates a CloudFormation dependency instead of relying on a
// constructed ARN whose policy may not exist yet.
iam.PermissionsBoundary.of(computeStack).apply(cicdStack.computeBoundaryPolicy);
computeStack.addStackDependency(cicdStack);

// API Gateway stack (depends on Compute for Lambda function ARNs).
// `crossRegionReferences` lets the us-east-1 CloudFront/WAF stack consume this
// stack's (ca-central-1) API endpoint.
const apiStack = new ApiStack(app, stackName(config, "Api"), {
  env: config.env,
  config,
  crossRegionReferences: true,
  authorizerFunctionArn: computeStack.authorizerFunction.functionArn,
  documentFunctionArn: computeStack.documentFunction.functionArn,
  feedbackFunctionArn: computeStack.feedbackOrchestratorFunction.functionArn,
  adminFunctionArn: computeStack.adminFunction.functionArn,
  notificationFunctionArn: computeStack.notificationFunction.functionArn,
});

// Observability stack (CloudWatch, X-Ray, alarms)
const observabilityStack = new ObservabilityStack(app, stackName(config, "Observability"), {
  env: config.env,
  config,
  functionNames: [
    computeStack.authorizerFunction.functionName,
    computeStack.documentFunction.functionName,
    computeStack.feedbackOrchestratorFunction.functionName,
    computeStack.feedbackEngineFunction.functionName,
    computeStack.adminFunction.functionName,
    computeStack.diffAnchorProgressFunction.functionName,
    computeStack.notificationFunction.functionName,
    // Construct IDs are derived from each function name (see ObservabilityStack),
    // not from list position, so order here no longer affects logical IDs:
    // you may add, remove, or reorder entries without churning the others.
    computeStack.syncCognitoAdminsFunction.functionName,
  ],
  feedbackQueueName: computeStack.feedbackQueue.queueName,
  feedbackDlqName: computeStack.feedbackDlq.queueName,
  notificationDlqName: computeStack.notificationDlq.queueName,
  documentIngestDlqName: computeStack.documentIngestDlq.queueName,
  authorizerFunctionName: computeStack.authorizerFunction.functionName,
  // API Gateway access-log group for the security metric filters.
  apiAccessLogGroupName: apiStack.accessLogGroupName,
  // CloudTrail caller attribution for the operator-only TechnicalAdmin sync.
  // Reuses the existing Compute export for this name (no new cross-stack ref).
  privilegedInvokeFunctionNames: [computeStack.syncCognitoAdminsFunction.functionName],
});
// The access-log metric filters reference the ApiStack's log group by name, so
// that group must exist before Observability deploys. Make the ordering explicit
// (no CFN output is consumed, so CDK would not otherwise infer it).
observabilityStack.addDependency(apiStack);

// CloudFront + WAF stack. A CLOUDFRONT-scoped WAF WebACL MUST live in
// us-east-1, so this stack is pinned there regardless of the app's residency
// region; `crossRegionReferences` lets it read the ca-central-1 API endpoint.
new CloudFrontWafStack(app, stackName(config, "CloudFrontWaf"), {
  env: { account: config.env.account, region: "us-east-1" },
  crossRegionReferences: true,
  config,
  apiEndpoint: apiStack.apiEndpoint,
});

// Amplify hosting + CI/CD are only synthesized when their GitHub source is
// configured. This keeps the core app (Vpc/Database/Storage/Compute/Api/
// Observability/CloudFrontWaf) deployable without a GitHub connection, instead
// of shipping placeholder owner/repo/connection values that fail at deploy.
//
// apiEndpoint may be overridden via `-c apiEndpoint=…` (or API_ENDPOINT) so
// Amplify can be redeployed without a CloudFormation import of the API Gateway
// Stage — required when updating the Api stack's OpenAPI definition while
// Amplify still holds the old Stage export.
const amplifyApiEndpoint =
  ctxOrEnv("apiEndpoint", "API_ENDPOINT") ?? apiStack.apiEndpoint;

if (github.owner && github.repo) {
  new AmplifyStack(app, stackName(config, "Amplify"), {
    env: config.env,
    config,
    repositoryOwner: github.owner,
    repositoryName: github.repo,
    branch: github.branch,
    githubTokenSecretName: `${config.stackPrefix}/github/token`,
    apiEndpoint: amplifyApiEndpoint,
    cognitoUserPoolId: cognitoStack.userPoolId,
    cognitoClientId: cognitoStack.userPoolClientId,
    appSyncGraphqlUrl: computeStack.appSyncGraphqlUrl,
    documentsBucketName: storageStack.documentsBucketName,
  });
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "[wren] Skipping Amplify stack — set -c githubOwner=<owner> -c githubRepo=<repo> (or GITHUB_OWNER/GITHUB_REPO) to enable frontend hosting.",
  );
}

app.synth();
