#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { resolveAppConfig, stackName } from "../lib/config.js";
import { applyStandardTags } from "../lib/tags.js";
import { ConfigStack } from "../lib/stacks/ConfigStack.js";
import { VpcStack } from "../lib/stacks/VpcStack.js";
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
new DatabaseStack(app, stackName(config, "Database"), {
  env: config.env,
  config,
  vpc: vpcStack.vpc,
});

const storageStack = new StorageStack(app, stackName(config, "Storage"), {
  env: config.env,
  config,
});

// Compute stack - Lambda functions (depends on VPC, Database, Storage)
// Note: For now we create with minimal props; full props would come from Database/Storage stacks
const computeStack = new ComputeStack(app, stackName(config, "Compute"), {
  env: config.env,
  config,
  vpc: vpcStack.vpc,
  databaseProxyEndpoint: "db-proxy.example.com", // TODO: resolve from Database stack
  databaseSecretArn: "arn:aws:secretsmanager:ca-central-1:123456789012:secret:db-creds",
  documentsBucketName: storageStack.documentsBucketName,
  referenceBucketName: storageStack.referenceBucketName,
  conversationTableName: storageStack.conversationTableName,
});

// API Gateway stack (depends on Compute for Lambda function ARNs)
const apiStack = new ApiStack(app, stackName(config, "Api"), {
  env: config.env,
  config,
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

// CloudFront + WAF stack
new CloudFrontWafStack(app, stackName(config, "CloudFrontWaf"), {
  env: config.env,
  config,
  apiEndpoint: apiStack.apiEndpoint,
});

// Amplify hosting stack
new AmplifyStack(app, stackName(config, "Amplify"), {
  env: config.env,
  config,
  repositoryOwner: process.env.GITHUB_OWNER || "anthropics",
  repositoryName: process.env.GITHUB_REPO || "wren",
  githubTokenSecretName: `/${config.stackPrefix}/github/token`,
  apiEndpoint: apiStack.apiEndpoint,
});

// CICD stack (CodePipeline, CodeBuild)
new CicdStack(app, stackName(config, "Cicd"), {
  env: config.env,
  config,
  repositoryOwner: process.env.GITHUB_OWNER || "anthropics",
  repositoryName: process.env.GITHUB_REPO || "wren",
  branch: process.env.GITHUB_BRANCH || "main",
  connectionArn: process.env.GITHUB_CONNECTION_ARN || "arn:aws:codestarconnections:ca-central-1:123456789012:connection/wren",
});

app.synth();
