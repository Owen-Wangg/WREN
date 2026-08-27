import { readFileSync } from "node:fs";
import * as path from "node:path";

import { Match } from "aws-cdk-lib/assertions";

import { TEST_ACCOUNT } from "./helpers.js";
import { policyFixtures, asArray, statements } from "./support/cicdPolicyFixtures.js";
import { synthCicd, synthCompute } from "./support/cicdSynth.js";
import { matchesActionPattern, matchesArnPattern, type PolicyStatement } from "./support/policyEval.js";

/**
 * Synth regression guard for `${StackPrefix}-Cicd` — the baseline commit (C1) of
 * the deploy-role privilege-escalation fix.
 *
 * This file is deliberately narrow. It asserts only facts that hold at every
 * commit in the C1–C6 sequence: the Compute deployment role exists under its
 * fixed name and is assumed by CloudFormation, the pipeline keeps its four
 * stages, and every role the Compute stack creates is auto-named so it falls
 * inside the owned role prefix `${StackPrefix}-Compute-*`.
 *
 * The C6 suite adds fixed-shape assertions and a full template snapshot after
 * the policy rewrite is complete. The historical baseline fixture below remains
 * unchanged and continues to record the vulnerable pre-fix statement.
 *
 * The pre-fix `IamForLambdaRoles` statement is recorded verbatim in
 * `__fixtures__/compute-deploy-role.baseline.json` and pinned by the baseline
 * suite below (Requirement 7 criterion 2). That suite reads the *fixture*, never
 * the live template, so it keeps passing once C2–C6 rewrite the policy — the
 * fixture is the historical record the C6 assertions are written against.
 *
 * Requirements: 6.8, 7.1, 7.2, 8.2, 10.4
 */

describe("CicdStack", () => {
  const { config, template } = synthCicd();
  const deployRoleName = `${config.stackPrefix}-compute-cfn-deploy`;

  it("matches the complete fixed Cicd template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });

  it("declares exactly one named Compute deployment role", () => {
    const named = Object.values(template.findResources("AWS::IAM::Role")).filter(
      (role) => role.Properties?.RoleName === deployRoleName,
    );

    expect(named).toHaveLength(1);
  });

  it("has CloudFormation assume the Compute deployment role", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: deployRoleName,
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Principal: { Service: "cloudformation.amazonaws.com" },
          }),
        ]),
      }),
    });
  });

  it("keeps the four pipeline stages", () => {
    const pipelines = Object.values(template.findResources("AWS::CodePipeline::Pipeline"));
    expect(pipelines).toHaveLength(1);

    const stageNames = (pipelines[0]?.Properties?.Stages as { Name: string }[]).map(
      (stage) => stage.Name,
    );
    expect(stageNames).toEqual(["Source", "Build", "Deploy", "UpdateLambda"]);
  });
});

function grants(statement: PolicyStatement, action: string): boolean {
  return (
    statement.Effect === "Allow" &&
    statement.Action !== undefined &&
    asArray(statement.Action).some((pattern) => matchesActionPattern(pattern, action))
  );
}

describe("Compute deploy role — fixed policy shape", () => {
  const { prefix, account, boundaryArn, ownedRolePrefix, deployPolicy, boundaryPolicy } =
    policyFixtures();
  const deployStatements = statements(deployPolicy);
  const roleMutationActions = [
    "iam:CreateRole",
    "iam:PutRolePolicy",
    "iam:AttachRolePolicy",
    "iam:UpdateAssumeRolePolicy",
  ];

  it("contains no account-wide IAM role resource", () => {
    const accountWide = `arn:aws:iam::${account}:role/*`;
    for (const statement of deployStatements) {
      expect(statement.Resource === undefined ? [] : asArray(statement.Resource)).not.toContain(accountWide);
    }
  });

  it("uses no IfExists condition on a role-mutation grant", () => {
    const mutationGrants = deployStatements.filter((statement) =>
      roleMutationActions.some((action) => grants(statement, action)),
    );
    expect(mutationGrants.length).toBeGreaterThan(0);
    for (const statement of mutationGrants) {
      expect(Object.keys(statement.Condition ?? {})).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/IfExists$/)]),
      );
    }
  });

  it("gates role creation with the template-derived boundary and leaves trust updates ungated", () => {
    const create = deployStatements.find((statement) => grants(statement, "iam:CreateRole"));
    expect(create).toMatchObject({
      Resource: ownedRolePrefix,
      Condition: { StringEquals: { "iam:PermissionsBoundary": boundaryArn } },
    });

    const trust = deployStatements.find((statement) =>
      grants(statement, "iam:UpdateAssumeRolePolicy"),
    );
    expect(trust).toMatchObject({ Resource: ownedRolePrefix });
    expect(trust?.Condition).toBeUndefined();
  });

  it("allows PassRole to exactly Lambda and AppSync on the owned prefix", () => {
    const passRole = deployStatements.find((statement) => grants(statement, "iam:PassRole"));
    expect(passRole).toMatchObject({
      Resource: ownedRolePrefix,
      Condition: {
        StringEquals: {
          "iam:PassedToService": ["lambda.amazonaws.com", "appsync.amazonaws.com"],
        },
      },
    });
  });

  it("uses one owned-prefix NotResource in the out-of-scope Deny", () => {
    const deny = deployStatements.find((statement) => statement.Sid === "DenyOutOfScopeStacks");
    expect(deny?.NotResource).toBe(ownedRolePrefix);
    expect(deny?.NotResource).toEqual(expect.stringMatching(new RegExp(`${prefix}-Compute-\\*$`)));
  });

  it("scopes every amplifier permission away from star and pipeline secrets", () => {
    const amplifierActions = [
      "lambda:InvokeFunction",
      "secretsmanager:GetSecretValue",
      "ssm:PutParameter",
    ];
    for (const action of amplifierActions) {
      const grantsForAction = deployStatements.filter((statement) => grants(statement, action));
      expect(grantsForAction.length).toBeGreaterThan(0);
      for (const statement of grantsForAction) {
        expect(asArray(statement.Resource ?? [])).not.toContain("*");
      }
    }

    const pipelineSecret = `arn:aws:secretsmanager:ca-central-1:${account}:secret:${prefix}/cicd/github-pat-AbCdEf`;
    const secretPatterns = deployStatements
      .filter((statement) => grants(statement, "secretsmanager:GetSecretValue"))
      .flatMap((statement) => [...asArray(statement.Resource ?? [])]);
    expect(secretPatterns.some((pattern) => matchesArnPattern(pattern, pipelineSecret))).toBe(false);
  });

  it("keeps the boundary document below the managed-policy size limit", () => {
    expect(JSON.stringify(boundaryPolicy).length).toBeLessThan(6144);
  });
});

describe("ComputeStack — role naming (REQ 6.8, 10.4)", () => {
  const { template } = synthCompute();

  it("auto-names every IAM role it creates", () => {
    const roles = template.findResources("AWS::IAM::Role");
    expect(Object.keys(roles).length).toBeGreaterThan(0);

    for (const [logicalId, role] of Object.entries(roles)) {
      expect([logicalId, role.Properties?.RoleName]).toEqual([logicalId, undefined]);
    }
  });
});

/**
 * Pre-fix baseline (REQ 7.2, 8.2).
 *
 * These assertions describe the *recorded fixture*, not the synthesized stack.
 * That distinction is deliberate: C2–C6 delete `IamForLambdaRoles` outright, so
 * an equivalent assertion against the live template would fail from C2 onward
 * and violate Requirement 8 criteria 4 and 6. Pinning the fixture instead makes
 * the "before" state machine-readable and immune to the fix that follows.
 */
describe("Compute deploy role — recorded pre-fix baseline (REQ 7.2, 8.2)", () => {
  const fixturePath = path.join(
    __dirname,
    "__fixtures__",
    "compute-deploy-role.baseline.json",
  );

  /** The unmodified statement, parsed from disk rather than imported. */
  const baseline = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    Sid: string;
    Effect: string;
    Action: string[];
    Resource: string;
    Condition: Record<string, Record<string, string[]>>;
  };

  it("parses as a single Allow statement named IamForLambdaRoles", () => {
    expect(baseline.Sid).toBe("IamForLambdaRoles");
    expect(baseline.Effect).toBe("Allow");
  });

  it("records the fifteen pre-fix IAM actions", () => {
    expect(baseline.Action).toEqual([
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:PassRole",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
    ]);
  });

  it("records every role in the account as the resource — the escalation path", () => {
    expect(baseline.Resource).toBe(`arn:aws:iam::${TEST_ACCOUNT}:role/*`);
  });

  it("records StringEqualsIfExists as the only condition operator", () => {
    // The `IfExists` suffix is why the PassedToService gate was bypassable: on a
    // request that omits the key (every non-PassRole action above) the condition
    // is satisfied vacuously. REQ 7.4 asserts this operator is gone after C6.
    expect(Object.keys(baseline.Condition)).toEqual(["StringEqualsIfExists"]);
    expect(baseline.Condition.StringEqualsIfExists?.["iam:PassedToService"]).toEqual([
      "lambda.amazonaws.com",
      "appsync.amazonaws.com",
      "events.amazonaws.com",
    ]);
  });
});
