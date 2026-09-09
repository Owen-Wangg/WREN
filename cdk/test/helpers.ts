import { App } from "aws-cdk-lib";
import type { AppConfig } from "../lib/config.js";
import { DEFAULT_LAMBDA_CONCURRENCY } from "../lib/lambdaConcurrency.js";
import { ConfigStack } from "../lib/stacks/ConfigStack.js";
import { DatabaseStack } from "../lib/stacks/DatabaseStack.js";
import { StorageStack } from "../lib/stacks/StorageStack.js";
import { VpcStack } from "../lib/stacks/VpcStack.js";

/**
 * Shared synthesis helpers for the CDK stack tests.
 *
 * Tests build an {@link AppConfig} with a fixed account/region rather than
 * resolving it from `process.env`, so snapshots and residency assertions are
 * deterministic and independent of the developer's local AWS environment.
 */

/** The data-residency region every persistent store must live in (REQ 46.1). */
export const TEST_REGION = "ca-central-1";
export const TEST_ACCOUNT = "123456789012";

/** Build a deterministic, fully-resolved {@link AppConfig} for tests. */
export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appName: "LEON",
    projectName: "wren",
    environmentName: "test",
    bedrockModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    feedbackEngineImageTag: "bootstrap",
    auditPseudonymSaltOwnership: "managed",
    cacheMode: "observe",
    cacheTtl: "5m",
    cacheEnabledWorkloads: [],
    stackPrefix: "wren-test",
    lambdaConcurrency: DEFAULT_LAMBDA_CONCURRENCY,
    env: { account: TEST_ACCOUNT, region: TEST_REGION },
    ...overrides,
  };
}

export interface SynthesizedStacks {
  readonly app: App;
  readonly config: AppConfig;
  readonly configStack: ConfigStack;
  readonly vpcStack: VpcStack;
  readonly databaseStack: DatabaseStack;
  readonly storageStack: StorageStack;
}

/**
 * Instantiate all four foundational stacks in a single app, wired exactly as
 * `bin/wren.ts` wires them (the Database stack receives the concrete VPC).
 */
export function synthStacks(config: AppConfig = testConfig()): SynthesizedStacks {
  const app = new App();

  const configStack = new ConfigStack(app, "wren-test-Config", {
    env: config.env,
    config,
  });
  const vpcStack = new VpcStack(app, "wren-test-Vpc", {
    env: config.env,
    config,
  });
  const databaseStack = new DatabaseStack(app, "wren-test-Database", {
    env: config.env,
    config,
    vpc: vpcStack.vpc,
  });
  const storageStack = new StorageStack(app, "wren-test-Storage", {
    env: config.env,
    config,
  });

  return { app, config, configStack, vpcStack, databaseStack, storageStack };
}
