import { App, Stack, aws_iam as iam } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";

import { APP_DB_ROLES, type AppDbRole } from "../../lib/appDbRoles.js";
import type { AppConfig } from "../../lib/config.js";
import { CicdStack } from "../../lib/stacks/CicdStack.js";
import { ComputeStack } from "../../lib/stacks/ComputeStack.js";
import { testConfig, TEST_ACCOUNT, TEST_REGION } from "../helpers.js";

export type CfnResource = {
  readonly Type: string;
  readonly Properties?: Record<string, any>;
};

export interface SynthResult {
  readonly config: AppConfig;
  readonly template: Template;
  readonly json: { readonly Resources: Record<string, CfnResource>; readonly [key: string]: any };
}

let cicdCache: SynthResult | undefined;
let computeCache: SynthResult | undefined;

/** Synthesize Cicd once; policy property tests share this expensive fixture. */
export function synthCicd(): SynthResult {
  if (cicdCache !== undefined) return cicdCache;
  const config = testConfig();
  const app = new App();
  const stack = new CicdStack(app, `${config.stackPrefix}-Cicd`, {
    env: config.env,
    config,
    repositoryOwner: "test-owner",
    repositoryName: "test-repo",
    branch: "main",
  });
  const template = Template.fromStack(stack);
  cicdCache = { config, template, json: template.toJSON() as SynthResult["json"] };
  return cicdCache;
}
/** Synthesize Compute once with the same unconditional boundary aspect as wren.ts. */
export function synthCompute(): SynthResult {
  if (computeCache !== undefined) return computeCache;
  const config = testConfig();
  const app = new App();
  const stubs = new Stack(new App(), "Stubs", { env: config.env });
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
    databaseProxyEndpoint: `${config.stackPrefix}-proxy.proxy-abcdefghijkl.${TEST_REGION}.rds.amazonaws.com`,
    databaseSecretArns,
    documentsBucketName: `${config.stackPrefix.toLowerCase()}-storage-documents`,
    referenceBucketName: `${config.stackPrefix.toLowerCase()}-storage-reference`,
    storageEncryptionKey,
    conversationTableName: `${config.stackPrefix}-conversations`,
    userPoolId: `${TEST_REGION}_TESTPOOL1`,
    userPoolClientId: "1exampleclientid234567890a",
    promptGuardrailId: "gr-abcd1234efgh",
  });
  iam.PermissionsBoundary.of(stack).apply(
    iam.ManagedPolicy.fromManagedPolicyArn(
      stack,
      "ComputeBoundaryRef",
      CicdStack.boundaryPolicyArnFor(stack.account, config.stackPrefix),
    ),
  );
  const template = Template.fromStack(stack);
  computeCache = { config, template, json: template.toJSON() as SynthResult["json"] };
  return computeCache;
}
