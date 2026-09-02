#!/usr/bin/env node
/**
 * Collect and validate the VPC endpoint baseline used before and after the
 * managed RDS/API Gateway interface-endpoint removal.
 *
 * The script is deliberately read-only: every AWS CLI call is a describe,
 * list, or Cost Explorer query. It does not print secret values and it does
 * not create, update, or delete AWS resources.
 *
 * Usage:
 *   cd cdk
 *   npx tsx scripts/vpcEndpointBaseline.ts \
 *     --profile wren-dev --region ca-central-1 --stack-prefix wren-dev \
 *     --phase baseline --out ../artifacts/wren-dev-vpc-baseline.json
 *
 * Use `--phase post-removal` after the VPC stack deploy to require the three
 * retained private interface endpoints only.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

export type EndpointPhase = "baseline" | "post-removal";

export interface EndpointSummary {
  readonly Service: string;
  readonly State: string;
  readonly PrivateDns: boolean;
  readonly Subnets: readonly string[];
  /** Gateway endpoints use route-table associations instead of subnets. */
  readonly RouteTables: readonly string[];
}

export interface NatGatewaySummary {
  readonly Id: string;
  readonly State: string;
  readonly Subnet: string;
  readonly Created: string;
}

export interface FlowLogSummary {
  readonly Id: string;
  readonly Traffic: string;
  readonly LogGroup: string;
  readonly Status: string;
}

export interface CollectionFailure {
  readonly status: "unavailable";
  readonly message: string;
}

export interface VpcEndpointBaselineReport {
  readonly collectedAt: string;
  readonly stackPrefix: string;
  readonly region: string;
  readonly phase: EndpointPhase;
  readonly costWindow: {
    readonly start: string;
    readonly end: string;
  };
  readonly vpcId: string;
  readonly endpoints: readonly EndpointSummary[];
  readonly natGateways: readonly NatGatewaySummary[];
  readonly flowLogs: readonly FlowLogSummary[];
  readonly cloudTrails: unknown;
  readonly costExplorer: unknown | CollectionFailure;
}

export interface ValidationResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export const BASELINE_INTERFACE_SERVICES = [
  "ssm",
  "rds",
  "execute-api",
  "secretsmanager",
  "bedrock-runtime",
] as const;

export const POST_REMOVAL_INTERFACE_SERVICES = [
  "ssm",
  "secretsmanager",
  "bedrock-runtime",
] as const;

const GATEWAY_SERVICES = ["dynamodb", "s3"] as const;

export function expectedInterfaceServices(phase: EndpointPhase): readonly string[] {
  return phase === "baseline" ? BASELINE_INTERFACE_SERVICES : POST_REMOVAL_INTERFACE_SERVICES;
}

export function parseAwsJson(raw: string, source: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${source} returned invalid JSON: ${message}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected a non-empty string for ${field}.`);
  }
  return value;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Expected a boolean for ${field}.`);
  }
  return value;
}

function asStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Expected an array of strings for ${field}.`);
  }
  return value as readonly string[];
}

function asOptionalStringArray(value: unknown, field: string): readonly string[] {
  return value === undefined || value === null ? [] : asStringArray(value, field);
}

function asArray(value: unknown, source: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source} returned an unexpected shape; expected an array.`);
  }
  return value;
}

export function normalizeEndpoints(value: unknown): readonly EndpointSummary[] {
  return asArray(value, "describe-vpc-endpoints").map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Endpoint ${index} is not an object.`);
    return {
      Service: asString(entry["Service"], `endpoints[${index}].Service`),
      State: asString(entry["State"], `endpoints[${index}].State`),
      PrivateDns: asBoolean(entry["PrivateDns"], `endpoints[${index}].PrivateDns`),
      Subnets: asStringArray(entry["Subnets"], `endpoints[${index}].Subnets`),
      RouteTables: asOptionalStringArray(entry["RouteTables"], `endpoints[${index}].RouteTables`),
    };
  });
}

export function normalizeNatGateways(value: unknown): readonly NatGatewaySummary[] {
  return asArray(value, "describe-nat-gateways").map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`NAT gateway ${index} is not an object.`);
    return {
      Id: asString(entry["Id"], `natGateways[${index}].Id`),
      State: asString(entry["State"], `natGateways[${index}].State`),
      Subnet: asString(entry["Subnet"], `natGateways[${index}].Subnet`),
      Created: asString(entry["Created"], `natGateways[${index}].Created`),
    };
  });
}

export function normalizeFlowLogs(value: unknown): readonly FlowLogSummary[] {
  return asArray(value, "describe-flow-logs").map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Flow log ${index} is not an object.`);
    return {
      Id: asString(entry["Id"], `flowLogs[${index}].Id`),
      Traffic: asString(entry["Traffic"], `flowLogs[${index}].Traffic`),
      LogGroup: asString(entry["LogGroup"], `flowLogs[${index}].LogGroup`),
      Status: asString(entry["Status"], `flowLogs[${index}].Status`),
    };
  });
}

function serviceName(region: string, shortName: string): string {
  return `com.amazonaws.${region}.${shortName}`;
}

function isUnavailable(value: unknown): value is CollectionFailure {
  return isRecord(value) && value["status"] === "unavailable" && typeof value["message"] === "string";
}

/** Validate endpoint, egress, and logging invariants without calling AWS. */
export function validateBaseline(report: VpcEndpointBaselineReport): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const expectedInterfaces = expectedInterfaceServices(report.phase).map((service) =>
    serviceName(report.region, service),
  );
  const discoveredInterfaces = report.endpoints.filter(
    (endpoint) => endpoint.Subnets.length > 0 && endpoint.Service.startsWith(`com.amazonaws.${report.region}.`),
  );
  const actualServices = discoveredInterfaces.map((endpoint) => endpoint.Service).sort();
  const expectedServices = [...expectedInterfaces].sort();

  for (const expected of expectedServices) {
    const endpoint = discoveredInterfaces.find((candidate) => candidate.Service === expected);
    if (endpoint === undefined) {
      errors.push(`Missing required interface endpoint: ${expected}.`);
      continue;
    }
    if (endpoint.State !== "available") {
      errors.push(`${expected} is ${endpoint.State}, not available.`);
    }
    if (!endpoint.PrivateDns) {
      errors.push(`${expected} does not have private DNS enabled.`);
    }
    if (endpoint.Subnets.length !== 2) {
      errors.push(`${expected} is associated with ${endpoint.Subnets.length} subnets; expected 2.`);
    }
  }

  for (const actual of actualServices) {
    if (!expectedServices.includes(actual)) {
      errors.push(`Unexpected managed interface endpoint: ${actual}.`);
    }
  }

  for (const gateway of GATEWAY_SERVICES) {
    const expected = serviceName(report.region, gateway);
    const endpoint = report.endpoints.find((candidate) => candidate.Service === expected);
    if (endpoint === undefined) {
      errors.push(`Missing gateway endpoint: ${expected}.`);
      continue;
    }
    if (endpoint.State !== "available") {
      errors.push(`Gateway endpoint ${expected} is ${endpoint.State}, not available.`);
    }
    if (endpoint.Subnets.length !== 0) {
      errors.push(`Gateway endpoint ${expected} unexpectedly lists subnet associations.`);
    }
    if (endpoint.RouteTables.length === 0) {
      errors.push(`Gateway endpoint ${expected} has no route-table associations.`);
    }
  }

  if (report.natGateways.length !== 1 || report.natGateways[0]?.State !== "available") {
    errors.push("Expected exactly one available NAT gateway for approved fallback egress.");
  }

  const activeAllTrafficFlowLog = report.flowLogs.find(
    (flowLog) => flowLog.Traffic === "ALL" && flowLog.Status === "SUCCESS" && flowLog.LogGroup.length > 0,
  );
  if (activeAllTrafficFlowLog === undefined) {
    errors.push("No successful ALL-traffic VPC Flow Log with a CloudWatch Logs destination was found.");
  }

  if (isUnavailable(report.costExplorer)) {
    warnings.push(`Cost Explorer data is unavailable: ${report.costExplorer.message}`);
  }

  const unmanagedPrivateLink = report.endpoints.filter((endpoint) => endpoint.Service.startsWith("com.amazonaws.vpce."));
  if (unmanagedPrivateLink.length > 0) {
    warnings.push(
      `Excluded ${unmanagedPrivateLink.length} non-AWS-service PrivateLink endpoint(s) from managed endpoint validation.`,
    );
  }

  return { errors, warnings };
}

export interface CliOptions {
  readonly profile: string;
  readonly region: string;
  readonly stackPrefix: string;
  readonly phase: EndpointPhase;
  readonly start: string;
  readonly end: string;
  readonly outPath?: string;
}

function utcDate(daysBeforeToday: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysBeforeToday);
  return date.toISOString().slice(0, 10);
}

function validDate(value: string, optionName: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${optionName} must use YYYY-MM-DD format.`);
  }
  return value;
}

export function parseArgs(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const values: Record<string, string | undefined> = {
    profile: env["AWS_PROFILE"] ?? "wren-dev",
    region: env["AWS_REGION"] ?? env["AWS_DEFAULT_REGION"] ?? "ca-central-1",
    stackPrefix: env["STACK_PREFIX"] ?? "wren-dev",
    phase: "baseline",
    start: utcDate(30),
    end: utcDate(0),
  };
  let outPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === undefined) continue;
    if (option === "--help" || option === "-h") {
      throw new Error(usage());
    }
    if (option === "--out") {
      outPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (["--profile", "--region", "--stack-prefix", "--phase", "--start", "--end"].includes(option)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value.`);
      values[option.slice(2).replace("stack-prefix", "stackPrefix")] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${option}.\n${usage()}`);
  }

  const phase = values["phase"];
  if (phase !== "baseline" && phase !== "post-removal") {
    throw new Error("--phase must be baseline or post-removal.");
  }
  const profile = asString(values["profile"], "profile");
  const region = asString(values["region"], "region");
  const stackPrefix = asString(values["stackPrefix"], "stackPrefix");
  const start = validDate(asString(values["start"], "start"), "--start");
  const end = validDate(asString(values["end"], "end"), "--end");
  if (start >= end) throw new Error("--start must be earlier than --end.");

  return { profile, region, stackPrefix, phase, start, end, ...(outPath ? { outPath } : {}) };
}

function usage(): string {
  return `Usage: npx tsx scripts/vpcEndpointBaseline.ts [options]

  --profile <name>        AWS CLI profile (default AWS_PROFILE or wren-dev)
  --region <region>       AWS region (default AWS_REGION or ca-central-1)
  --stack-prefix <prefix> Stack prefix (default STACK_PREFIX or wren-dev)
  --phase <phase>         baseline | post-removal (default baseline)
  --start <YYYY-MM-DD>    Cost Explorer window start (default 30 days ago)
  --end <YYYY-MM-DD>      Cost Explorer window end (default today)
  --out <path>            Write the JSON report to this path instead of stdout
  -h, --help              Show this message
`;
}

export interface AwsJsonRunner {
  run(args: readonly string[]): unknown;
}

export function createAwsCliRunner(options: Pick<CliOptions, "profile" | "region">): AwsJsonRunner {
  return {
    run(args: readonly string[]): unknown {
      const result = spawnSync("aws", [...args, "--profile", options.profile, "--region", options.region, "--output", "json"], {
        encoding: "utf8",
      });
      if (result.error !== undefined) throw result.error;
      if (result.status !== 0) {
        throw new Error((result.stderr || result.stdout || "AWS CLI command failed.").trim());
      }
      return parseAwsJson(result.stdout, `aws ${args.join(" ")}`);
    },
  };
}

function requireVpcId(value: unknown): string {
  if (typeof value === "string") return asString(value, "VPC id");
  throw new Error("Could not resolve a VPC id from the Vpc stack. Confirm the stack prefix and AWS profile.");
}

/** Collect the complete read-only evidence report through an injected AWS CLI runner. */
export function collectBaseline(runner: AwsJsonRunner, options: CliOptions): VpcEndpointBaselineReport {
  const vpcId = requireVpcId(runner.run([
    "cloudformation", "list-stack-resources",
    "--stack-name", `${options.stackPrefix}-Vpc`,
    "--query", "StackResourceSummaries[?ResourceType=='AWS::EC2::VPC'].PhysicalResourceId | [0]",
  ]));

  const endpoints = normalizeEndpoints(runner.run([
    "ec2", "describe-vpc-endpoints",
    "--filters", `Name=vpc-id,Values=${vpcId}`,
    "--query", "VpcEndpoints[].{Service:ServiceName,State:State,PrivateDns:PrivateDnsEnabled,Subnets:SubnetIds,RouteTables:RouteTableIds}",
  ]));
  const natGateways = normalizeNatGateways(runner.run([
    "ec2", "describe-nat-gateways",
    "--filter", `Name=vpc-id,Values=${vpcId}`,
    "--query", "NatGateways[].{Id:NatGatewayId,State:State,Subnet:SubnetId,Created:CreateTime}",
  ]));
  const flowLogs = normalizeFlowLogs(runner.run([
    "ec2", "describe-flow-logs",
    "--filter", `Name=resource-id,Values=${vpcId}`,
    "--query", "FlowLogs[].{Id:FlowLogId,Traffic:TrafficType,LogGroup:LogGroupName,Status:DeliverLogsStatus}",
  ]));
  const cloudTrails = runner.run([
    "cloudtrail", "describe-trails",
    "--query", "trailList[].{Name:Name,HomeRegion:HomeRegion,LogGroup:CloudWatchLogsLogGroupArn,MultiRegion:IsMultiRegionTrail}",
  ]);

  let costExplorer: unknown | CollectionFailure;
  try {
    costExplorer = runner.run([
      "ce", "get-cost-and-usage",
      "--time-period", `Start=${options.start},End=${options.end}`,
      "--granularity", "MONTHLY",
      "--metrics", "UnblendedCost", "UsageQuantity",
      "--group-by", "Type=DIMENSION,Key=SERVICE", "Type=DIMENSION,Key=USAGE_TYPE",
    ]);
  } catch (error) {
    costExplorer = {
      status: "unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    collectedAt: new Date().toISOString(),
    stackPrefix: options.stackPrefix,
    region: options.region,
    phase: options.phase,
    costWindow: { start: options.start, end: options.end },
    vpcId,
    endpoints,
    natGateways,
    flowLogs,
    cloudTrails,
    costExplorer,
  };
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  const options = parseArgs(argv);
  const report = collectBaseline(createAwsCliRunner(options), options);
  const validation = validateBaseline(report);
  const output = JSON.stringify({ report, validation }, null, 2);

  if (options.outPath !== undefined) {
    mkdirSync(dirname(options.outPath), { recursive: true });
    writeFileSync(options.outPath, `${output}\n`, "utf8");
  } else {
    process.stdout.write(`${output}\n`);
  }
  if (validation.errors.length > 0) {
    process.exitCode = 2;
  }
}

if (process.argv[1]?.includes("vpcEndpointBaseline.")) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
