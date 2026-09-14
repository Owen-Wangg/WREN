/**
 * Unit tests for the Policy_Simulation input extractor
 * (`cdk/scripts/extractDeployRolePolicy.ts`).
 *
 * The script is what turns a synthesized Cicd template into the plain JSON that
 * `aws iam simulate-custom-policy` accepts, so validation steps V2/V3/V4/V6 are
 * only as trustworthy as its intrinsic resolution. These tests cover that
 * resolution, both extraction modes, and the "boundary policy does not exist yet"
 * path that holds until Fix_Commit C4.
 *
 * Requirements: 4.4, 4.5, 4.6, 10.2
 */

import {
  buildResolveContext,
  extract,
  extractBoundaryPolicy,
  extractDeployRolePolicy,
  parseArgs,
  resolveIntrinsics,
  templateCandidates,
  TemplateShapeError,
  UnresolvedIntrinsicError,
  type CfnTemplate,
  type CliOptions,
  type ResolveContext,
} from "../scripts/extractDeployRolePolicy.js";

const ACCOUNT = "111122223333";
const REGION = "ca-central-1";
const PREFIX = "wren-test";

function options(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    mode: "deploy-role",
    prefix: PREFIX,
    account: ACCOUNT,
    region: REGION,
    partition: "aws",
    templatePath: undefined,
    outPath: undefined,
    pretty: false,
    help: false,
    ...overrides,
  };
}

/** A template shaped like the synthesized Cicd stack, trimmed to what is read. */
function template(extra: { [logicalId: string]: unknown } = {}): CfnTemplate {
  return {
    Resources: {
      ComputeDeployRole98DF8D2D: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: `${PREFIX}-compute-cfn-deploy`,
          Policies: [
            {
              PolicyName: "ComputeDeployInline",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Sid: "IamRoleTrustPolicy",
                    Effect: "Allow",
                    Action: "iam:UpdateAssumeRolePolicy",
                    Resource: {
                      "Fn::Join": ["", ["arn:aws:iam::", { Ref: "AWS::AccountId" }, `:role/${PREFIX}-Compute-*`]],
                    },
                  },
                  {
                    Sid: "SsmPutNotificationParameters",
                    Effect: "Allow",
                    Action: "ssm:PutParameter",
                    Resource: {
                      "Fn::Sub": `arn:\${AWS::Partition}:ssm:\${AWS::Region}:\${AWS::AccountId}:parameter/${PREFIX}/notifications/*`,
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      PipelineRoleD68726F7: { Type: "AWS::IAM::Role", Properties: {} },
      ...extra,
    },
  } as CfnTemplate;
}

function contextFor(tpl: CfnTemplate): ResolveContext {
  return buildResolveContext(tpl, {
    account: ACCOUNT,
    region: REGION,
    partition: "aws",
    stackName: `${PREFIX}-Cicd`,
    urlSuffix: "amazonaws.com",
  });
}

const boundaryResource = {
  Type: "AWS::IAM::ManagedPolicy",
  Properties: {
    ManagedPolicyName: `${PREFIX}-compute-boundary`,
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "DenyPrivilegeEscalation",
          Effect: "Deny",
          Action: ["iam:*", "sts:AssumeRole", "organizations:*"],
          Resource: "*",
        },
      ],
    },
  },
};

describe("resolveIntrinsics", () => {
  const ctx = contextFor(template());

  it("substitutes pseudo parameters inside Fn::Join", () => {
    expect(
      resolveIntrinsics({ "Fn::Join": ["", ["arn:aws:iam::", { Ref: "AWS::AccountId" }, ":role/x"]] }, ctx),
    ).toBe(`arn:aws:iam::${ACCOUNT}:role/x`);
  });

  it("substitutes pseudo parameters and escapes inside Fn::Sub", () => {
    expect(resolveIntrinsics({ "Fn::Sub": "arn:${AWS::Partition}:s3:::${!Literal}" }, ctx)).toBe(
      "arn:aws:s3:::${Literal}",
    );
  });

  it("resolves Fn::Sub variable maps", () => {
    expect(
      resolveIntrinsics(
        { "Fn::Sub": ["${Base}/${AWS::Region}", { Base: { "Fn::Join": ["-", ["a", "b"]] } }] },
        ctx,
      ),
    ).toBe(`a-b/${REGION}`);
  });

  it("resolves Ref and Fn::GetAtt for explicitly named IAM resources", () => {
    const ctxWithBoundary = contextFor(template({ ComputeBoundary: boundaryResource }));
    expect(resolveIntrinsics({ Ref: "ComputeBoundary" }, ctxWithBoundary)).toBe(
      `arn:aws:iam::${ACCOUNT}:policy/${PREFIX}-compute-boundary`,
    );
    expect(resolveIntrinsics({ "Fn::GetAtt": ["ComputeDeployRole98DF8D2D", "Arn"] }, ctxWithBoundary)).toBe(
      `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-compute-cfn-deploy`,
    );
  });

  it("drops AWS::NoValue from objects and arrays", () => {
    expect(resolveIntrinsics({ Keep: "a", Drop: { Ref: "AWS::NoValue" } }, ctx)).toEqual({ Keep: "a" });
    expect(resolveIntrinsics(["a", { Ref: "AWS::NoValue" }, "b"], ctx)).toEqual(["a", "b"]);
  });

  it("leaves plain values untouched and recurses into nested structures", () => {
    expect(resolveIntrinsics({ Condition: { StringEquals: { "iam:PassedToService": ["lambda.amazonaws.com"] } } }, ctx))
      .toEqual({ Condition: { StringEquals: { "iam:PassedToService": ["lambda.amazonaws.com"] } } });
  });

  it("fails loudly on an intrinsic with no literal equivalent", () => {
    expect(() => resolveIntrinsics({ "Fn::ImportValue": "SomeExport" }, ctx)).toThrow(UnresolvedIntrinsicError);
    expect(() => resolveIntrinsics({ Ref: "SomeOtherResource" }, ctx)).toThrow(UnresolvedIntrinsicError);
  });
});

describe("extractDeployRolePolicy", () => {
  it("returns the inline policy document with every ARN resolved to a literal", () => {
    const tpl = template();
    const document = extractDeployRolePolicy(tpl, PREFIX, contextFor(tpl));

    expect(document["Version"]).toBe("2012-10-17");
    expect(JSON.stringify(document)).not.toMatch(/Fn::|"Ref"/);
    const statements = document["Statement"] as Array<{ [key: string]: unknown }>;
    expect(statements[0]?.["Resource"]).toBe(`arn:aws:iam::${ACCOUNT}:role/${PREFIX}-Compute-*`);
    expect(statements[1]?.["Resource"]).toBe(
      `arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/${PREFIX}/notifications/*`,
    );
  });

  it("ignores other roles in the template", () => {
    const tpl = template();
    expect(() => extractDeployRolePolicy(tpl, PREFIX, contextFor(tpl))).not.toThrow();
  });

  it("reports a missing deploy role rather than throwing a type error", () => {
    const tpl = { Resources: { Other: { Type: "AWS::IAM::Role", Properties: {} } } } as CfnTemplate;
    expect(() => extractDeployRolePolicy(tpl, PREFIX, contextFor(tpl))).toThrow(TemplateShapeError);
  });

  it("rejects a statement with no Effect, which the simulator would reject too", () => {
    const tpl = template();
    const role = (tpl.Resources as Record<string, any>)["ComputeDeployRole98DF8D2D"];
    role.Properties.Policies[0].PolicyDocument.Statement[0] = { Action: "iam:CreateRole", Resource: "*" };
    expect(() => extractDeployRolePolicy(tpl, PREFIX, contextFor(tpl))).toThrow(/Allow\/Deny Effect/);
  });
});

describe("extractBoundaryPolicy", () => {
  it("returns the boundary document when the managed policy is present", () => {
    const tpl = template({ ComputeBoundary: boundaryResource });
    const document = extractBoundaryPolicy(tpl, PREFIX, contextFor(tpl));
    const statements = document["Statement"] as Array<{ [key: string]: unknown }>;
    expect(statements[0]?.["Sid"]).toBe("DenyPrivilegeEscalation");
  });

  it("degrades gracefully while no managed policy exists (pre-C4 templates)", () => {
    const tpl = template();
    expect(() => extractBoundaryPolicy(tpl, PREFIX, contextFor(tpl))).toThrow(TemplateShapeError);
    expect(() => extractBoundaryPolicy(tpl, PREFIX, contextFor(tpl))).toThrow(/Fix_Commit C4/);
  });
});

describe("cli option parsing", () => {
  it("defaults to deploy-role mode and reads account/region from the environment", () => {
    const parsed = parseArgs([], { CDK_DEFAULT_ACCOUNT: ACCOUNT, AWS_REGION: "us-east-1", STACK_PREFIX: PREFIX });
    expect(parsed.mode).toBe("deploy-role");
    expect(parsed.account).toBe(ACCOUNT);
    expect(parsed.region).toBe("us-east-1");
    expect(parsed.prefix).toBe(PREFIX);
  });

  it("accepts --flag value and --flag=value", () => {
    const parsed = parseArgs(["--mode", "boundary", `--account=${ACCOUNT}`, "--pretty"], {});
    expect(parsed.mode).toBe("boundary");
    expect(parsed.account).toBe(ACCOUNT);
    expect(parsed.pretty).toBe(true);
  });

  it("rejects an unknown mode and an unknown flag", () => {
    expect(() => parseArgs(["--mode", "nope"], {})).toThrow(/Unknown --mode/);
    expect(() => parseArgs(["--wat"], {})).toThrow(/Unknown option/);
  });

  it("defaults the template path to the synthesized Cicd stack, with a repo-root fallback", () => {
    const candidates = templateCandidates(options(), "/repo/cdk");
    expect(candidates[0]?.replace(/\\/g, "/")).toMatch(new RegExp(`/repo/cdk/cdk.out/${PREFIX}-Cicd.template.json$`));
    expect(candidates).toHaveLength(2);
  });

  it("routes both modes through extract()", () => {
    const tpl = template({ ComputeBoundary: boundaryResource });
    expect(extract(tpl, options())["Statement"]).toBeDefined();
    const boundary = extract(tpl, options({ mode: "boundary" }))["Statement"] as Array<{ Sid?: string }>;
    expect(boundary[0]?.Sid).toBe("DenyPrivilegeEscalation");
  });
});
