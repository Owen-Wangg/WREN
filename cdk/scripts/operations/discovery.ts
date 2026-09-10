import type { DeploymentConfig } from "./config.js";
import type { AwsCli, AwsIdentity } from "./awsCli.js";

export type StackDisposition = "absent" | "complete" | "in-progress" | "retryable" | "blocked";

export interface StackSummary {
  readonly stackName: string;
  readonly status?: string;
  readonly disposition: StackDisposition;
  readonly statusReason?: string;
  readonly outputs: Readonly<Record<string, string>>;
}

interface StackDescription {
  readonly StackName?: string;
  readonly StackStatus?: string;
  readonly StackStatusReason?: string;
  readonly Outputs?: readonly { readonly OutputKey?: string; readonly OutputValue?: string }[];
}

interface DescribeStacksResponse {
  readonly Stacks?: readonly StackDescription[];
}

interface StackResourcesResponse {
  readonly StackResources?: readonly {
    readonly LogicalResourceId?: string;
    readonly PhysicalResourceId?: string;
    readonly ResourceType?: string;
    readonly ResourceStatus?: string;
  }[];
}

export interface ResourceSummary {
  readonly logicalId: string;
  readonly physicalId?: string;
  readonly type: string;
  readonly status?: string;
}

const COMPLETE = new Set(["CREATE_COMPLETE", "UPDATE_COMPLETE", "IMPORT_COMPLETE"]);
const RETRYABLE = new Set(["ROLLBACK_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"]);
const BLOCKED = new Set([
  "CREATE_FAILED",
  "DELETE_FAILED",
  "ROLLBACK_FAILED",
  "UPDATE_FAILED",
  "UPDATE_ROLLBACK_FAILED",
  "IMPORT_ROLLBACK_FAILED",
]);

export function classifyStackStatus(status: string | undefined): StackDisposition {
  if (status === undefined) return "absent";
  if (COMPLETE.has(status)) return "complete";
  if (RETRYABLE.has(status)) return "retryable";
  if (BLOCKED.has(status)) return "blocked";
  if (status.endsWith("_IN_PROGRESS") || status.endsWith("_CLEANUP_IN_PROGRESS")) return "in-progress";
  return "blocked";
}

function outputs(entries: StackDescription | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!entries || !("Outputs" in entries)) return result;
  for (const output of entries.Outputs ?? []) {
    if (output.OutputKey && output.OutputValue) result[output.OutputKey] = output.OutputValue;
  }
  return result;
}

export class DeploymentDiscovery {
  public constructor(
    private readonly aws: AwsCli,
    private readonly config: DeploymentConfig,
  ) {}

  public identity(): Promise<AwsIdentity> {
    return this.aws.identity();
  }

  public async stack(stackName: string, region = this.config.region): Promise<StackSummary> {
    const response = await this.aws.tryJson<DescribeStacksResponse>(
      ["cloudformation", "describe-stacks", "--stack-name", stackName],
      region,
    );
    const stack = response?.Stacks?.[0];
    const status = stack?.StackStatus;
    return {
      stackName,
      ...(status ? { status } : {}),
      disposition: classifyStackStatus(status),
      ...(stack?.StackStatusReason ? { statusReason: stack.StackStatusReason } : {}),
      outputs: outputs(stack),
    };
  }

  public async stackResources(stackName: string, region = this.config.region): Promise<readonly ResourceSummary[]> {
    const response = await this.aws.tryJson<StackResourcesResponse>(
      ["cloudformation", "describe-stack-resources", "--stack-name", stackName],
      region,
    );
    return (response?.StackResources ?? [])
      .filter((resource) => resource.LogicalResourceId && resource.ResourceType)
      .map((resource) => ({
        logicalId: resource.LogicalResourceId!,
        ...(resource.PhysicalResourceId ? { physicalId: resource.PhysicalResourceId } : {}),
        type: resource.ResourceType!,
        ...(resource.ResourceStatus ? { status: resource.ResourceStatus } : {}),
      }));
  }

  public async allApplicationStacks(): Promise<readonly StackSummary[]> {
    const concerns = [
      "Cicd",
      "Config",
      "Vpc",
      "Storage",
      "Cognito",
      "Database",
      "Compute",
      "Api",
      "Observability",
      "Amplify",
    ];
    const regional = await Promise.all(concerns.map((concern) => this.stack(`${this.config.stackPrefix}-${concern}`)));
    const cloudFront = await this.stack(`${this.config.stackPrefix}-CloudFrontWaf`, "us-east-1");
    return [...regional, cloudFront];
  }
}
