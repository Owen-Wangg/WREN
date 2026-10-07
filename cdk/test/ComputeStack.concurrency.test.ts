import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as kms from "aws-cdk-lib/aws-kms";

import { APP_DB_ROLES, type AppDbRole } from "../lib/appDbRoles.js";
import type { AppConfig } from "../lib/config.js";
import { ComputeStack } from "../lib/stacks/ComputeStack.js";
import { testConfig, TEST_ACCOUNT, TEST_REGION } from "./helpers";

/**
 * Reserved-concurrency wiring (authorizer throttling remediation, Task 2).
 *
 * The authorizers get a guaranteed FLOOR; feedback-engine and document get a
 * CAP. This test proves the resolved config values are emitted onto the right
 * synthesized Lambda functions as `ReservedConcurrentExecutions`.
 */

type CfnFunction = {
  readonly Properties?: {
    readonly FunctionName?: string;
    readonly ReservedConcurrentExecutions?: number;
  };
};

function synthReservedConcurrency(config: AppConfig): Map<string, number | undefined> {
  const app = new App();
  const stubs = new Stack(new App(), "ConcurrencyTestStubs", { env: config.env });
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
    CfnFunction
  >;
  const byName = new Map<string, number | undefined>();
  for (const fn of Object.values(functions)) {
    const name = fn.Properties?.FunctionName;
    if (typeof name === "string") {
      byName.set(name, fn.Properties?.ReservedConcurrentExecutions);
    }
  }
  return byName;
}

describe("ComputeStack — reserved concurrency", () => {
  it("applies the configured floors and caps to the four managed functions", () => {
    const config = testConfig();
    const reserved = synthReservedConcurrency(config);
    const p = config.stackPrefix;

    expect(reserved.get(`${p}-authorizer`)).toBe(config.lambdaConcurrency.authorizer);
    expect(reserved.get(`${p}-appsync-authorizer`)).toBe(
      config.lambdaConcurrency.appsyncAuthorizer,
    );
    expect(reserved.get(`${p}-feedback-engine`)).toBe(
      config.lambdaConcurrency.feedbackEngine,
    );
    expect(reserved.get(`${p}-document`)).toBe(config.lambdaConcurrency.document);
  });

  it("does NOT reserve concurrency on the unmanaged functions (they share the remainder)", () => {
    const config = testConfig();
    const reserved = synthReservedConcurrency(config);
    const p = config.stackPrefix;

    // Unmanaged functions keep the unreserved pool; no explicit reservation.
    expect(reserved.get(`${p}-admin`)).toBeUndefined();
    expect(reserved.get(`${p}-notification`)).toBeUndefined();
  });
});
