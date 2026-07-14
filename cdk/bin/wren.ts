#!/usr/bin/env node
import { App } from "aws-cdk-lib";
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

// GitHub source configuration for Amplify hosting + the CI/CD pipeline. Read
// from CDK context (`-c githubOwner=… -c githubRepo=… -c codestarConnectionArn=…`)
// or the GITHUB_* environment variables — never hardcoded. When absent, the
// Amplify/CICD stacks are skipped so the core app still deploys (see below).
const github = {
  owner: ctxOrEnv("githubOwner", "GITHUB_OWNER"),
  repo: ctxOrEnv("githubRepo", "GITHUB_REPO"),
  branch: ctxOrEnv("githubBranch", "GITHUB_BRANCH") ?? "main",
  connectionArn: ctxOrEnv("codestarConnectionArn", "GITHUB_CONNECTION_ARN"),
};

// Single-source application configuration (app name + Bedrock model id) is
// published to SSM by the Config stack so backend Lambdas resolve it at runtime
// rather than via source literals (REQ-NFR-APPNAME-01, REQ-NFR-MODEL-01).
new ConfigStack(app, stackName(config, "Config"), {
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
  databaseProxyEndpoint: databaseStack.proxyEndpoint,
  databaseSecretArn: databaseStack.databaseSecretArn,
  documentsBucketName: storageStack.documentsBucketName,
  referenceBucketName: storageStack.referenceBucketName,
  conversationTableName: storageStack.conversationTableName,
  userPoolId: cognitoStack.userPoolId,
  userPoolClientId: cognitoStack.userPoolClientId,
});

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
  auditFunctionArn: computeStack.auditFunction.functionArn,
});

// Observability stack (CloudWatch, X-Ray, alarms)
new ObservabilityStack(app, stackName(config, "Observability"), {
  env: config.env,
  config,
  functionNames: [
    computeStack.authorizerFunction.functionName,
    computeStack.documentFunction.functionName,
    computeStack.feedbackOrchestratorFunction.functionName,
    computeStack.feedbackEngineFunction.functionName,
    computeStack.adminFunction.functionName,
    computeStack.auditFunction.functionName,
    computeStack.diffAnchorProgressFunction.functionName,
  ],
  feedbackQueueName: computeStack.feedbackQueue.queueName,
  feedbackDlqName: computeStack.feedbackDlq.queueName,
});

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
if (github.owner && github.repo) {
  new AmplifyStack(app, stackName(config, "Amplify"), {
    env: config.env,
    config,
    repositoryOwner: github.owner,
    repositoryName: github.repo,
    githubTokenSecretName: `/${config.stackPrefix}/github/token`,
    apiEndpoint: apiStack.apiEndpoint,
  });
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "[wren] Skipping Amplify stack — set -c githubOwner=<owner> -c githubRepo=<repo> (or GITHUB_OWNER/GITHUB_REPO) to enable frontend hosting.",
  );
}

if (github.owner && github.repo && github.connectionArn) {
  new CicdStack(app, stackName(config, "Cicd"), {
    env: config.env,
    config,
    repositoryOwner: github.owner,
    repositoryName: github.repo,
    branch: github.branch,
    connectionArn: github.connectionArn,
  });
} else {
  // eslint-disable-next-line no-console
  console.warn(
    "[wren] Skipping CICD stack — set githubOwner/githubRepo/codestarConnectionArn (or GITHUB_OWNER/GITHUB_REPO/GITHUB_CONNECTION_ARN) to enable the pipeline.",
  );
}

app.synth();
