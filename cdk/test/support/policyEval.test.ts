/**
 * Unit tests for the offline IAM policy evaluator (`test/support/policyEval.ts`).
 *
 * The evaluator is the substrate the C6 property tests stand on: every claim
 * they make about the deploy role's policy ("this Deny is not inert", "an absent
 * `iam:PermissionsBoundary` yields an implicit rather than an explicit deny") is
 * only as trustworthy as the semantics modelled here. These tests pin those
 * semantics by example — wildcards, `?`, the resource/action case-sensitivity
 * split, `NotResource` inversion, explicit versus implicit deny, and condition
 * keys absent versus present — so a later edit to the evaluator cannot quietly
 * change what the property tests mean.
 *
 * Requirements: 4.2, 4.4, 4.7
 */

import {
  evaluate,
  matchesActionPattern,
  matchesArnPattern,
  matchingStatements,
  statementMatches,
  type PolicyDocument,
  type PolicyStatement,
} from "./policyEval.js";

const ACCOUNT = "111122223333";
const PREFIX = "wren-dev";

/** `Owned_Role_Prefix` — the only IAM role resource the fixed policy names. */
const OWNED_ROLE_PREFIX = `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-Compute-*`;
/** A role inside the owned prefix. */
const OWNED_ROLE = `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-Compute-DocumentFnRole1A2B3C`;
/** A role outside the owned prefix — what the Deny statement has to reach. */
const FOREIGN_ROLE = `arn:aws:iam::${ACCOUNT}:role/OrganizationAccountAccessRole`;
/** The deploy role's own ARN, in the lower case IAM actually stores it under. */
const DEPLOY_ROLE = `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-compute-cfn-deploy`;

const BOUNDARY_ARN = `arn:aws:iam::${ACCOUNT}:policy/${PREFIX}-compute-boundary`;

describe("policyEval — matchesArnPattern", () => {
  it("matches a literal pattern only against the identical ARN", () => {
    expect(matchesArnPattern(OWNED_ROLE, OWNED_ROLE)).toBe(true);
    expect(matchesArnPattern(OWNED_ROLE, `${OWNED_ROLE}X`)).toBe(false);
  });

  it("honours a trailing wildcard", () => {
    expect(matchesArnPattern(OWNED_ROLE_PREFIX, OWNED_ROLE)).toBe(true);
    expect(matchesArnPattern(OWNED_ROLE_PREFIX, FOREIGN_ROLE)).toBe(false);
  });

  it("honours a leading wildcard", () => {
    expect(matchesArnPattern(`*:role/${PREFIX}-Compute-Fn`, `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-Compute-Fn`)).toBe(
      true,
    );
    expect(matchesArnPattern("*-cfn-deploy", DEPLOY_ROLE)).toBe(true);
    expect(matchesArnPattern("*-cfn-deploy", OWNED_ROLE)).toBe(false);
  });

  it("honours a wildcard in the middle of the pattern", () => {
    expect(matchesArnPattern(`arn:aws:iam::*:role/${PREFIX}-Compute-Fn`, `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-Compute-Fn`)).toBe(
      true,
    );
    expect(matchesArnPattern("arn:aws:iam::*:role/*", FOREIGN_ROLE)).toBe(true);
    expect(matchesArnPattern("arn:aws:s3:::*/*", FOREIGN_ROLE)).toBe(false);
  });

  it("lets a wildcard match the empty string", () => {
    expect(matchesArnPattern(`arn:aws:iam::${ACCOUNT}:role/${PREFIX}-Compute-*`, `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-Compute-`)).toBe(
      true,
    );
    expect(matchesArnPattern("*", "")).toBe(true);
  });

  it("matches exactly one character per `?`", () => {
    const pattern = `arn:aws:secretsmanager:ca-central-1:${ACCOUNT}:secret:${PREFIX}/audit/log-??????`;
    expect(matchesArnPattern(pattern, `arn:aws:secretsmanager:ca-central-1:${ACCOUNT}:secret:${PREFIX}/audit/log-AbCdEf`)).toBe(
      true,
    );
    expect(matchesArnPattern(pattern, `arn:aws:secretsmanager:ca-central-1:${ACCOUNT}:secret:${PREFIX}/audit/log-AbCdE`)).toBe(
      false,
    );
    expect(matchesArnPattern(pattern, `arn:aws:secretsmanager:ca-central-1:${ACCOUNT}:secret:${PREFIX}/audit/log-AbCdEfG`)).toBe(
      false,
    );
  });

  it("anchors the pattern at both ends", () => {
    expect(matchesArnPattern("role/OrganizationAccountAccessRole", FOREIGN_ROLE)).toBe(false);
    expect(matchesArnPattern(`arn:aws:iam::${ACCOUNT}:role/`, FOREIGN_ROLE)).toBe(false);
  });

  it("compares resource ARNs case-sensitively", () => {
    // The reason `DenySelfMutation` exists: the owned-prefix pattern does not
    // reach the deploy role's own lower-cased ARN.
    expect(matchesArnPattern(OWNED_ROLE_PREFIX, DEPLOY_ROLE)).toBe(false);
    expect(matchesArnPattern(`arn:aws:iam::${ACCOUNT}:role/${PREFIX}-compute-*`, DEPLOY_ROLE)).toBe(true);
    expect(matchesArnPattern(OWNED_ROLE_PREFIX, OWNED_ROLE.toLowerCase())).toBe(false);
  });

  it("treats regex metacharacters in the pattern as literals", () => {
    expect(matchesArnPattern(`arn:aws:iam::${ACCOUNT}:role/a.c`, `arn:aws:iam::${ACCOUNT}:role/abc`)).toBe(false);
    expect(matchesArnPattern(`arn:aws:iam::${ACCOUNT}:role/a.c`, `arn:aws:iam::${ACCOUNT}:role/a.c`)).toBe(true);
    expect(matchesArnPattern("a+b", "aab")).toBe(false);
    expect(matchesArnPattern("a+b", "a+b")).toBe(true);
  });

  it("does not let a newline slip past a wildcard", () => {
    expect(matchesArnPattern(`arn:aws:iam::${ACCOUNT}:role/*`, `arn:aws:iam::${ACCOUNT}:role/a\nb`)).toBe(true);
    expect(matchesArnPattern("a?b", "a\nb")).toBe(true);
  });
});

describe("policyEval — matchesActionPattern", () => {
  it("compares action strings case-insensitively", () => {
    expect(matchesActionPattern("iam:CreateRole", "iam:createrole")).toBe(true);
    expect(matchesActionPattern("iam:CreateRole", "IAM:CREATEROLE")).toBe(true);
    expect(matchesActionPattern("iam:CreateRole", "iam:CreateRolePolicy")).toBe(false);
  });

  it("honours wildcards in the action pattern", () => {
    expect(matchesActionPattern("iam:*", "iam:PutRolePolicy")).toBe(true);
    expect(matchesActionPattern("iam:*Role", "iam:createrole")).toBe(true);
    expect(matchesActionPattern("iam:*Role", "iam:CreateRolePolicy")).toBe(false);
    expect(matchesActionPattern("iam:Get?ole", "iam:GetRole")).toBe(true);
    expect(matchesActionPattern("iam:Get?ole", "iam:GetPolicy")).toBe(false);
    expect(matchesActionPattern("*", "sts:AssumeRole")).toBe(true);
  });

  it("does not let an action pattern for one service match another", () => {
    expect(matchesActionPattern("iam:*", "sts:AssumeRole")).toBe(false);
    expect(matchesActionPattern("lambda:InvokeFunction", "lambda:InvokeFunctionUrl")).toBe(false);
  });
});

describe("policyEval — statement element validation", () => {
  const allowCreateRole = {
    Sid: "IamRoleMutationWithBoundary",
    Effect: "Allow",
    Action: "iam:CreateRole",
    Resource: OWNED_ROLE_PREFIX,
  } as const satisfies PolicyStatement;

  const request = { action: "iam:CreateRole", resource: OWNED_ROLE };

  it("matches when action, resource and (absent) condition all cover the request", () => {
    expect(statementMatches(allowCreateRole, request)).toBe(true);
  });

  it("accepts scalar and array forms of Action and Resource alike", () => {
    expect(
      statementMatches(
        {
          Sid: "ArrayForm",
          Effect: "Allow",
          Action: ["iam:PutRolePolicy", "iam:CreateRole"],
          Resource: [`arn:aws:iam::${ACCOUNT}:role/other-*`, OWNED_ROLE_PREFIX],
        },
        request,
      ),
    ).toBe(true);
  });

  it("throws when neither Action nor NotAction is present", () => {
    expect(() =>
      statementMatches({ Sid: "NoAction", Effect: "Allow", Resource: OWNED_ROLE_PREFIX }, request),
    ).toThrow(/NoAction must specify exactly one of Action or NotAction/);
  });

  it("throws when both Action and NotAction are present", () => {
    expect(() =>
      statementMatches(
        {
          Sid: "BothActions",
          Effect: "Allow",
          Action: "iam:CreateRole",
          NotAction: "iam:PassRole",
          Resource: OWNED_ROLE_PREFIX,
        },
        request,
      ),
    ).toThrow(/BothActions must specify exactly one of Action or NotAction/);
  });

  it("throws when neither Resource nor NotResource is present", () => {
    expect(() => statementMatches({ Effect: "Allow", Action: "iam:CreateRole" }, request)).toThrow(
      /<no Sid> must specify exactly one of Resource or NotResource/,
    );
  });

  it("throws when both Resource and NotResource are present", () => {
    expect(() =>
      statementMatches(
        {
          Sid: "BothResources",
          Effect: "Deny",
          Action: "iam:CreateRole",
          Resource: "*",
          NotResource: OWNED_ROLE_PREFIX,
        },
        request,
      ),
    ).toThrow(/BothResources must specify exactly one of Resource or NotResource/);
  });

  it("throws on an Effect outside Allow and Deny", () => {
    const bogus = { Sid: "Bogus", Effect: "allow", Action: "iam:CreateRole", Resource: "*" } as unknown as PolicyStatement;
    expect(() => statementMatches(bogus, request)).toThrow(/Bogus has invalid Effect "allow"/);
  });

  it("inverts NotAction", () => {
    const notAction = {
      Sid: "NotActionForm",
      Effect: "Deny",
      NotAction: ["iam:GetRole", "iam:ListRolePolicies"],
      Resource: "*",
    } as const satisfies PolicyStatement;

    expect(statementMatches(notAction, { action: "iam:CreateRole", resource: OWNED_ROLE })).toBe(true);
    expect(statementMatches(notAction, { action: "iam:getrole", resource: OWNED_ROLE })).toBe(false);
  });
});

describe("policyEval — NotResource inversion", () => {
  /** `DenyOutOfScopeStacks`, as C3 rewrites it. */
  const denyOutOfScope = {
    Sid: "DenyOutOfScopeStacks",
    Effect: "Deny",
    Action: ["iam:CreateRole", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:UpdateAssumeRolePolicy"],
    NotResource: [OWNED_ROLE_PREFIX],
  } as const satisfies PolicyStatement;

  it("covers every resource except the listed patterns", () => {
    expect(statementMatches(denyOutOfScope, { action: "iam:CreateRole", resource: FOREIGN_ROLE })).toBe(true);
    expect(statementMatches(denyOutOfScope, { action: "iam:CreateRole", resource: OWNED_ROLE })).toBe(false);
  });

  it("covers a non-role resource such as a bare `*` under the inversion", () => {
    expect(statementMatches(denyOutOfScope, { action: "iam:PutRolePolicy", resource: "*" })).toBe(true);
  });

  it("leaves a non-listed action unmatched regardless of resource", () => {
    expect(statementMatches(denyOutOfScope, { action: "iam:GetRole", resource: FOREIGN_ROLE })).toBe(false);
  });

  it("is not an inert Deny once composed with the owned-prefix Allow", () => {
    const document: PolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        { Sid: "IamRoleReadTagAndTeardown", Effect: "Allow", Action: "iam:*", Resource: OWNED_ROLE_PREFIX },
        denyOutOfScope,
      ],
    };

    // Requirement 4 criteria 4–6: out of scope is an explicit deny, not merely
    // an unmatched request.
    expect(evaluate(document, { action: "iam:CreateRole", resource: FOREIGN_ROLE })).toBe("explicitDeny");
    expect(evaluate(document, { action: "iam:PutRolePolicy", resource: FOREIGN_ROLE })).toBe("explicitDeny");
    expect(evaluate(document, { action: "iam:UpdateAssumeRolePolicy", resource: FOREIGN_ROLE })).toBe("explicitDeny");
    // Requirement 4 criterion 7: inside the prefix the Allow survives.
    expect(evaluate(document, { action: "iam:CreateRole", resource: OWNED_ROLE })).toBe("allowed");
  });
});

describe("policyEval — evaluate", () => {
  const allowOwnedPrefix = {
    Sid: "IamRoleReadTagAndTeardown",
    Effect: "Allow",
    Action: "iam:*",
    Resource: OWNED_ROLE_PREFIX,
  } as const satisfies PolicyStatement;

  const denySelfMutation = {
    Sid: "DenySelfMutation",
    Effect: "Deny",
    Action: "iam:*",
    Resource: DEPLOY_ROLE,
  } as const satisfies PolicyStatement;

  it("returns allowed when a matching Allow and no matching Deny exists", () => {
    expect(evaluate({ Statement: [allowOwnedPrefix] }, { action: "iam:GetRole", resource: OWNED_ROLE })).toBe("allowed");
  });

  it("returns implicitDeny when nothing matches", () => {
    expect(evaluate({ Statement: [allowOwnedPrefix] }, { action: "iam:GetRole", resource: FOREIGN_ROLE })).toBe(
      "implicitDeny",
    );
    expect(evaluate({ Statement: [] }, { action: "iam:GetRole", resource: OWNED_ROLE })).toBe("implicitDeny");
  });

  it("lets an explicit Deny beat an Allow regardless of document order", () => {
    const request = { action: "iam:PutRolePolicy", resource: DEPLOY_ROLE };
    const allowLowerCasePrefix = {
      Sid: "AllowLowerCasePrefix",
      Effect: "Allow",
      Action: "iam:*",
      Resource: `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-compute-*`,
    } as const satisfies PolicyStatement;

    expect(evaluate({ Statement: [allowLowerCasePrefix, denySelfMutation] }, request)).toBe("explicitDeny");
    expect(evaluate({ Statement: [denySelfMutation, allowLowerCasePrefix] }, request)).toBe("explicitDeny");
  });

  it("accepts a single-statement document as a scalar", () => {
    expect(evaluate({ Statement: allowOwnedPrefix }, { action: "iam:TagRole", resource: OWNED_ROLE })).toBe("allowed");
  });

  it("reports every matching statement in document order", () => {
    const document: PolicyDocument = { Statement: [allowOwnedPrefix, denySelfMutation] };
    const request = { action: "iam:GetRole", resource: DEPLOY_ROLE };

    expect(matchingStatements(document, request).map((statement) => statement.Sid)).toEqual(["DenySelfMutation"]);
    expect(
      matchingStatements(document, { action: "iam:GetRole", resource: OWNED_ROLE }).map((statement) => statement.Sid),
    ).toEqual(["IamRoleReadTagAndTeardown"]);
  });
});

describe("policyEval — conditions", () => {
  /** Statement 1.3, as C6 leaves it: `StringEquals`, never `...IfExists`. */
  const roleMutationWithBoundary = {
    Sid: "IamRoleMutationWithBoundary",
    Effect: "Allow",
    Action: ["iam:CreateRole", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:PutRolePermissionsBoundary"],
    Resource: OWNED_ROLE_PREFIX,
    Condition: { StringEquals: { "iam:PermissionsBoundary": BOUNDARY_ARN } },
  } as const satisfies PolicyStatement;

  const document: PolicyDocument = { Version: "2012-10-17", Statement: [roleMutationWithBoundary] };
  const createRole = { action: "iam:CreateRole", resource: OWNED_ROLE };

  it("allows the request when the condition key is present with the expected value", () => {
    expect(evaluate(document, { ...createRole, context: { "iam:PermissionsBoundary": BOUNDARY_ARN } })).toBe("allowed");
  });

  it("implicitly denies when the condition key is absent", () => {
    // Requirement 2 criterion 4: the unsatisfied StringEquals is the deny; no
    // extra Deny statement is needed, and the result must not be explicitDeny.
    expect(evaluate(document, createRole)).toBe("implicitDeny");
    expect(evaluate(document, { ...createRole, context: {} })).toBe("implicitDeny");
    expect(evaluate(document, { ...createRole, context: { "iam:PermissionsBoundary": undefined } })).toBe(
      "implicitDeny",
    );
  });

  it("implicitly denies when the condition key carries a different value", () => {
    expect(evaluate(document, { ...createRole, context: { "iam:PermissionsBoundary": "" } })).toBe("implicitDeny");
    expect(
      evaluate(document, {
        ...createRole,
        context: { "iam:PermissionsBoundary": `arn:aws:iam::${ACCOUNT}:policy/AdministratorAccess` },
      }),
    ).toBe("implicitDeny");
  });

  it("compares StringEquals values case-sensitively and without wildcards", () => {
    expect(evaluate(document, { ...createRole, context: { "iam:PermissionsBoundary": BOUNDARY_ARN.toUpperCase() } })).toBe(
      "implicitDeny",
    );
    expect(
      evaluate(
        { Statement: [{ ...roleMutationWithBoundary, Condition: { StringEquals: { "iam:PermissionsBoundary": "*" } } }] },
        { ...createRole, context: { "iam:PermissionsBoundary": BOUNDARY_ARN } },
      ),
    ).toBe("implicitDeny");
  });

  it("satisfies the IfExists form when the key is absent, and still compares it when present", () => {
    const ifExists: PolicyDocument = {
      Statement: [
        { ...roleMutationWithBoundary, Condition: { StringEqualsIfExists: { "iam:PermissionsBoundary": BOUNDARY_ARN } } },
      ],
    };

    expect(evaluate(ifExists, createRole)).toBe("allowed");
    expect(evaluate(ifExists, { ...createRole, context: { "iam:PermissionsBoundary": BOUNDARY_ARN } })).toBe("allowed");
    expect(evaluate(ifExists, { ...createRole, context: { "iam:PermissionsBoundary": "arn:aws:iam::aws:policy/X" } })).toBe(
      "implicitDeny",
    );
  });

  it("treats a policy-side array of condition values as an OR", () => {
    /** `IamPassRoleToComputeServices`, as C2 writes it. */
    const passRole: PolicyDocument = {
      Statement: [
        {
          Sid: "IamPassRoleToComputeServices",
          Effect: "Allow",
          Action: "iam:PassRole",
          Resource: OWNED_ROLE_PREFIX,
          Condition: {
            StringEquals: { "iam:PassedToService": ["lambda.amazonaws.com", "appsync.amazonaws.com"] },
          },
        },
      ],
    };
    const request = { action: "iam:PassRole", resource: OWNED_ROLE };

    expect(evaluate(passRole, { ...request, context: { "iam:PassedToService": "lambda.amazonaws.com" } })).toBe(
      "allowed",
    );
    expect(evaluate(passRole, { ...request, context: { "iam:PassedToService": "appsync.amazonaws.com" } })).toBe(
      "allowed",
    );
    expect(evaluate(passRole, { ...request, context: { "iam:PassedToService": "events.amazonaws.com" } })).toBe(
      "implicitDeny",
    );
    expect(evaluate(passRole, request)).toBe("implicitDeny");
  });

  it("ANDs multiple keys and multiple operators", () => {
    const twoKeys: PolicyDocument = {
      Statement: [
        {
          Sid: "TwoConditions",
          Effect: "Allow",
          Action: "iam:CreateRole",
          Resource: OWNED_ROLE_PREFIX,
          Condition: {
            StringEquals: { "iam:PermissionsBoundary": BOUNDARY_ARN },
            ArnLike: { "aws:PrincipalArn": `arn:aws:iam::${ACCOUNT}:role/${PREFIX}-*` },
          },
        },
      ],
    };

    expect(
      evaluate(twoKeys, {
        ...createRole,
        context: { "iam:PermissionsBoundary": BOUNDARY_ARN, "aws:PrincipalArn": DEPLOY_ROLE },
      }),
    ).toBe("allowed");
    expect(
      evaluate(twoKeys, {
        ...createRole,
        context: { "iam:PermissionsBoundary": BOUNDARY_ARN, "aws:PrincipalArn": FOREIGN_ROLE },
      }),
    ).toBe("implicitDeny");
    expect(evaluate(twoKeys, { ...createRole, context: { "aws:PrincipalArn": DEPLOY_ROLE } })).toBe("implicitDeny");
  });

  it("honours wildcards in StringLike, ArnEquals and ArnLike but not StringEquals", () => {
    const withOperator = (operator: string, expected: string): PolicyDocument => ({
      Statement: [
        {
          Sid: "OperatorProbe",
          Effect: "Allow",
          Action: "iam:CreateRole",
          Resource: OWNED_ROLE_PREFIX,
          Condition: { [operator]: { "iam:PermissionsBoundary": expected } },
        },
      ],
    });
    const context = { "iam:PermissionsBoundary": BOUNDARY_ARN };

    for (const operator of ["StringLike", "ArnEquals", "ArnLike"]) {
      expect(evaluate(withOperator(operator, `arn:aws:iam::${ACCOUNT}:policy/${PREFIX}-*`), { ...createRole, context })).toBe(
        "allowed",
      );
      expect(evaluate(withOperator(operator, `arn:aws:iam::${ACCOUNT}:policy/other-*`), { ...createRole, context })).toBe(
        "implicitDeny",
      );
    }

    expect(evaluate(withOperator("StringEquals", `arn:aws:iam::${ACCOUNT}:policy/${PREFIX}-*`), { ...createRole, context })).toBe(
      "implicitDeny",
    );
  });

  it("throws rather than guessing at a condition operator outside the modelled subset", () => {
    for (const operator of ["NumericLessThan", "StringNotEquals", "StringEqualsIgnoreCase", "ForAnyValue:StringEquals"]) {
      expect(() =>
        evaluate(
          {
            Statement: [
              {
                Sid: "Unsupported",
                Effect: "Allow",
                Action: "iam:CreateRole",
                Resource: OWNED_ROLE_PREFIX,
                Condition: { [operator]: { "iam:PermissionsBoundary": BOUNDARY_ARN } },
              },
            ],
          },
          { ...createRole, context: { "iam:PermissionsBoundary": BOUNDARY_ARN } },
        ),
      ).toThrow(/unsupported condition operator/);
    }
  });
});
