import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as kms from "aws-cdk-lib/aws-kms";

import { APP_DB_ROLES, type AppDbRole } from "../lib/appDbRoles.js";
import type { AppConfig } from "../lib/config.js";
import { ComputeStack } from "../lib/stacks/ComputeStack.js";
import { testConfig, TEST_ACCOUNT, TEST_REGION } from "./helpers";

type CfnResource = {
  readonly Properties?: {
    readonly FunctionName?: string;
    readonly Environment?: { readonly Variables?: Record<string, unknown> };
  };
};

/**
 * Prompt-cache Lambda env propagation (plan §15). Both feedback Lambdas MUST
 * receive CACHE_MODE / CACHE_TTL / CACHE_ENABLED_WORKLOADS from the resolved
 * config. The default posture propagates observe/5m/'' (caching effectively
 * OFF); the `off` mode propagates the rollback value.
 */
function synthFeedbackEnv(config: AppConfig): {
  readonly orchestrator: Record<string, unknown>;
  readonly engine: Record<string, unknown>;
} {
  const app = new App();
  const stubs = new Stack(new App(), "CacheTestStubs", { env: config.env });
  const vpc = ec2.Vpc.fromVpcAttributes(stubs, "Vpc", {
    vpcId: "vpc-0123456789abcdef0",
    availabilityZones: [`${TEST_REGION}a`, `${TEST_REGION}b`],
    privateSubnetIds: ["subnet-0aaaaaaaaaaaaaaa1", "subnet-0bbbbbbbbbbbbbbb2"],
    privateSubnetRouteTableIds: ["rtb-0aaaaaaaaaaaaaaa1", "rtb-0bbbbbbbbbbbbbbb2"],
  });
  const storageEncryptionKey = kms.Key.fromKeyArn(
    stubs,
    "StorageKey",
    `arn:aws:kms:${TEST_REGION}:${TEST_ACCOUNT}:key/00000000-0000-4000-8000-000000000000`,
  );
  const databaseSecretArns = Object.fromEntries(
    APP_DB_ROLES.map((role) => [
      role,
      `arn:aws:secretsmanager:${TEST_REGION}:${TEST_ACCOUNT}:secret:${config.stackPrefix}/database/${role}-AbCdEf`,
    ]),
  ) as Record<AppDbRole, string>;

  const stack = new ComputeStack(app, `${config.stackPrefix}-Compute`, {
    env: config.env,
    config,
    vpc,
    feedbackEngineRepository: ecr.Repository.fromRepositoryName(
      stubs,
      "FeedbackEngineRepo",
      `${config.stackPrefix}-feedback-engine`,
    ),
    databaseProxyEndpoint: "test-proxy.proxy-abcdefghijkl.ca-central-1.rds.amazonaws.com",
    databaseSecretArns,
    documentsBucketName: "wren-test-storage-documents",
    referenceBucketName: "wren-test-storage-reference",
    storageEncryptionKey,
    conversationTableName: "wren-test-conversations",
    userPoolId: `${TEST_REGION}_TESTPOOL1`,
    userPoolClientId: "1exampleclientid234567890a",
    promptGuardrailId: "gr-abcd1234efgh",
  });

  const template = Template.fromStack(stack);
  const functions = template.findResources("AWS::Lambda::Function") as Record<
    string,
    CfnResource
  >;
  const byName = (suffix: string): Record<string, unknown> => {
    const fn = Object.values(functions).find(
      (resource) => resource.Properties?.FunctionName === `${config.stackPrefix}-${suffix}`,
    );
    if (!fn) throw new Error(`Synthesized Compute stack lacked the ${suffix} Lambda`);
    return fn.Properties?.Environment?.Variables ?? {};
  };

  return { orchestrator: byName("feedback-orchestrator"), engine: byName("feedback-engine") };
}

describe("ComputeStack — prompt-cache Lambda environment", () => {
  it("propagates the safe observe/5m/'' defaults to both feedback Lambdas", () => {
    const { orchestrator, engine } = synthFeedbackEnv(testConfig());

    for (const env of [orchestrator, engine]) {
      expect(env.CACHE_MODE).toBe("observe");
      expect(env.CACHE_TTL).toBe("5m");
      expect(env.CACHE_ENABLED_WORKLOADS).toBe("");
    }
  });

  it("propagates explicit overrides to both feedback Lambdas", () => {
    const { orchestrator, engine } = synthFeedbackEnv(
      testConfig({
        cacheMode: "explicit",
        cacheTtl: "1h",
        cacheEnabledWorkloads: ["ask_wren", "feedback_primary"],
      }),
    );

    for (const env of [orchestrator, engine]) {
      expect(env.CACHE_MODE).toBe("explicit");
      expect(env.CACHE_TTL).toBe("1h");
      expect(env.CACHE_ENABLED_WORKLOADS).toBe("ask_wren,feedback_primary");
    }
  });

  it("propagates the off rollback mode to both feedback Lambdas", () => {
    const { orchestrator, engine } = synthFeedbackEnv(testConfig({ cacheMode: "off" }));

    expect(orchestrator.CACHE_MODE).toBe("off");
    expect(engine.CACHE_MODE).toBe("off");
  });

  it("propagates the CORS origin allowlist to the orchestrator (not the engine)", () => {
    const { orchestrator, engine } = synthFeedbackEnv(
      testConfig({ customDomain: "coach.example.com" }),
    );
    expect(orchestrator.CORS_ALLOWED_ORIGINS).toContain("https://coach.example.com");
    expect(orchestrator.CORS_ALLOW_AMPLIFY_ORIGINS).toBe("true");
    expect(engine.CORS_ALLOWED_ORIGINS).toBeUndefined();
  });
});
