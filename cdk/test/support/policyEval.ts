/**
 * Offline IAM policy evaluator — test support only.
 *
 * This models the narrow subset of IAM policy evaluation that the deploy-role
 * privilege-escalation fix reasons about, so the synthesized policy documents
 * can be interrogated ("can this policy mutate a role it should not touch?")
 * without AWS credentials. It is the offline counterpart to the credentialed
 * `simulate-custom-policy` runs (validation steps V2–V4, V6), which remain the
 * authority on real IAM semantics.
 *
 * What is modelled:
 *
 * - `Effect: "Allow" | "Deny"`, with an explicit Deny beating every Allow.
 * - `Action` / `NotAction` with IAM wildcards (`*`, `?`), matched
 *   case-insensitively, which is how IAM compares action strings.
 * - `Resource` / `NotResource` with IAM wildcards, matched case-sensitively,
 *   which is how IAM compares resource ARNs.
 * - `Condition` blocks using the string and ARN comparisons the design's policy
 *   documents rely on — `StringEquals`, `StringLike`, `ArnEquals`, `ArnLike` —
 *   each also accepted with the `IfExists` suffix, over single-valued
 *   request-context keys. A policy-side array of values is an OR. An absent
 *   context key fails a plain comparison and satisfies the `...IfExists` form,
 *   which is the distinction Requirement 2 criteria 3–4 and Requirement 3
 *   criterion 4 rest on.
 *
 * What is deliberately not modelled: service control policies, resource-based
 * policies, session policies, permissions boundaries as a separate evaluation
 * pass (a boundary document is evaluated directly, as its own document),
 * multi-valued context keys, set operators (`ForAnyValue` / `ForAllValues`),
 * `Principal` / `NotPrincipal`, and every condition operator outside the four
 * above (no numeric, date, boolean, IP-address or `IgnoreCase` comparisons).
 * Anything unmodelled throws rather than guessing, so a policy shape this
 * evaluator cannot reason about can never be silently reported as `allowed` or
 * as denied.
 *
 * Test-only code: nothing here is shipped in `lib/`.
 *
 * Requirements: 4.2, 4.4, 4.5, 4.6, 4.7
 */

/** The three decisions this evaluator distinguishes. */
export type Decision = "allowed" | "implicitDeny" | "explicitDeny";

/** Statement effect, as it appears in a policy document. */
export type Effect = "Allow" | "Deny";

/** A single policy element that may be a scalar or an array of scalars. */
export type OneOrMany<T> = T | readonly T[];

/**
 * Condition values keyed by condition key, keyed by condition operator, exactly
 * as a `Condition` block is shaped in JSON.
 */
export type ConditionBlock = Readonly<
  Record<string, Readonly<Record<string, OneOrMany<string>>>>
>;

/** One statement of an IAM policy document. */
export interface PolicyStatement {
  readonly Sid?: string;
  readonly Effect: Effect;
  readonly Action?: OneOrMany<string>;
  readonly NotAction?: OneOrMany<string>;
  readonly Resource?: OneOrMany<string>;
  readonly NotResource?: OneOrMany<string>;
  readonly Condition?: ConditionBlock;
}

/** An IAM policy document with fully resolved (intrinsic-free) values. */
export interface PolicyDocument {
  readonly Version?: string;
  readonly Statement: OneOrMany<PolicyStatement>;
}

/**
 * Request-context keys supplied with the simulated request. A key mapped to
 * `undefined`, or simply missing, is treated as absent.
 */
export type RequestContext = Readonly<Record<string, string | undefined>>;

/** The request being evaluated against a document. */
export interface EvaluationRequest {
  readonly action: string;
  readonly resource: string;
  readonly context?: RequestContext;
}

/**
 * Base condition operators this evaluator understands, and whether the
 * policy-side value is an IAM wildcard pattern rather than a literal.
 *
 * All four compare case-sensitively. `ArnEquals` and `ArnLike` are documented as
 * behaving identically — both honour `*` and `?` in the pattern — so they share
 * one entry's semantics.
 */
const SUPPORTED_CONDITION_OPERATORS = {
  StringEquals: { wildcard: false },
  StringLike: { wildcard: true },
  ArnEquals: { wildcard: true },
  ArnLike: { wildcard: true },
} as const satisfies Record<string, { readonly wildcard: boolean }>;

type SupportedConditionOperator = keyof typeof SUPPORTED_CONDITION_OPERATORS;

/** A condition operator split into its base comparison and `IfExists` flag. */
interface ParsedConditionOperator {
  readonly base: SupportedConditionOperator;
  readonly ifExists: boolean;
}

function isSupportedOperator(operator: string): operator is SupportedConditionOperator {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_CONDITION_OPERATORS, operator);
}

/**
 * Split `StringEqualsIfExists` into `{ base: "StringEquals", ifExists: true }`,
 * or return `undefined` if the operator is outside the modelled subset.
 */
function parseConditionOperator(operator: string): ParsedConditionOperator | undefined {
  const ifExists = operator.endsWith("IfExists");
  const base = ifExists ? operator.slice(0, -"IfExists".length) : operator;
  return isSupportedOperator(base) ? { base, ifExists } : undefined;
}

/** The operator names this evaluator accepts, for error messages. */
function supportedOperatorNames(): readonly string[] {
  return Object.keys(SUPPORTED_CONDITION_OPERATORS).flatMap((base) => [
    base,
    `${base}IfExists`,
  ]);
}

/** Regex metacharacters that must be escaped when compiling an IAM pattern. */
const REGEX_METACHARACTERS = /[.+^${}()|[\]\\]/g;

const caseSensitiveCache = new Map<string, RegExp>();
const caseInsensitiveCache = new Map<string, RegExp>();

/**
 * Compile an IAM wildcard pattern into an anchored regular expression.
 *
 * `*` matches any sequence of characters including none, `?` matches exactly
 * one character, and every other character is literal. `[\s\S]` rather than `.`
 * so a newline inside a generated value cannot smuggle a match past the anchor.
 */
function compilePattern(pattern: string, caseSensitive: boolean): RegExp {
  const cache = caseSensitive ? caseSensitiveCache : caseInsensitiveCache;
  const cached = cache.get(pattern);
  if (cached !== undefined) {
    return cached;
  }

  let source = "^";
  for (const char of pattern) {
    if (char === "*") {
      source += "[\\s\\S]*";
    } else if (char === "?") {
      source += "[\\s\\S]";
    } else {
      source += char.replace(REGEX_METACHARACTERS, "\\$&");
    }
  }
  source += "$";

  const compiled = new RegExp(source, caseSensitive ? "" : "i");
  cache.set(pattern, compiled);
  return compiled;
}

/**
 * Does `arn` match the IAM resource pattern `pattern`?
 *
 * Resource matching is case-sensitive, per the IAM policy reference, so
 * `…role/wren-dev-Compute-*` does not match `…role/wren-dev-compute-cfn-deploy`.
 * Callers must not rely on that distinction for security — see the
 * `DenySelfMutation` statement — but the evaluator has to reproduce it faithfully
 * for the property tests to mean anything.
 */
export function matchesArnPattern(pattern: string, arn: string): boolean {
  return compilePattern(pattern, true).test(arn);
}

/**
 * Does `action` match the IAM action pattern `pattern`?
 *
 * Action matching is case-insensitive (`IAM:createrole` and `iam:CreateRole`
 * name the same action), and supports the same `*` / `?` wildcards.
 */
export function matchesActionPattern(pattern: string, action: string): boolean {
  return compilePattern(pattern, false).test(action);
}

/** Normalize a scalar-or-array policy element to an array. */
function toArray<T>(value: OneOrMany<T> | undefined): readonly T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value as T];
}

function describeStatement(statement: PolicyStatement): string {
  return statement.Sid === undefined ? "<no Sid>" : statement.Sid;
}

/** Does the statement's action element cover `action`? */
function actionMatches(statement: PolicyStatement, action: string): boolean {
  const hasAction = statement.Action !== undefined;
  const hasNotAction = statement.NotAction !== undefined;

  if (hasAction === hasNotAction) {
    throw new Error(
      `Statement ${describeStatement(statement)} must specify exactly one of Action or NotAction`,
    );
  }

  if (hasAction) {
    return toArray(statement.Action).some((pattern) => matchesActionPattern(pattern, action));
  }
  return !toArray(statement.NotAction).some((pattern) => matchesActionPattern(pattern, action));
}

/** Does the statement's resource element cover `resource`? */
function resourceMatches(statement: PolicyStatement, resource: string): boolean {
  const hasResource = statement.Resource !== undefined;
  const hasNotResource = statement.NotResource !== undefined;

  if (hasResource === hasNotResource) {
    throw new Error(
      `Statement ${describeStatement(statement)} must specify exactly one of Resource or NotResource`,
    );
  }

  if (hasResource) {
    return toArray(statement.Resource).some((pattern) => matchesArnPattern(pattern, resource));
  }
  // Deny + NotResource: the statement covers everything *except* the listed
  // patterns, which is what makes the role-mutation Deny non-inert.
  return !toArray(statement.NotResource).some((pattern) => matchesArnPattern(pattern, resource));
}

/** Does one policy-side condition value cover the supplied context value? */
function conditionValueMatches(
  base: SupportedConditionOperator,
  expected: string,
  supplied: string,
): boolean {
  return SUPPORTED_CONDITION_OPERATORS[base].wildcard
    ? compilePattern(expected, true).test(supplied)
    : expected === supplied;
}

/**
 * Is every condition in the statement's `Condition` block satisfied by
 * `context`?
 *
 * Multiple operators, and multiple keys within one operator, are ANDed; the
 * values listed for a single key are ORed. An absent key fails the plain form of
 * a comparison and satisfies the `...IfExists` form — the reason the fix never
 * puts `StringEqualsIfExists` on a role-mutation grant, and the reason a
 * `StringEquals` whose key is absent yields an implicit rather than explicit
 * deny.
 */
function conditionsSatisfied(statement: PolicyStatement, context: RequestContext): boolean {
  const block = statement.Condition;
  if (block === undefined) {
    return true;
  }

  for (const [operator, keys] of Object.entries(block)) {
    const parsed = parseConditionOperator(operator);
    if (parsed === undefined) {
      throw new Error(
        `Statement ${describeStatement(statement)} uses unsupported condition operator ` +
          `"${operator}"; this evaluator models only ` +
          `${supportedOperatorNames().join(", ")}`,
      );
    }

    for (const [key, expected] of Object.entries(keys)) {
      const supplied = context[key];

      if (supplied === undefined) {
        if (!parsed.ifExists) {
          return false;
        }
        continue;
      }

      const values = toArray(expected);
      if (!values.some((value) => conditionValueMatches(parsed.base, value, supplied))) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Does `statement` match the request? A matching statement is one whose action,
 * resource and condition elements all cover the request; its `Effect` then
 * decides the contribution to the overall decision.
 */
export function statementMatches(
  statement: PolicyStatement,
  request: EvaluationRequest,
): boolean {
  if (statement.Effect !== "Allow" && statement.Effect !== "Deny") {
    throw new Error(
      `Statement ${describeStatement(statement)} has invalid Effect ` +
        `${JSON.stringify(statement.Effect)}`,
    );
  }

  return (
    actionMatches(statement, request.action) &&
    resourceMatches(statement, request.resource) &&
    conditionsSatisfied(statement, request.context ?? {})
  );
}

/** Every statement of `document` that matches the request, in document order. */
export function matchingStatements(
  document: PolicyDocument,
  request: EvaluationRequest,
): readonly PolicyStatement[] {
  return toArray(document.Statement).filter((statement) => statementMatches(statement, request));
}

/**
 * Evaluate `request` against `document`.
 *
 * - `explicitDeny` — at least one matching statement has `Effect: "Deny"`. This
 *   is unconditional: an explicit Deny anywhere overrides every Allow, wherever
 *   it appears in the document.
 * - `allowed` — no matching Deny, and at least one matching Allow.
 * - `implicitDeny` — nothing matched, including the case where a statement's
 *   `StringEquals` condition went unsatisfied because its key was absent or
 *   carried a different value.
 */
export function evaluate(document: PolicyDocument, request: EvaluationRequest): Decision {
  let allowed = false;

  for (const statement of toArray(document.Statement)) {
    if (!statementMatches(statement, request)) {
      continue;
    }
    if (statement.Effect === "Deny") {
      return "explicitDeny";
    }
    allowed = true;
  }

  return allowed ? "allowed" : "implicitDeny";
}
