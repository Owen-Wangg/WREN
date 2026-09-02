import path from "node:path";
import { AwsCli } from "./awsCli.js";
import {
  assertCheckpointMatches,
  CheckpointStore,
  newCheckpoint,
  updateStage,
  type DeploymentCheckpoint,
} from "./checkpoint.js";
import type { DeploymentConfig } from "./config.js";
import { DeploymentDiscovery, type ResourceSummary, type StackSummary } from "./discovery.js";
import { ActionRequiredError } from "./errors.js";
import { SAFE_UNDEPLOY_ORDER } from "./plan.js";
import { cdkContextArgs } from "./deployWorkflow.js";
import { runCommand, type CommandResult, type CommandSpec } from "./runner.js";

interface Runner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

interface PipelineExecutionsResponse {
  readonly pipelineExecutionSummaries?: readonly {
    readonly pipelineExecutionId?: string;
    readonly status?: string;
  }[];
}

export interface InventoryEntry {
  readonly concern: string;
  readonly region: string;
  readonly stack: StackSummary;
  readonly resources: readonly ResourceSummary[];
}

export interface RetainedManifest {
  readonly stacks: readonly {
    readonly stackName: string;
    readonly region: string;
    readonly status: string;
  }[];
  readonly resources: readonly {
    readonly stackName: string;
    readonly region: string;
    readonly type: string;
    readonly logicalId: string;
    readonly physicalId?: string;
  }[];
  readonly guarantees: readonly string[];
}

const APPLICATION_CONCERNS = [
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
  "CloudFrontWaf",
] as const;

const RETAINED_CONCERNS = new Set(["Cicd", "Config", "Vpc", "Storage", "Cognito", "Database", "CDKToolkit"]);
const RETAINED_RESOURCE_TYPES = new Set([
  "AWS::RDS::DBInstance",
  "AWS::RDS::DBCluster",
  "AWS::S3::Bucket",
  "AWS::DynamoDB::Table",
  "AWS::KMS::Key",
  "AWS::ECR::Repository",
  "AWS::SecretsManager::Secret",
  "AWS::Logs::LogGroup",
  "Custom::LogRetention",
]);

export function requiredUndeployConfirmation(
  accountId: string,
  config: Pick<DeploymentConfig, "region" | "stackPrefix">,
): string {
  return `${accountId}/${config.region}/${config.stackPrefix}`;
}

export function buildRetainedManifest(inventory: readonly InventoryEntry[]): RetainedManifest {
  const stacks = inventory
    .filter((entry) => entry.stack.disposition !== "absent" && RETAINED_CONCERNS.has(entry.concern))
    .map((entry) => ({
      stackName: entry.stack.stackName,
      region: entry.region,
      status: entry.stack.status ?? "UNKNOWN",
    }));
  const resources = inventory.flatMap((entry) => entry.resources
    .filter((resource) => RETAINED_RESOURCE_TYPES.has(resource.type))
    .map((resource) => ({
      stackName: entry.stack.stackName,
      region: entry.region,
      type: resource.type,
      logicalId: resource.logicalId,
      ...(resource.physicalId ? { physicalId: resource.physicalId } : {}),
    })));

  return {
    stacks,
    resources,
    guarantees: [
      "Database, Cognito, Storage, Vpc, Config, Cicd prerequisites, and CDK bootstrap stacks are not destroyed.",
      "RDS deletion protection is never disabled.",
      "Retained S3, DynamoDB, KMS, ECR, Secrets Manager, and CloudWatch Logs resources are never explicitly deleted.",
      "A full data purge remains a separate manual operation.",
    ],
  };
}

export class UndeployWorkflow {
  private readonly aws: AwsCli;
  private readonly discovery: DeploymentDiscovery;
  private checkpoint!: DeploymentCheckpoint;
  private store!: CheckpointStore;
  private inventory: readonly InventoryEntry[] = [];

  public constructor(
    private readonly config: DeploymentConfig,
    private readonly repoRoot: string,
    private readonly runner: Runner = { run: runCommand },
  ) {
    this.aws = new AwsCli(config.region, process.env.AWS_PROFILE, runner);
    this.discovery = new DeploymentDiscovery(this.aws, config);
  }

  public async run(): Promise<void> {
    const identity = await this.discovery.identity();
    if (this.config.expectedAccountId && identity.Account !== this.config.expectedAccountId) {
      throw new Error(
        `AWS identity account ${identity.Account} does not match WREN_EXPECTED_ACCOUNT_ID ${this.config.expectedAccountId}.`,
      );
    }

    if (this.config.dryRun) {
      this.inventory = await this.discoverInventory();
      this.printInventory(true);
      return;
    }

    const requiredConfirmation = requiredUndeployConfirmation(identity.Account, this.config);
    if (this.config.undeployConfirm !== requiredConfirmation) {
      throw new ActionRequiredError(
        `Protected teardown requires WREN_UNDEPLOY_CONFIRM=${requiredConfirmation}. No resources were changed.`,
      );
    }

    this.store = new CheckpointStore(
      this.repoRoot,
      "undeploy",
      identity.Account,
      this.config.region,
      this.config.stackPrefix,
    );
    this.store.acquireLock();
    try {
      console.log("[wren] inventory...");
      this.inventory = await this.discoverInventory();
      this.validateInventory();
      this.printInventory(false);

      const existing = this.store.load();
      if (existing) {
        assertCheckpointMatches(existing, "undeploy", this.config, identity.Account);
        this.checkpoint = existing;
      } else {
        this.checkpoint = newCheckpoint("undeploy", this.config, identity.Account);
      }
      this.checkpoint = updateStage(this.checkpoint, "inventory", "complete");
      this.store.save(this.checkpoint);

      await this.stage("pipeline-disabled", () => this.disablePipeline());
      for (const concern of SAFE_UNDEPLOY_ORDER) {
        await this.stage(`destroy-${concern}`, () => this.destroyConcern(concern));
      }

      console.log(`[wren] Protected teardown complete for ${this.config.stackPrefix}.`);
      console.log(`[wren] Retained manifest:\n${JSON.stringify(buildRetainedManifest(this.inventory), null, 2)}`);
    } finally {
      this.store.releaseLock();
    }
  }

  private async stage(name: string, action: () => Promise<void>): Promise<void> {
    try {
      console.log(`[wren] ${name}...`);
      await action();
      this.checkpoint = updateStage(this.checkpoint, name, "complete");
      this.store.save(this.checkpoint);
    } catch (error) {
      this.checkpoint = updateStage(
        this.checkpoint,
        name,
        error instanceof ActionRequiredError ? "action-required" : "failed",
        error instanceof Error ? error.message : String(error),
      );
      this.store.save(this.checkpoint);
      throw error;
    }
  }

  private async discoverInventory(): Promise<readonly InventoryEntry[]> {
    const application = await Promise.all(APPLICATION_CONCERNS.map(async (concern): Promise<InventoryEntry> => {
      const region = concern === "CloudFrontWaf" ? "us-east-1" : this.config.region;
      const stack = await this.discovery.stack(`${this.config.stackPrefix}-${concern}`, region);
      const resources = stack.disposition === "absent"
        ? []
        : await this.discovery.stackResources(stack.stackName, region);
      return { concern, region, stack, resources };
    }));
    const bootstrapRegions = [...new Set([this.config.region, "us-east-1"])];
    const bootstrap = await Promise.all(bootstrapRegions.map(async (region): Promise<InventoryEntry> => {
      const stack = await this.discovery.stack("CDKToolkit", region);
      const resources = stack.disposition === "absent"
        ? []
        : await this.discovery.stackResources(stack.stackName, region);
      return { concern: "CDKToolkit", region, stack, resources };
    }));
    return [...application, ...bootstrap];
  }

  private validateInventory(): void {
    const hasPipeline = this.hasExistingPipeline();
    const unsafe = this.inventory.find((entry) => {
      const protectedConcern = entry.concern === "Cicd" ||
        SAFE_UNDEPLOY_ORDER.includes(entry.concern as (typeof SAFE_UNDEPLOY_ORDER)[number]);
      if (!protectedConcern) return false;
      if (entry.stack.disposition !== "in-progress" && entry.stack.disposition !== "blocked") return false;
      // An actually discovered pipeline is the only safe reason to admit an
      // in-progress Compute stack: quiescePipeline will stop work and wait for
      // a successful terminal state before any pipeline removal or destroy.
      return !(entry.concern === "Compute" && entry.stack.disposition === "in-progress" && hasPipeline);
    });
    if (unsafe) {
      throw new ActionRequiredError(
        `${unsafe.stack.stackName} is ${unsafe.stack.status ?? unsafe.stack.disposition}` +
        `${unsafe.stack.statusReason ? `: ${unsafe.stack.statusReason}` : ""}. Resolve it before rerunning.`,
      );
    }

    const amplify = this.entry("Amplify");
    if (amplify?.stack.disposition !== "absent" && (!this.config.githubOwner || !this.config.githubRepo)) {
      throw new ActionRequiredError(
        "The Amplify stack exists. Set WREN_GITHUB_OWNER and WREN_GITHUB_REPO so CDK can synthesize it for protected teardown.",
      );
    }

    const cicd = this.entry("Cicd");
    if (!cicd || cicd.stack.disposition === "absent") return;
    const stackOwnsRepository = cicd.resources.some((resource) => resource.type === "AWS::ECR::Repository");
    if (stackOwnsRepository && this.config.ecrOwnership !== "managed") {
      throw new ActionRequiredError(
        "The Cicd stack owns the ECR repository. Set WREN_ECR_OWNERSHIP=managed so pipeline removal preserves that ownership.",
      );
    }
    if (!stackOwnsRepository && this.config.ecrOwnership !== "external") {
      throw new ActionRequiredError(
        "The Cicd stack does not own the ECR repository. Set WREN_ECR_OWNERSHIP=external before pipeline removal.",
      );
    }
  }

  private hasExistingPipeline(): boolean {
    const cicd = this.entry("Cicd");
    return cicd?.stack.disposition !== "absent" &&
      cicd?.resources.some((resource) => resource.type === "AWS::CodePipeline::Pipeline") === true;
  }

  private async disablePipeline(): Promise<void> {
    const cicd = this.entry("Cicd");
    if (!cicd || cicd.stack.disposition === "absent" || !this.hasExistingPipeline()) return;

    await this.quiescePipeline(`${this.config.stackPrefix}-pipeline`);
    await this.cdk([
      "deploy",
      cicd.stack.stackName,
      ...cdkContextArgs(this.config, this.config.engineImageTag ?? "bootstrap", false),
      "--require-approval", "never",
    ]);
    const remaining = await this.discovery.stackResources(cicd.stack.stackName);
    if (remaining.some((resource) => resource.type === "AWS::CodePipeline::Pipeline")) {
      throw new Error(`Pipeline removal verification failed for ${cicd.stack.stackName}.`);
    }
  }

  private async quiescePipeline(pipelineName: string): Promise<void> {
    // Block new work from progressing beyond Source before draining existing
    // executions. Removing the pipeline alone does not stop active actions.
    for (const stageName of ["Build", "Deploy", "UpdateLambda"]) {
      await this.aws.command([
        "codepipeline", "disable-stage-transition",
        "--pipeline-name", pipelineName,
        "--stage-name", stageName,
        "--transition-type", "Inbound",
        "--reason", "Protected WREN teardown",
      ]);
    }

    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const executions = await this.aws.json<PipelineExecutionsResponse>([
        "codepipeline", "list-pipeline-executions", "--pipeline-name", pipelineName, "--max-results", "100",
      ]);
      const active = (executions.pipelineExecutionSummaries ?? []).filter(
        (execution) => execution.status === "InProgress" || execution.status === "Stopping",
      );
      for (const execution of active) {
        if (execution.status === "InProgress" && execution.pipelineExecutionId) {
          await this.aws.command([
            "codepipeline", "stop-pipeline-execution",
            "--pipeline-name", pipelineName,
            "--pipeline-execution-id", execution.pipelineExecutionId,
            "--no-abandon",
            "--reason", "Protected WREN teardown",
          ]);
        }
      }
      if (active.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }

    const executions = await this.aws.json<PipelineExecutionsResponse>([
      "codepipeline", "list-pipeline-executions", "--pipeline-name", pipelineName, "--max-results", "100",
    ]);
    if ((executions.pipelineExecutionSummaries ?? []).some(
      (execution) => execution.status === "InProgress" || execution.status === "Stopping",
    )) {
      throw new ActionRequiredError(`Timed out waiting for ${pipelineName} executions to stop.`);
    }

    const computeName = `${this.config.stackPrefix}-Compute`;
    while (Date.now() < deadline) {
      const compute = await this.discovery.stack(computeName);
      if (compute.disposition === "complete" || compute.disposition === "absent") return;
      if (compute.disposition !== "in-progress") {
        throw new ActionRequiredError(
          `${computeName} settled in ${compute.status ?? compute.disposition}; resolve it before teardown.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    throw new ActionRequiredError(`Timed out waiting for ${computeName} to settle after stopping the pipeline.`);
  }

  private async destroyConcern(concern: (typeof SAFE_UNDEPLOY_ORDER)[number]): Promise<void> {
    const original = this.entry(concern);
    if (!original || original.stack.disposition === "absent") return;
    const region = concern === "CloudFrontWaf" ? "us-east-1" : this.config.region;
    await this.cdk([
      "destroy",
      original.stack.stackName,
      ...cdkContextArgs(this.config, this.config.engineImageTag ?? "bootstrap", false),
      "--force",
    ]);
    const remaining = await this.discovery.stack(original.stack.stackName, region);
    if (remaining.disposition !== "absent") {
      throw new Error(
        `${original.stack.stackName} still has status ${remaining.status ?? remaining.disposition} after CDK destroy.`,
      );
    }
  }

  private entry(concern: string): InventoryEntry | undefined {
    return this.inventory.find((entry) => entry.concern === concern);
  }

  private printInventory(dryRun: boolean): void {
    if (dryRun) console.log("[wren] DRY RUN: discovery only; no confirmation is required and no resources will be changed.");
    for (const entry of this.inventory) {
      console.log(
        `[wren] ${entry.stack.stackName} (${entry.region}): ${entry.stack.status ?? "ABSENT"} ` +
        `(${entry.stack.disposition})`,
      );
    }
    console.log(`[wren] Retained manifest:\n${JSON.stringify(buildRetainedManifest(this.inventory), null, 2)}`);
    if (dryRun) console.log(`[wren] Safe destroy order: ${SAFE_UNDEPLOY_ORDER.join(" -> ")}`);
  }

  private async cdk(args: readonly string[]): Promise<void> {
    await this.runner.run({
      executable: process.execPath,
      args: [this.cdkCliPath(), ...args],
      cwd: path.join(this.repoRoot, "cdk"),
      streamOutput: true,
      timeoutMs: 2 * 60 * 60 * 1000,
    });
  }

  private cdkCliPath(): string {
    return path.join(this.repoRoot, "cdk", "node_modules", "aws-cdk", "bin", "cdk");
  }
}
