import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
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

function synthAuthorizerEnvironment(config: AppConfig): Record<string, unknown> {
  const app = new App();
  const stubs = new Stack(new App(), "BootstrapTestStubs", { env: config.env });
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

  const functions = Template.fromStack(stack).findResources("AWS::Lambda::Function") as Record<
    string,
    CfnResource
  >;
  const authorizer = Object.values(functions).find(
    (resource) => resource.Properties?.FunctionName === `${config.stackPrefix}-authorizer`,
  );
  if (!authorizer) {
    throw new Error("Synthesized Compute stack did not contain the authorizer Lambda");
  }
  return authorizer.Properties?.Environment?.Variables ?? {};
}

describe("ComputeStack — TechnicalAdmin bootstrap environment", () => {
  it("is secure by default and omits the bootstrap subject", () => {
    const environment = synthAuthorizerEnvironment(testConfig());

    expect(environment).not.toHaveProperty("TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT");
  });

  it("passes the configured exact subject to the authorizer", () => {
    const subject = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const environment = synthAuthorizerEnvironment(
      testConfig({ technicalAdminBootstrapSubject: subject }),
    );

    expect(environment.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT).toBe(subject);
  });
});
