#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { resolveAppConfig, stackName } from "../lib/config.js";
import { applyStandardTags } from "../lib/tags.js";
import { ConfigStack } from "../lib/stacks/ConfigStack.js";
import { VpcStack } from "../lib/stacks/VpcStack.js";
import { DatabaseStack } from "../lib/stacks/DatabaseStack.js";
import { StorageStack } from "../lib/stacks/StorageStack.js";

/**
 * CDK application entry point for the LEON Writing Coach infrastructure.
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

new StorageStack(app, stackName(config, "Storage"), {
  env: config.env,
  config,
});

app.synth();
