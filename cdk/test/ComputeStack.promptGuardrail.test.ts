import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as kms from "aws-cdk-lib/aws-kms";

import { APP_DB_ROLES, type AppDbRole } from "../lib/appDbRoles.js";
import { ComputeStack } from "../lib/stacks/ComputeStack.js";
import { testConfig, TEST_ACCOUNT, TEST_REGION } from "./helpers";

/**
 * Admin prompt-injection guardrail wiring (Issue #181).
 *
 * The admin scan fails closed without PROMPT_GUARDRAIL_ID, so the Admin Lambda
 * must always receive it, a literally-empty id must fail at synth, and no
 * deployed function may carry the dev/test bypass flag.
 */

type CfnFunction = {
  readonly Properties?: {
    readonly FunctionName?: string;
    readonly Environment?: { readonly Variables?: Record<string, unknown> };
  };
};

function synthCompute(promptGuardrailId: string): Template {
  const config = testConfig();
  const app = new App();
  const stubs = new Stack(new App(), "PromptGuardrailTestStubs", { env: config.env });
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
    promptGuardrailId,
  });
  return Template.fromStack(stack);
}

describe("ComputeStack — admin prompt-injection guardrail", () => {
  const template = synthCompute("gr-abcd1234efgh");
  const functions = Object.values(
    template.findResources("AWS::Lambda::Function") as Record<string, CfnFunction>,
  );

  it("passes a non-empty PROMPT_GUARDRAIL_ID to the Admin Lambda", () => {
    const admin = functions.find((fn) => fn.Properties?.FunctionName === "wren-test-admin");
    expect(admin).toBeDefined();
    expect(admin!.Properties?.Environment?.Variables?.PROMPT_GUARDRAIL_ID).toBe("gr-abcd1234efgh");
  });

  it("never sets the PROMPT_GUARDRAIL_SKIP dev/test bypass on any function", () => {
    for (const fn of functions) {
      expect(fn.Properties?.Environment?.Variables ?? {}).not.toHaveProperty("PROMPT_GUARDRAIL_SKIP");
    }
  });

  it.each(["", "   "])("throws at synth when promptGuardrailId is %p", (id) => {
    expect(() => synthCompute(id)).toThrow(/promptGuardrailId must be a non-empty/);
  });
});
