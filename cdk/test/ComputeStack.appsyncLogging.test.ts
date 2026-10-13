import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as kms from "aws-cdk-lib/aws-kms";

import { APP_DB_ROLES, type AppDbRole } from "../lib/appDbRoles.js";
import type { AppConfig } from "../lib/config.js";
import { ComputeStack } from "../lib/stacks/ComputeStack.js";
import { testConfig, TEST_ACCOUNT, TEST_REGION } from "./helpers.js";

/**
 * Synthesize the Compute stack (which owns the AppSync real-time API) with the
 * same stubbed dependencies the other Compute tests use.
 */
function synthCompute(config: AppConfig): Template {
  const app = new App();
  const stubs = new Stack(new App(), "AppSyncLogTestStubs", { env: config.env });
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

  return Template.fromStack(stack);
}

/**
 * AppSync API log retention (logging review gap 2.1). AppSync auto-creates the
 * `/aws/appsync/apis/{apiId}` log group; without a retention it never expires.
 * Setting logConfig.retention makes CDK emit a LogRetention custom resource
 * that bounds the group on the project's 90/30-day schedule.
 */
describe("ComputeStack AppSync log retention", () => {
  it("enables ERROR-level AppSync field logging", () => {
    const template = synthCompute(testConfig());
    template.hasResourceProperties("AWS::AppSync::GraphQLApi", {
      LogConfig: {
        FieldLogLevel: "ERROR",
        ExcludeVerboseContent: true,
      },
    });
  });

  it("bounds the AppSync-managed log group at 30 days in non-prod", () => {
    const template = synthCompute(testConfig());
    const retentions = template.findResources("Custom::LogRetention");
    const match = Object.values(retentions).find((r) =>
      JSON.stringify(r.Properties?.LogGroupName ?? "").includes(
        "/aws/appsync/apis/",
      ),
    );
    expect(match).toBeDefined();
    expect(match?.Properties?.RetentionInDays).toBe(30);
  });

  it("bounds the AppSync-managed log group at 90 days in prod", () => {
    const template = synthCompute(
      testConfig({ environmentName: "prod", stackPrefix: "wren-prod" }),
    );
    const retentions = template.findResources("Custom::LogRetention");
    const match = Object.values(retentions).find((r) =>
      JSON.stringify(r.Properties?.LogGroupName ?? "").includes(
        "/aws/appsync/apis/",
      ),
    );
    expect(match).toBeDefined();
    expect(match?.Properties?.RetentionInDays).toBe(90);
  });
});
