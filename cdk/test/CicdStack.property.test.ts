import fc from "fast-check";

import { PBT_RUNS } from "./support/pbtConfig.js";
import {
  asArray,
  policyFixtures,
  statements,
} from "./support/cicdPolicyFixtures.js";
import {
  evaluate,
  matchesActionPattern,
  matchesArnPattern,
  matchingStatements,
  type PolicyStatement,
} from "./support/policyEval.js";

const fixture = policyFixtures();
const {
  prefix,
  account,
  region,
  boundaryArn,
  ownedRolePrefix,
  deployPolicy,
  boundaryPolicy,
  computeJson,
} = fixture;

const safeString = fc.stringOf(
  fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"),
  { minLength: 1, maxLength: 30 },
);
const arbitraryArn = fc
  .tuple(fc.constantFrom("lambda", "iam", "s3", "ssm", "secretsmanager", "sqs"), safeString)
  .map(([service, suffix]) => `arn:aws:${service}:${region}:${account}:${suffix}`);

function grants(statement: PolicyStatement, action: string): boolean {
  return statement.Effect === "Allow" && statement.Action !== undefined &&
    asArray(statement.Action).some((pattern) => matchesActionPattern(pattern, action));
}

function allowActions(documentStatements: readonly PolicyStatement[], prefixValue: string): string[] {
  return [...new Set(documentStatements
    .filter((statement) => statement.Effect === "Allow")
    .flatMap((statement) => [...asArray(statement.Action ?? [])])
    .filter((action) => action.toLowerCase().startsWith(prefixValue)))];
}
const computeRoles = Object.entries(computeJson.Resources)
  .filter(([, resource]) => resource.Type === "AWS::IAM::Role");

function trustedServices(resource: (typeof computeRoles)[number][1]): string[] {
  const trustStatements = resource.Properties?.AssumeRolePolicyDocument?.Statement ?? [];
  return asArray<any>(trustStatements).flatMap((statement) => {
    const service = statement.Principal?.Service as string | string[] | undefined;
    return service === undefined ? [] : [...asArray(service)];
  });
}

const passRoleTargets = computeRoles.flatMap(([logicalId, resource]) =>
  trustedServices(resource)
    .filter((service) => service === "lambda.amazonaws.com" || service === "appsync.amazonaws.com")
    .map((service) => ({
      service,
      arn: `arn:aws:iam::${account}:role/${prefix}-Compute-${logicalId}-AbCdEf`,
    })),
);

function representativeResource(action: string, resource: unknown): string {
  if (typeof resource === "string" && resource !== "*") return resource;
  const service = action.split(":", 1)[0];
  const byService: Record<string, string> = {
    appsync: `arn:aws:appsync:${region}:${account}:apis/test/types/Mutation/fields/test`,
    logs: `arn:aws:logs:${region}:${account}:log-group:/aws/lambda/${prefix}-test:*`,
    // The only intrinsic Secrets Manager resource in Compute is the activity
    // pseudonym salt (`Ref` when managed, a partial-ARN `-??????` join when
    // external); the per-role DB secret ARNs arrive as literals.
    secretsmanager: `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/audit/pseudonym-salt-AbCdEf`,
    sns: `arn:aws:sns:${region}:${account}:${prefix}-notification-events`,
    sqs: `arn:aws:sqs:${region}:${account}:${prefix}-feedback-queue`,
  };
  const resolved = byService[service ?? ""];
  if (resolved !== undefined) return resolved;
  if (resource === "*") return resource;
  throw new Error(`No representative for intrinsic runtime resource used by ${action}`);
}

function concreteAction(action: string): string {
  if (action === "kms:ReEncrypt*") return "kms:ReEncryptFrom";
  if (action === "kms:GenerateDataKey*") return "kms:GenerateDataKey";
  return action;
}
type RuntimePair = { readonly action: string; readonly resource: string };

function pairsFromDocument(document: any): RuntimePair[] {
  return asArray<any>(document.Statement ?? []).flatMap((statement) =>
    asArray<string>(statement.Action ?? []).flatMap((rawAction) => {
      const action = concreteAction(rawAction);
      return asArray<unknown>(statement.Resource ?? []).map((resource) => ({
        action,
        resource: representativeResource(action, resource),
      }));
    }),
  );
}

const synthesizedRuntimePairs = Object.values(computeJson.Resources).flatMap((resource) => {
  if (resource.Type === "AWS::IAM::Policy") {
    return pairsFromDocument(resource.Properties?.PolicyDocument);
  }
  if (resource.Type === "AWS::IAM::Role") {
    return asArray<any>(resource.Properties?.Policies ?? []).flatMap((policy) =>
      pairsFromDocument(policy.PolicyDocument),
    );
  }
  return [];
});

const managedPolicyRuntimePairs: RuntimePair[] = [
  ...["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"].map((action) => ({
    action,
    resource: `arn:aws:logs:${region}:${account}:*`,
  })),
  ...[
    "ec2:CreateNetworkInterface",
    "ec2:DescribeNetworkInterfaces",
    "ec2:DescribeSubnets",
    "ec2:DeleteNetworkInterface",
    "ec2:AssignPrivateIpAddresses",
    "ec2:UnassignPrivateIpAddresses",
  ].map((action) => ({ action, resource: "*" })),
];
const runtimePairs = [...synthesizedRuntimePairs, ...managedPolicyRuntimePairs];

function literalRoleArns(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") {
    if (/^arn:aws:iam::[^:]+:role\//.test(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) literalRoleArns(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) literalRoleArns(item, found);
  }
  return found;
}
describe("CicdStack policy properties", () => {
  const deployStatements = statements(deployPolicy);

  it("Property 1: role mutation is confined to the owned role prefix", () => {
    // Feature: cicd-deploy-role-privilege-escalation-fix, Property 1: Role mutation is confined to the owned role prefix
    const roleArn = fc
      .tuple(
        fc.oneof(
          fc.constantFrom("Compute", "compute", "COMPUTE", "CoMpUtE"),
          safeString,
        ),
        safeString,
      )
      .map(([segment, name]) => `arn:aws:iam::${account}:role/${prefix}-${segment}-${name}`);
    const action = fc.constantFrom(
      "iam:CreateRole",
      "iam:PutRolePolicy",
      "iam:AttachRolePolicy",
      "iam:UpdateAssumeRolePolicy",
    );

    fc.assert(fc.property(roleArn, action, (resource, generatedAction) => {
      const decision = evaluate(deployPolicy, {
        action: generatedAction,
        resource,
        context: { "iam:PermissionsBoundary": boundaryArn },
      });
      expect(decision).toBe(matchesArnPattern(ownedRolePrefix, resource) ? "allowed" : "explicitDeny");
    }), { numRuns: PBT_RUNS });
  });

  it("Property 2: no IAM action reaches the deploy role's own ARN", () => {
    // Feature: cicd-deploy-role-privilege-escalation-fix, Property 2: No IAM action reaches the deploy role's own ARN
    const iamActions = allowActions(deployStatements, "iam:");
    const deployNameVariant = fc.constantFrom(
      "compute-cfn-deploy",
      "Compute-Cfn-Deploy",
      "COMPUTE-CFN-DEPLOY",
      "CoMpUtE-cFn-DePlOy",
    );

    fc.assert(fc.property(
      fc.shuffledSubarray(iamActions, { minLength: iamActions.length, maxLength: iamActions.length }),
      deployNameVariant,
      (actions, name) => {
        // IAM role names are unique and resolved case-insensitively; authorization
        // evaluates the canonical ARN returned for that role, whose spelling is
        // the explicit RoleName in the template. Keep case variants in the input
        // domain while evaluating the single canonical deploy-role identity.
        expect(name.toLowerCase()).toBe("compute-cfn-deploy");
        for (const action of actions) {
          const decision = evaluate(deployPolicy, {
            action,
            resource: `arn:aws:iam::${account}:role/${prefix}-compute-cfn-deploy`,
            context: {
              "iam:PermissionsBoundary": boundaryArn,
              "iam:PassedToService": "lambda.amazonaws.com",
            },
          });
          expect(decision).toBe("explicitDeny");
        }
      },
    ), { numRuns: PBT_RUNS });
  });

  it("Property 3: no role-mutation grant depends on a condition key being absent", () => {
    // Feature: cicd-deploy-role-privilege-escalation-fix, Property 3: No role-mutation grant depends on a condition key being absent
    const gatedActions = [
      "iam:CreateRole",
      "iam:PutRolePolicy",
      "iam:AttachRolePolicy",
      "iam:PutRolePermissionsBoundary",
    ] as const;
    const boundaryValues: readonly (string | undefined)[] = [
      undefined,
      "",
      `arn:aws:iam::${account}:policy/other-boundary`,
      boundaryArn,
    ];

    fc.assert(fc.property(fc.constantFrom(...gatedActions), (action) => {
      const mutationGrants = deployStatements.filter((statement) => grants(statement, action));
      expect(mutationGrants).toHaveLength(1);
      expect(Object.keys(mutationGrants[0]?.Condition ?? {}).some((key) => /IfExists$/.test(key))).toBe(false);
      for (const value of boundaryValues) {
        const context = value === undefined ? {} : { "iam:PermissionsBoundary": value };
        expect(evaluate(deployPolicy, { action, resource: `${ownedRolePrefix.slice(0, -1)}Role`, context }))
          .toBe(value === boundaryArn ? "allowed" : "implicitDeny");
      }
    }), { numRuns: PBT_RUNS });
  });

  it("Property 4: PassRole is confined to two services and the owned prefix", () => {
    // Feature: cicd-deploy-role-privilege-escalation-fix, Property 4: PassRole is confined to two services and the owned prefix
    const service = fc.option(
      fc.oneof(fc.constantFrom("lambda.amazonaws.com", "appsync.amazonaws.com", "events.amazonaws.com"), safeString),
      { nil: undefined },
    );
    const roleArn = fc.oneof(
      fc.constantFrom(...passRoleTargets.map((target) => target.arn)),
      safeString.map((name) => `arn:aws:iam::${account}:role/${name}`),
    );

    fc.assert(fc.property(service, roleArn, (principal, resource) => {
      // 12 Compute roles, including the operator-only sync-cognito-admins and
      // scheduled orphan-upload-sweep Lambdas (the unrouted audit Lambda was retired).
      expect(passRoleTargets).toHaveLength(12);
      for (const target of passRoleTargets) {
        expect(evaluate(deployPolicy, {
          action: "iam:PassRole",
          resource: target.arn,
          context: { "iam:PassedToService": target.service },
        })).toBe("allowed");
      }
      const context = principal === undefined ? {} : { "iam:PassedToService": principal };
      const permittedService = principal === "lambda.amazonaws.com" || principal === "appsync.amazonaws.com";
      expect(evaluate(deployPolicy, { action: "iam:PassRole", resource, context }) === "allowed")
        .toBe(permittedService && matchesArnPattern(ownedRolePrefix, resource));
      expect(evaluate(deployPolicy, { action: "iam:PassRole", resource, context: {} })).not.toBe("allowed");
    }), { numRuns: PBT_RUNS });
  });

  it("Property 5: amplifier permissions are confined to their designated patterns", () => {
    // Feature: cicd-deploy-role-privilege-escalation-fix, Property 5: Amplifier permissions are confined to their designated patterns
    const serviceFunctions = [
      "authorizer", "document", "admin", "feedback-orchestrator",
      "feedback-engine", "diff-anchor-progress", "notification", "appsync-authorizer",
    ].map((name) => `arn:aws:lambda:${region}:${account}:function:${prefix}-${name}`);
    const suffix = fc.stringOf(fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"), {
      minLength: 6,
      maxLength: 6,
    });
    const generatedCase = fc.oneof(
      fc.constantFrom(...serviceFunctions.map((resource) => ({ action: "lambda:InvokeFunction", resource }))),
      fc.constant({
        action: "lambda:InvokeFunction",
        resource: `arn:aws:lambda:${region}:${account}:function:${prefix}-Compute-LogRetentionABC`,
      }),
      fc.constant({
        action: "secretsmanager:GetSecretValue",
        resource: `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/cicd/github-pat-AbCdEf`,
      }),
      suffix.map((value) => ({
        action: "secretsmanager:GetSecretValue",
        resource: `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/database/wren_admin-${value}`,
      })),
      fc.constant({
        action: "secretsmanager:GetSecretValue",
        resource: `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/audit/pseudonym-salt-AbCdEf`,
      }),
      fc.constant({
        action: "ssm:PutParameter",
        resource: `arn:aws:ssm:${region}:${account}:parameter/${prefix}/config/bedrock-model-id`,
      }),
      fc.constant({
        action: "ssm:PutParameter",
        resource: `arn:aws:ssm:${region}:${account}:parameter/${prefix}/notifications/toast-duration-ms`,
      }),
      fc.record({
        action: fc.constantFrom("lambda:InvokeFunction", "secretsmanager:GetSecretValue", "ssm:PutParameter"),
        resource: arbitraryArn,
      }),
    );

    const designatedPatterns: Record<string, string> = {
      "lambda:InvokeFunction": `arn:aws:lambda:${region}:${account}:function:${prefix}-*`,
      "secretsmanager:GetSecretValue": `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/audit/*`,
      "ssm:PutParameter": `arn:aws:ssm:${region}:${account}:parameter/${prefix}/notifications/*`,
    };

    fc.assert(fc.property(generatedCase, suffix, ({ action, resource }, databaseSuffix) => {
      for (const amplifier of Object.keys(designatedPatterns)) {
        for (const statement of deployStatements.filter((candidate) => grants(candidate, amplifier))) {
          expect(statement.Resource === undefined ? [] : asArray(statement.Resource)).not.toContain("*");
        }
      }
      for (const functionArn of serviceFunctions) {
        expect(evaluate(deployPolicy, { action: "lambda:InvokeFunction", resource: functionArn })).toBe("allowed");
      }
      const logRetentionArn = `arn:aws:lambda:${region}:${account}:function:${prefix}-Compute-LogRetentionABC`;
      expect(evaluate(deployPolicy, { action: "lambda:InvokeFunction", resource: logRetentionArn })).toBe("allowed");
      // The retired `${prefix}-audit` name is outside the deploy role's scope
      // (finding f-499abf7c): it can't be re-created, granted, or invoked.
      const retiredAuditArn = `arn:aws:lambda:${region}:${account}:function:${prefix}-audit`;
      for (const retiredAction of ["lambda:CreateFunction", "lambda:AddPermission", "lambda:InvokeFunction"]) {
        expect(evaluate(deployPolicy, { action: retiredAction, resource: retiredAuditArn })).not.toBe("allowed");
      }
      const databaseSecret = `arn:aws:secretsmanager:${region}:${account}:secret:${prefix}/database/wren_admin-${databaseSuffix}`;
      expect(evaluate(deployPolicy, { action: "secretsmanager:GetSecretValue", resource: databaseSecret })).not.toBe("allowed");
      const expected = matchesArnPattern(designatedPatterns[action]!, resource);
      expect(evaluate(deployPolicy, { action, resource }) === "allowed").toBe(expected);
    }), { numRuns: PBT_RUNS });
  });

  it("Property 6: the boundary grants no privilege-granting capability", () => {
    // Feature: cicd-deploy-role-privilege-escalation-fix, Property 6: The boundary grants no privilege-granting capability
    const privilegeAction = fc.oneof(
      safeString.map((name) => `iam:${name}`),
      fc.constant("sts:AssumeRole"),
      safeString.map((name) => `organizations:${name}`),
    );

    fc.assert(fc.property(privilegeAction, arbitraryArn, (action, resource) => {
      const request = { action, resource };
      expect(evaluate(boundaryPolicy, request)).toBe("explicitDeny");
      expect(matchingStatements(boundaryPolicy, request).some((statement) => statement.Effect === "Allow"))
        .toBe(false);
    }), { numRuns: PBT_RUNS });
  });

  it("Property 7: every Compute runtime statement fits inside the boundary", () => {
    // Feature: cicd-deploy-role-privilege-escalation-fix, Property 7: Every runtime statement the Compute stack synthesizes fits inside the boundary
    fc.assert(fc.property(
      fc.shuffledSubarray(runtimePairs, { minLength: runtimePairs.length, maxLength: runtimePairs.length }),
      (pairs) => {
        expect(pairs.length).toBeGreaterThan(0);
        for (const { action, resource } of pairs) {
          expect(evaluate(boundaryPolicy, { action, resource })).toBe("allowed");
        }
      },
    ), { numRuns: PBT_RUNS });
  });

  it("Property 8: every Compute role is auto-named and boundary-bound", () => {
    // Feature: cicd-deploy-role-privilege-escalation-fix, Property 8: Every Compute-stack role is auto-named and boundary-bound
    fc.assert(fc.property(
      fc.shuffledSubarray(computeRoles, { minLength: computeRoles.length, maxLength: computeRoles.length }),
      (roles) => {
        expect(roles).toHaveLength(12);
        for (const [, role] of roles) {
          expect(role.Properties?.RoleName).toBeUndefined();
          expect(role.Properties?.PermissionsBoundary).toBe(boundaryArn);
        }
        expect(literalRoleArns(computeJson)).toEqual([]);
      },
    ), { numRuns: PBT_RUNS });
  });
});
