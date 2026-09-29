import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as kms from "aws-cdk-lib/aws-kms";

import { APP_DB_ROLES, type AppDbRole } from "../lib/appDbRoles.js";
import type { AppConfig } from "../lib/config.js";
import { ComputeStack } from "../lib/stacks/ComputeStack.js";
import { synthStacks, testConfig, TEST_ACCOUNT, TEST_REGION } from "./helpers";

/**
 * Activity-log pseudonym salt handling.
 *
 * The salt must stay behind `secretsmanager:GetSecretValue`. Injecting its
 * value into a Lambda environment (e.g. `secret.secretValue.unsafeUnwrap()`,
 * which CloudFormation resolves as a `{{resolve:secretsmanager:…}}` dynamic
 * reference) exposes it in plaintext to anyone with
 * `lambda:GetFunctionConfiguration`. Admin, Audit and Document instead receive the
 * secret's NAME and fetch the value at runtime, with a grant scoped to that
 * one secret — in both "managed" and "external" ownership modes.
 */

const SALT_SECRET_NAME = "wren-test/audit/pseudonym-salt";
const SALT_ENV = "WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID";
// Every function that writes through the shared @wren/db-node activity-log
// writer (Document records deletion events through it, Issue #187).
const SALT_CONSUMERS = ["wren-test-admin", "wren-test-audit", "wren-test-document"] as const;

type CfnFunction = {
  readonly Properties?: {
    readonly FunctionName?: string;
    readonly Role?: { readonly "Fn::GetAtt"?: readonly [string, string] };
    readonly Environment?: { readonly Variables?: Record<string, unknown> };
  };
};

type CfnPolicy = {
  readonly Properties: {
    readonly Roles?: readonly { readonly Ref?: string }[];
    readonly PolicyDocument: {
      readonly Statement: readonly {
        readonly Action: string | readonly string[];
        readonly Resource: unknown;
      }[];
    };
  };
};

function synthCompute(config: AppConfig): Template {
  const app = new App();
  const stubs = new Stack(new App(), "ActivitySaltTestStubs", { env: config.env });
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

function functionsByName(template: Template): Map<string, CfnFunction> {
  const functions = template.findResources("AWS::Lambda::Function") as Record<string, CfnFunction>;
  const byName = new Map<string, CfnFunction>();
  for (const fn of Object.values(functions)) {
    const name = fn.Properties?.FunctionName;
    if (typeof name === "string") byName.set(name, fn);
  }
  return byName;
}

/** Any Secrets Manager dynamic reference anywhere in a function's environment. */
function environmentHasSecretReference(fn: CfnFunction): boolean {
  return JSON.stringify(fn.Properties?.Environment ?? {}).includes("resolve:secretsmanager");
}

/**
 * Role logical ids whose inline policies grant any action on a resource that
 * `matchesSalt` recognises as the salt secret, plus the matching statements.
 */
function saltGrants(
  template: Template,
  matchesSalt: (resource: unknown) => boolean,
): { roles: Set<string>; statements: { Action: string | readonly string[]; Resource: unknown }[] } {
  const policies = template.findResources("AWS::IAM::Policy") as Record<string, CfnPolicy>;
  const roles = new Set<string>();
  const statements: { Action: string | readonly string[]; Resource: unknown }[] = [];
  for (const policy of Object.values(policies)) {
    for (const statement of policy.Properties.PolicyDocument.Statement) {
      const resources = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
      if (!resources.some(matchesSalt)) continue;
      statements.push(statement);
      for (const role of policy.Properties.Roles ?? []) {
        if (role.Ref) roles.add(role.Ref);
      }
    }
  }
  return { roles, statements };
}

function consumerRoleIds(template: Template): Set<string> {
  const byName = functionsByName(template);
  return new Set(
    SALT_CONSUMERS.map((name) => {
      const roleId = byName.get(name)?.Properties?.Role?.["Fn::GetAtt"]?.[0];
      if (!roleId) throw new Error(`No role found for ${name}`);
      return roleId;
    }),
  );
}

describe.each(["managed", "external"] as const)(
  "ComputeStack — activity pseudonym salt (%s ownership)",
  (ownership) => {
    const template = synthCompute(testConfig({ auditPseudonymSaltOwnership: ownership }));

    const matchesSalt = (resource: unknown): boolean => {
      if (ownership === "managed") {
        const secrets = template.findResources("AWS::SecretsManager::Secret", {
          Properties: { Name: SALT_SECRET_NAME },
        });
        const [saltId] = Object.keys(secrets);
        return JSON.stringify(resource) === JSON.stringify({ Ref: saltId });
      }
      // fromSecretNameV2 only knows a partial ARN; grantRead must append the
      // six-character suffix wildcard or the grant never matches the secret.
      return JSON.stringify(resource).includes(`secret:${SALT_SECRET_NAME}-??????`);
    };

    it.each(SALT_CONSUMERS)("passes only the secret name to %s, never the value", (name) => {
      const fn = functionsByName(template).get(name);
      expect(fn).toBeDefined();
      const variables = fn!.Properties?.Environment?.Variables ?? {};

      expect(variables[SALT_ENV]).toBe(SALT_SECRET_NAME);
      expect(variables).not.toHaveProperty("WREN_ACTIVITY_PSEUDONYM_SALT");
      expect(environmentHasSecretReference(fn!)).toBe(false);
    });

    it("grants salt read access to exactly the Admin, Audit and Document roles", () => {
      const { roles, statements } = saltGrants(template, matchesSalt);

      expect(statements.length).toBeGreaterThan(0);
      expect(roles).toEqual(consumerRoleIds(template));
    });

    it("scopes the salt grant to read actions on that one secret", () => {
      const { statements } = saltGrants(template, matchesSalt);

      for (const statement of statements) {
        const actions = [statement.Action].flat();
        expect(actions).toEqual(
          expect.arrayContaining(["secretsmanager:GetSecretValue"]),
        );
        for (const action of actions) {
          expect(["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]).toContain(action);
        }
        const resources = [statement.Resource].flat();
        expect(resources).not.toContain("*");
      }
    });
  },
);

describe("Lambda environments never carry Secrets Manager values (regression guard)", () => {
  const { app } = synthStacks();
  const stacks: [string, Template][] = [
    ["Compute (managed salt)", synthCompute(testConfig())],
    ["Compute (external salt)", synthCompute(testConfig({ auditPseudonymSaltOwnership: "external" }))],
    ...app.node.children
      .filter((child): child is Stack => child instanceof Stack)
      .map((stack): [string, Template] => [stack.stackName, Template.fromStack(stack)]),
  ];

  it.each(stacks)("%s: no function environment contains a {{resolve:secretsmanager}} reference", (_name, template) => {
    const functions = template.findResources("AWS::Lambda::Function") as Record<string, CfnFunction>;
    const offenders = Object.entries(functions)
      .filter(([, fn]) => environmentHasSecretReference(fn))
      .map(([id]) => id);

    expect(offenders).toEqual([]);
  });
});
