#!/usr/bin/env node
/**
 * Extract IAM policy documents from a synthesized Cicd stack template so they can
 * be fed straight into `aws iam simulate-custom-policy`.
 *
 * The IAM policy simulator accepts plain JSON policy documents only: it has no
 * understanding of CloudFormation intrinsics, so `Ref` / `Fn::Join` / `Fn::Sub`
 * must be collapsed to literals first. This script does exactly that, and nothing
 * else — it makes no AWS API call and needs no credentials.
 *
 * Two modes:
 *
 *   `--mode deploy-role` (default)
 *       Emits `Policies[0].PolicyDocument` of the Compute_Deploy_Role resource
 *       (`RoleName: ${prefix}-compute-cfn-deploy`), for
 *       `--policy-input-list`. Used by validation steps V2, V3 and V4.
 *
 *   `--mode boundary`
 *       Emits the `PolicyDocument` of Compute_Boundary_Policy
 *       (`ManagedPolicyName: ${prefix}-compute-boundary`), for
 *       `--permissions-boundary-policy-input-list`. Used by validation step V6.
 *       The boundary policy is introduced in Fix_Commit C4; before that commit is
 *       synthesized this mode exits with a message saying so rather than a stack
 *       trace.
 *
 * Usage:
 *
 *   cd cdk
 *   npx cdk synth ${prefix}-Cicd -c githubOwner=… -c githubRepo=…
 *   npx tsx scripts/extractDeployRolePolicy.ts \
 *     --account 123456789012 --region ca-central-1 --prefix wren-dev \
 *     --out /tmp/deploy-role-policy.json
 *
 *   aws iam simulate-custom-policy \
 *     --policy-input-list "$(cat /tmp/deploy-role-policy.json)" \
 *     --action-names iam:CreateRole \
 *     --resource-arns arn:aws:iam::123456789012:role/Attacker
 *
 * Requirements: 4.4, 4.5, 4.6, 10.2.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

/** Any value that can appear in a parsed CloudFormation template. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** A parsed CloudFormation template, reduced to the parts this script reads. */
export interface CfnTemplate {
  Resources?: { [logicalId: string]: JsonValue };
  [key: string]: JsonValue | undefined;
}

/** Everything needed to turn a template intrinsic into a literal. */
export interface ResolveContext {
  readonly account: string;
  readonly region: string;
  readonly partition: string;
  readonly stackName: string;
  readonly urlSuffix: string;
  /** `Ref` results for resources declared in the same template. */
  readonly refValues: ReadonlyMap<string, string>;
  /** `Fn::GetAtt` results, keyed `${logicalId}.${attribute}`. */
  readonly attValues: ReadonlyMap<string, string>;
}

/** Raised when an intrinsic cannot be collapsed to a literal. */
export class UnresolvedIntrinsicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnresolvedIntrinsicError";
  }
}

/** Raised for a template that does not carry the resource or policy being asked for. */
export class TemplateShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateShapeError";
  }
}

/** Marker for `Ref: AWS::NoValue`, which removes the enclosing key or array entry. */
const NO_VALUE = Symbol("AWS::NoValue");
type Resolved = JsonValue | typeof NO_VALUE;

const DEPLOY_ROLE_SUFFIX = "-compute-cfn-deploy";
const BOUNDARY_SUFFIX = "-compute-boundary";
const DEFAULT_REGION = "ca-central-1";

function isPlainObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Intrinsic resolution
// ---------------------------------------------------------------------------

function pseudoParameter(name: string, ctx: ResolveContext): string | undefined {
  switch (name) {
    case "AWS::AccountId":
      return ctx.account;
    case "AWS::Region":
      return ctx.region;
    case "AWS::Partition":
      return ctx.partition;
    case "AWS::StackName":
      return ctx.stackName;
    case "AWS::URLSuffix":
      return ctx.urlSuffix;
    default:
      return undefined;
  }
}

function resolveRef(name: string, ctx: ResolveContext, path: string): Resolved {
  if (name === "AWS::NoValue") return NO_VALUE;
  const pseudo = pseudoParameter(name, ctx);
  if (pseudo !== undefined) return pseudo;
  const fromTemplate = ctx.refValues.get(name);
  if (fromTemplate !== undefined) return fromTemplate;
  throw new UnresolvedIntrinsicError(
    `Cannot resolve { "Ref": "${name}" } at ${path}. ` +
      "Only pseudo parameters and IAM roles/managed policies declared in the same template are resolvable.",
  );
}

function resolveGetAtt(target: JsonValue, ctx: ResolveContext, path: string): Resolved {
  let key: string;
  if (typeof target === "string") {
    key = target;
  } else if (Array.isArray(target) && target.length === 2) {
    const logicalId = target[0];
    const attribute = target[1];
    if (typeof logicalId !== "string" || typeof attribute !== "string") {
      throw new UnresolvedIntrinsicError(`Malformed Fn::GetAtt at ${path}.`);
    }
    key = `${logicalId}.${attribute}`;
  } else {
    throw new UnresolvedIntrinsicError(`Malformed Fn::GetAtt at ${path}.`);
  }
  const value = ctx.attValues.get(key);
  if (value !== undefined) return value;
  throw new UnresolvedIntrinsicError(
    `Cannot resolve { "Fn::GetAtt": "${key}" } at ${path}. ` +
      "Only the ARN of an IAM role or managed policy declared in the same template is resolvable.",
  );
}

function expectString(value: Resolved, path: string, intrinsic: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new UnresolvedIntrinsicError(`${intrinsic} at ${path} did not resolve to a string.`);
}

function resolveJoin(args: JsonValue, ctx: ResolveContext, path: string): Resolved {
  if (!Array.isArray(args) || args.length !== 2) {
    throw new UnresolvedIntrinsicError(`Malformed Fn::Join at ${path}.`);
  }
  const delimiter = args[0];
  const parts = args[1];
  if (typeof delimiter !== "string" || !Array.isArray(parts)) {
    throw new UnresolvedIntrinsicError(`Malformed Fn::Join at ${path}.`);
  }
  const pieces: string[] = [];
  parts.forEach((part, index) => {
    const resolved = resolveValue(part, ctx, `${path}.Fn::Join[1][${index}]`);
    if (resolved === NO_VALUE) return;
    pieces.push(expectString(resolved, `${path}.Fn::Join[1][${index}]`, "Fn::Join member"));
  });
  return pieces.join(delimiter);
}

function resolveSub(args: JsonValue, ctx: ResolveContext, path: string): Resolved {
  let body: JsonValue;
  let vars: { [key: string]: JsonValue } = {};
  if (typeof args === "string") {
    body = args;
  } else if (Array.isArray(args) && args.length >= 1) {
    const first = args[0];
    if (first === undefined) throw new UnresolvedIntrinsicError(`Malformed Fn::Sub at ${path}.`);
    body = first;
    const second = args[1];
    if (isPlainObject(second)) vars = second;
  } else {
    throw new UnresolvedIntrinsicError(`Malformed Fn::Sub at ${path}.`);
  }
  if (typeof body !== "string") {
    throw new UnresolvedIntrinsicError(`Malformed Fn::Sub at ${path}: the template body is not a string.`);
  }

  return body.replace(/\$\{([^}]*)\}/g, (_match, rawName: string) => {
    const name = rawName.trim();
    // `${!Literal}` escapes the substitution.
    if (name.startsWith("!")) return `\${${name.slice(1)}}`;
    const override = vars[name];
    if (override !== undefined) {
      const resolved = resolveValue(override, ctx, `${path}.Fn::Sub[1].${name}`);
      if (resolved === NO_VALUE) {
        throw new UnresolvedIntrinsicError(`Fn::Sub variable "${name}" at ${path} resolved to AWS::NoValue.`);
      }
      return expectString(resolved, `${path}.Fn::Sub[1].${name}`, "Fn::Sub variable");
    }
    const pseudo = pseudoParameter(name, ctx);
    if (pseudo !== undefined) return pseudo;
    const att = name.includes(".") ? ctx.attValues.get(name) : ctx.refValues.get(name);
    if (att !== undefined) return att;
    throw new UnresolvedIntrinsicError(`Cannot resolve Fn::Sub variable "\${${name}}" at ${path}.`);
  });
}

function resolveSelect(args: JsonValue, ctx: ResolveContext, path: string): Resolved {
  if (!Array.isArray(args) || args.length !== 2) {
    throw new UnresolvedIntrinsicError(`Malformed Fn::Select at ${path}.`);
  }
  const rawIndex = resolveValue(args[0] as JsonValue, ctx, `${path}.Fn::Select[0]`);
  const list = resolveValue(args[1] as JsonValue, ctx, `${path}.Fn::Select[1]`);
  const index = Number(expectString(rawIndex, path, "Fn::Select index"));
  if (!Array.isArray(list) || !Number.isInteger(index) || index < 0 || index >= list.length) {
    throw new UnresolvedIntrinsicError(`Fn::Select at ${path} is out of range or not applied to a list.`);
  }
  return list[index] as JsonValue;
}

function resolveSplit(args: JsonValue, ctx: ResolveContext, path: string): Resolved {
  if (!Array.isArray(args) || args.length !== 2) {
    throw new UnresolvedIntrinsicError(`Malformed Fn::Split at ${path}.`);
  }
  const delimiter = args[0];
  if (typeof delimiter !== "string") {
    throw new UnresolvedIntrinsicError(`Malformed Fn::Split at ${path}.`);
  }
  const source = resolveValue(args[1] as JsonValue, ctx, `${path}.Fn::Split[1]`);
  return expectString(source, path, "Fn::Split source").split(delimiter);
}

function resolveValue(value: JsonValue, ctx: ResolveContext, path: string): Resolved {
  if (Array.isArray(value)) {
    const out: JsonValue[] = [];
    value.forEach((entry, index) => {
      const resolved = resolveValue(entry, ctx, `${path}[${index}]`);
      if (resolved !== NO_VALUE) out.push(resolved);
    });
    return out;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const only = keys.length === 1 ? keys[0] : undefined;
    if (only !== undefined) {
      const arg = value[only] as JsonValue;
      switch (only) {
        case "Ref":
          if (typeof arg !== "string") {
            throw new UnresolvedIntrinsicError(`Malformed Ref at ${path}.`);
          }
          return resolveRef(arg, ctx, path);
        case "Fn::GetAtt":
          return resolveGetAtt(arg, ctx, path);
        case "Fn::Join":
          return resolveJoin(arg, ctx, path);
        case "Fn::Sub":
          return resolveSub(arg, ctx, path);
        case "Fn::Select":
          return resolveSelect(arg, ctx, path);
        case "Fn::Split":
          return resolveSplit(arg, ctx, path);
        default:
          if (only.startsWith("Fn::")) {
            throw new UnresolvedIntrinsicError(
              `Unsupported intrinsic "${only}" at ${path}. ` +
                "Cross-stack references cannot be collapsed to literals; scope the policy to a synth-time literal instead.",
            );
          }
          break;
      }
    }

    const out: { [key: string]: JsonValue } = {};
    for (const key of keys) {
      const resolved = resolveValue(value[key] as JsonValue, ctx, `${path}.${key}`);
      if (resolved !== NO_VALUE) out[key] = resolved;
    }
    return out;
  }

  return value;
}

/**
 * Collapse every `Ref` / `Fn::Join` / `Fn::Sub` / `Fn::GetAtt` / `Fn::Select` /
 * `Fn::Split` in `value` to a literal, using `ctx` for account, region, partition
 * and same-template resource ARNs.
 *
 * @throws UnresolvedIntrinsicError when an intrinsic has no literal equivalent.
 */
export function resolveIntrinsics(value: JsonValue, ctx: ResolveContext, path = "$"): JsonValue {
  const resolved = resolveValue(value, ctx, path);
  if (resolved === NO_VALUE) {
    throw new UnresolvedIntrinsicError(`The value at ${path} resolved to AWS::NoValue.`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Template inspection
// ---------------------------------------------------------------------------

function bareContext(base: Omit<ResolveContext, "refValues" | "attValues">): ResolveContext {
  return { ...base, refValues: new Map(), attValues: new Map() };
}

/** Resolve a property to a literal string, or return undefined when it cannot be. */
function literalString(value: JsonValue | undefined, ctx: ResolveContext): string | undefined {
  if (value === undefined) return undefined;
  try {
    const resolved = resolveIntrinsics(value, ctx);
    return typeof resolved === "string" ? resolved : undefined;
  } catch {
    return undefined;
  }
}

function resourcesOf(template: CfnTemplate): { [logicalId: string]: JsonValue } {
  const resources = template.Resources;
  if (!isPlainObject(resources)) {
    throw new TemplateShapeError("The template has no `Resources` section.");
  }
  return resources;
}

function propertiesOf(resource: JsonValue): { [key: string]: JsonValue } {
  if (!isPlainObject(resource)) return {};
  const properties = resource["Properties"];
  return isPlainObject(properties) ? properties : {};
}

function typeOf(resource: JsonValue): string | undefined {
  if (!isPlainObject(resource)) return undefined;
  const type = resource["Type"];
  return typeof type === "string" ? type : undefined;
}

/**
 * Build the `Ref` / `Fn::GetAtt` lookup tables for the IAM resources of a template.
 *
 * Only explicitly named IAM roles and managed policies are resolvable: their
 * physical names are synth-time literals, so their ARNs are too. Everything else
 * gets a CloudFormation-generated name that does not exist until deploy time.
 */
export function buildResolveContext(
  template: CfnTemplate,
  base: Omit<ResolveContext, "refValues" | "attValues">,
): ResolveContext {
  const refValues = new Map<string, string>();
  const attValues = new Map<string, string>();
  const seed = bareContext(base);

  for (const [logicalId, resource] of Object.entries(resourcesOf(template))) {
    const properties = propertiesOf(resource);
    switch (typeOf(resource)) {
      case "AWS::IAM::Role": {
        const roleName = literalString(properties["RoleName"], seed);
        if (roleName === undefined) break;
        const arn = `arn:${base.partition}:iam::${base.account}:role/${roleName}`;
        // Ref on AWS::IAM::Role returns the role name; GetAtt Arn returns the ARN.
        refValues.set(logicalId, roleName);
        attValues.set(`${logicalId}.Arn`, arn);
        attValues.set(`${logicalId}.RoleName`, roleName);
        break;
      }
      case "AWS::IAM::ManagedPolicy": {
        const policyName = literalString(properties["ManagedPolicyName"], seed);
        if (policyName === undefined) break;
        const arn = `arn:${base.partition}:iam::${base.account}:policy/${policyName}`;
        // Ref on AWS::IAM::ManagedPolicy returns the policy ARN.
        refValues.set(logicalId, arn);
        attValues.set(`${logicalId}.PolicyArn`, arn);
        attValues.set(`${logicalId}.Arn`, arn);
        break;
      }
      default:
        break;
    }
  }

  return { ...base, refValues, attValues };
}

/** Locate the Compute_Deploy_Role resource by its explicit `RoleName`. */
export function findDeployRole(
  template: CfnTemplate,
  prefix: string,
  ctx: ResolveContext,
): { logicalId: string; resource: JsonValue } {
  const wanted = `${prefix}${DEPLOY_ROLE_SUFFIX}`;
  const roles = Object.entries(resourcesOf(template)).filter(([, r]) => typeOf(r) === "AWS::IAM::Role");

  for (const [logicalId, resource] of roles) {
    if (literalString(propertiesOf(resource)["RoleName"], ctx) === wanted) {
      return { logicalId, resource };
    }
  }
  // Fall back to the logical id CDK derives from the construct id, in case the
  // role name convention changes before this script does.
  for (const [logicalId, resource] of roles) {
    if (logicalId.startsWith("ComputeDeployRole")) return { logicalId, resource };
  }

  const names = roles.map(([id, r]) => `${id} (RoleName: ${literalString(propertiesOf(r)["RoleName"], ctx) ?? "<generated>"})`);
  throw new TemplateShapeError(
    `No AWS::IAM::Role named "${wanted}" in the template. Roles present: ${names.join(", ") || "none"}.`,
  );
}

function assertPolicyDocument(document: JsonValue, source: string): { [key: string]: JsonValue } {
  if (!isPlainObject(document)) {
    throw new TemplateShapeError(`${source} is not a JSON object.`);
  }
  const statements = document["Statement"];
  if (!Array.isArray(statements) || statements.length === 0) {
    throw new TemplateShapeError(`${source} has no Statement array.`);
  }
  statements.forEach((statement, index) => {
    if (!isPlainObject(statement)) {
      throw new TemplateShapeError(`${source} Statement[${index}] is not an object.`);
    }
    const effect = statement["Effect"];
    if (effect !== "Allow" && effect !== "Deny") {
      throw new TemplateShapeError(`${source} Statement[${index}] has no Allow/Deny Effect.`);
    }
    if (statement["Action"] === undefined && statement["NotAction"] === undefined) {
      throw new TemplateShapeError(`${source} Statement[${index}] grants no Action.`);
    }
  });
  if (typeof document["Version"] !== "string") {
    return { Version: "2012-10-17", ...document };
  }
  return document;
}

/**
 * Extract `Policies[0].PolicyDocument` from Compute_Deploy_Role, with every
 * intrinsic resolved — ready for `--policy-input-list`.
 */
export function extractDeployRolePolicy(
  template: CfnTemplate,
  prefix: string,
  ctx: ResolveContext,
): { [key: string]: JsonValue } {
  const { logicalId, resource } = findDeployRole(template, prefix, ctx);
  const policies = propertiesOf(resource)["Policies"];
  if (!Array.isArray(policies) || policies.length === 0) {
    throw new TemplateShapeError(`${logicalId} declares no inline Policies.`);
  }
  const first = policies[0];
  if (!isPlainObject(first) || first["PolicyDocument"] === undefined) {
    throw new TemplateShapeError(`${logicalId} Policies[0] carries no PolicyDocument.`);
  }
  const resolved = resolveIntrinsics(first["PolicyDocument"], ctx, `$.${logicalId}.Policies[0].PolicyDocument`);
  return assertPolicyDocument(resolved, `${logicalId} Policies[0].PolicyDocument`);
}

/**
 * Extract the Compute_Boundary_Policy document, with every intrinsic resolved —
 * ready for `--permissions-boundary-policy-input-list`.
 *
 * The boundary policy is created in Fix_Commit C4. Until that commit is
 * synthesized the template carries no `AWS::IAM::ManagedPolicy`, which this
 * reports as a plain message rather than a crash.
 */
export function extractBoundaryPolicy(
  template: CfnTemplate,
  prefix: string,
  ctx: ResolveContext,
): { [key: string]: JsonValue } {
  const wanted = `${prefix}${BOUNDARY_SUFFIX}`;
  const managed = Object.entries(resourcesOf(template)).filter(
    ([, r]) => typeOf(r) === "AWS::IAM::ManagedPolicy",
  );

  if (managed.length === 0) {
    throw new TemplateShapeError(
      `The template declares no AWS::IAM::ManagedPolicy, so the boundary policy "${wanted}" is not there yet. ` +
        "Compute_Boundary_Policy is created in Fix_Commit C4 (task 7.1); re-synthesize and re-run this mode after that commit.",
    );
  }

  const named = managed.map(
    ([logicalId, resource]) =>
      [logicalId, resource, literalString(propertiesOf(resource)["ManagedPolicyName"], ctx)] as const,
  );
  let chosen = named.find(([, , name]) => name === wanted);
  if (chosen === undefined && named.length === 1) {
    const only = named[0];
    if (only !== undefined) {
      chosen = only;
      process.stderr.write(
        `warning: no managed policy named "${wanted}"; using the only one present (${only[0]}).\n`,
      );
    }
  }
  if (chosen === undefined) {
    const present = named.map(([id, , name]) => `${id} (${name ?? "<generated>"})`).join(", ");
    throw new TemplateShapeError(
      `No AWS::IAM::ManagedPolicy named "${wanted}". Managed policies present: ${present}.`,
    );
  }

  const [logicalId, resource] = chosen;
  const document = propertiesOf(resource)["PolicyDocument"];
  if (document === undefined) {
    throw new TemplateShapeError(`${logicalId} carries no PolicyDocument.`);
  }
  const resolved = resolveIntrinsics(document, ctx, `$.${logicalId}.PolicyDocument`);
  return assertPolicyDocument(resolved, `${logicalId} PolicyDocument`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type Mode = "deploy-role" | "boundary";

export interface CliOptions {
  mode: Mode;
  prefix: string;
  account: string;
  region: string;
  partition: string;
  templatePath: string | undefined;
  outPath: string | undefined;
  pretty: boolean;
  help: boolean;
}

const USAGE = `Usage: npx tsx scripts/extractDeployRolePolicy.ts [options]

  --mode <deploy-role|boundary>  Which document to emit (default: deploy-role).
                                 deploy-role -> aws iam simulate-custom-policy --policy-input-list
                                 boundary    -> ... --permissions-boundary-policy-input-list
  --prefix <stackPrefix>         Stack prefix, e.g. wren-dev (env: STACK_PREFIX).
  --account <accountId>          Account id substituted for AWS::AccountId
                                 (env: CDK_DEFAULT_ACCOUNT, AWS_ACCOUNT_ID).
  --region <region>              Region substituted for AWS::Region
                                 (env: CDK_DEFAULT_REGION, AWS_REGION; default ${DEFAULT_REGION}).
  --partition <partition>        Partition substituted for AWS::Partition (default aws).
  --template <path>              Template to read (default cdk.out/<prefix>-Cicd.template.json).
  --out <path>                   Write here instead of stdout.
  --pretty                       Indent the output. Default is compact, which is what
                                 "$(cat file)" wants on the aws cli.
  -h, --help                     Show this message.
`;

/** Parse argv (without `node` and the script path) into options. */
export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = {}): CliOptions {
  const options: CliOptions = {
    mode: "deploy-role",
    prefix: env["STACK_PREFIX"] ?? "wren-dev",
    account: env["CDK_DEFAULT_ACCOUNT"] ?? env["AWS_ACCOUNT_ID"] ?? "",
    region: env["CDK_DEFAULT_REGION"] ?? env["AWS_REGION"] ?? env["AWS_DEFAULT_REGION"] ?? DEFAULT_REGION,
    partition: "aws",
    templatePath: undefined,
    outPath: undefined,
    pretty: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === "-h" || token === "--help") {
      options.help = true;
      continue;
    }
    if (token === "--pretty") {
      options.pretty = true;
      continue;
    }
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);
    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Option ${flag} needs a value.`);
      }
      i += 1;
      return next;
    };

    switch (flag) {
      case "--mode": {
        const value = takeValue();
        if (value !== "deploy-role" && value !== "boundary") {
          throw new Error(`Unknown --mode "${value}". Use deploy-role or boundary.`);
        }
        options.mode = value;
        break;
      }
      case "--prefix":
        options.prefix = takeValue();
        break;
      case "--account":
        options.account = takeValue();
        break;
      case "--region":
        options.region = takeValue();
        break;
      case "--partition":
        options.partition = takeValue();
        break;
      case "--template":
        options.templatePath = takeValue();
        break;
      case "--out":
        options.outPath = takeValue();
        break;
      default:
        throw new Error(`Unknown option "${flag}".\n\n${USAGE}`);
    }
  }

  return options;
}

/** Candidate paths for the synthesized Cicd template, in preference order. */
export function templateCandidates(options: CliOptions, cwd: string): string[] {
  if (options.templatePath !== undefined) return [resolvePath(cwd, options.templatePath)];
  const relative = `cdk.out/${options.prefix}-Cicd.template.json`;
  // Support being run from cdk/ (the documented spot) or from the repository root.
  return [resolvePath(cwd, relative), resolvePath(cwd, "cdk", relative)];
}

function readTemplate(options: CliOptions, cwd: string): CfnTemplate {
  const candidates = templateCandidates(options, cwd);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new TemplateShapeError(
      `No synthesized template found. Looked at:\n  ${candidates.join("\n  ")}\n` +
        `Run \`cd cdk && npx cdk synth ${options.prefix}-Cicd\` first.`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(found, "utf8"));
  if (!isPlainObject(parsed)) {
    throw new TemplateShapeError(`${found} does not parse to a JSON object.`);
  }
  return parsed as CfnTemplate;
}

/** Resolve the requested policy document from a parsed template. */
export function extract(template: CfnTemplate, options: CliOptions): { [key: string]: JsonValue } {
  const ctx = buildResolveContext(template, {
    account: options.account,
    region: options.region,
    partition: options.partition,
    stackName: `${options.prefix}-Cicd`,
    urlSuffix: "amazonaws.com",
  });
  return options.mode === "boundary"
    ? extractBoundaryPolicy(template, options.prefix, ctx)
    : extractDeployRolePolicy(template, options.prefix, ctx);
}

function main(argv: readonly string[]): number {
  let options: CliOptions;
  try {
    options = parseArgs(argv, process.env);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (options.account.trim().length === 0) {
    process.stderr.write(
      `--account is required (or set CDK_DEFAULT_ACCOUNT / AWS_ACCOUNT_ID): the policy documents embed\n` +
        `arn:aws:iam::<account>:… literals that the simulator has to see resolved.\n\n${USAGE}`,
    );
    return 1;
  }

  try {
    const template = readTemplate(options, process.cwd());
    const document = extract(template, options);
    const json = options.pretty ? JSON.stringify(document, null, 2) : JSON.stringify(document);
    if (options.outPath === undefined) {
      process.stdout.write(`${json}\n`);
    } else {
      const target = resolvePath(process.cwd(), options.outPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${json}\n`, "utf8");
      process.stderr.write(`Wrote ${options.mode} policy document to ${target}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof TemplateShapeError || error instanceof UnresolvedIntrinsicError) {
      process.stderr.write(`${error.name}: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

// Run only when invoked as a script, so the exported helpers stay unit-testable.
// Deliberately avoids `import.meta` / `require.main` so the same file works under
// tsx (ESM or CJS) and under ts-jest's CommonJS transform.
const entry = process.argv[1];
if (entry !== undefined && /extractDeployRolePolicy\.[cm]?[tj]s$/.test(entry)) {
  process.exitCode = main(process.argv.slice(2));
}
