import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDeploymentConfig, type DeploymentConfig } from "../scripts/operations/config.js";
import { ActionRequiredError } from "../scripts/operations/errors.js";
import type { CommandResult, CommandSpec } from "../scripts/operations/runner.js";
import {
  buildRetainedManifest,
  requiredUndeployConfirmation,
  UndeployWorkflow,
  type InventoryEntry,
} from "../scripts/operations/undeployWorkflow.js";

const ACCOUNT_ID = "123456789012";

function result(stdout = ""): CommandResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

class RecordingRunner {
  public readonly calls: CommandSpec[] = [];
  public readonly present = new Set<string>();
  public readonly stackStatuses = new Map<string, string[]>();
  public pipelinePresent = false;

  public async run(spec: CommandSpec): Promise<CommandResult> {
    this.calls.push(spec);
    const args = [...(spec.args ?? [])];
    if (spec.executable === "aws") {
      if (args[0] === "sts" && args[1] === "get-caller-identity") {
        return result(JSON.stringify({ Account: ACCOUNT_ID, Arn: `arn:aws:iam::${ACCOUNT_ID}:user/test`, UserId: "test" }));
      }
      if (args[0] === "cloudformation" && args[1] === "describe-stacks") {
        const stackName = args[args.indexOf("--stack-name") + 1]!;
        const statuses = this.stackStatuses.get(stackName);
        const stackStatus = statuses && statuses.length > 0
          ? statuses.shift()!
          : "UPDATE_COMPLETE";
        return result(JSON.stringify({
          Stacks: this.present.has(stackName)
            ? [{ StackName: stackName, StackStatus: stackStatus }]
            : [],
        }));
      }
      if (args[0] === "cloudformation" && args[1] === "describe-stack-resources") {
        const stackName = args[args.indexOf("--stack-name") + 1]!;
        return result(JSON.stringify({ StackResources: this.resourcesFor(stackName) }));
      }
      if (args[0] === "codepipeline" && args[1] === "disable-stage-transition") return result();
      if (args[0] === "codepipeline" && args[1] === "list-pipeline-executions") {
        return result(JSON.stringify({ pipelineExecutionSummaries: [] }));
      }
      throw new Error(`Unexpected AWS call: ${args.join(" ")}`);
    }

    const operationIndex = args.findIndex((arg) => arg === "deploy" || arg === "destroy");
    if (operationIndex < 0) throw new Error(`Unexpected command: ${spec.executable} ${args.join(" ")}`);
    const operation = args[operationIndex]!;
    const stackName = args[operationIndex + 1]!;
    if (operation === "deploy") {
      expect(stackName).toMatch(/-Cicd$/);
      this.pipelinePresent = false;
    } else {
      this.present.delete(stackName);
    }
    return result();
  }

  private resourcesFor(stackName: string): readonly Record<string, string>[] {
    if (stackName.endsWith("-Cicd")) {
      return [
        {
          LogicalResourceId: "FeedbackEngineRepo",
          PhysicalResourceId: "feedback-engine",
          ResourceType: "AWS::ECR::Repository",
          ResourceStatus: "CREATE_COMPLETE",
        },
        ...(this.pipelinePresent ? [{
          LogicalResourceId: "Pipeline",
          PhysicalResourceId: "pipeline",
          ResourceType: "AWS::CodePipeline::Pipeline",
          ResourceStatus: "CREATE_COMPLETE",
        }] : []),
      ];
    }
    if (stackName.endsWith("-Database")) {
      return [{
        LogicalResourceId: "Database",
        PhysicalResourceId: "database-1",
        ResourceType: "AWS::RDS::DBInstance",
        ResourceStatus: "CREATE_COMPLETE",
      }];
    }
    if (stackName.endsWith("-Observability")) {
      return [{
        LogicalResourceId: "LogRetention",
        PhysicalResourceId: "log-retention",
        ResourceType: "Custom::LogRetention",
        ResourceStatus: "CREATE_COMPLETE",
      }];
    }
    return [];
  }
}

function config(overrides: NodeJS.ProcessEnv = {}): DeploymentConfig {
  return parseDeploymentConfig({
    WREN_GITHUB_OWNER: "owner",
    WREN_GITHUB_REPO: "repo",
    WREN_ECR_OWNERSHIP: "managed",
    ...overrides,
  }, "undeploy");
}

describe("protected undeploy workflow", () => {
  let root: string;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "wren-undeploy-test-"));
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it("requires the exact account, region, and prefix confirmation before discovery or mutation", async () => {
    const runner = new RecordingRunner();
    await expect(new UndeployWorkflow(config({ WREN_UNDEPLOY_CONFIRM: "wrong" }), root, runner).run())
      .rejects.toBeInstanceOf(ActionRequiredError);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args).toContain("get-caller-identity");
  });

  it("performs discovery only in dry-run mode without confirmation", async () => {
    const runner = new RecordingRunner();
    await new UndeployWorkflow(config({ WREN_DRY_RUN: "true" }), root, runner).run();

    expect(runner.calls.length).toBeGreaterThan(1);
    expect(runner.calls.every((call) => call.executable === "aws")).toBe(true);
    expect(runner.calls.every((call) => {
      const args = call.args ?? [];
      return args.includes("get-caller-identity") ||
        args.includes("describe-stacks") ||
        args.includes("describe-stack-resources");
    })).toBe(true);
  });

  it("disables the pipeline before destroying only the safe stacks in order", async () => {
    const base = config();
    const runner = new RecordingRunner();
    runner.pipelinePresent = true;
    for (const concern of ["Cicd", "Database", "Amplify", "CloudFrontWaf", "Observability", "Api", "Compute"]) {
      runner.present.add(`${base.stackPrefix}-${concern}`);
    }
    runner.stackStatuses.set(
      `${base.stackPrefix}-Compute`,
      ["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE"],
    );
    const confirmed = config({
      WREN_UNDEPLOY_CONFIRM: requiredUndeployConfirmation(ACCOUNT_ID, base),
    });

    await new UndeployWorkflow(confirmed, root, runner).run();

    const cdkCalls = runner.calls.filter((call) => call.executable !== "aws");
    expect(cdkCalls.map((call) => {
      const args = call.args ?? [];
      const operationIndex = args.findIndex((arg) => arg === "deploy" || arg === "destroy");
      return `${args[operationIndex]}:${args[operationIndex + 1]}`;
    })).toEqual([
      `deploy:${base.stackPrefix}-Cicd`,
      `destroy:${base.stackPrefix}-Amplify`,
      `destroy:${base.stackPrefix}-CloudFrontWaf`,
      `destroy:${base.stackPrefix}-Observability`,
      `destroy:${base.stackPrefix}-Api`,
      `destroy:${base.stackPrefix}-Compute`,
    ]);

    const pipelineCalls = runner.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.args?.[0] === "codepipeline");
    expect(pipelineCalls
      .filter(({ call }) => call.args?.[1] === "disable-stage-transition")
      .map(({ call }) => call.args?.[(call.args?.indexOf("--stage-name") ?? -1) + 1]))
      .toEqual(["Build", "Deploy", "UpdateLambda"]);
    expect(pipelineCalls.filter(({ call }) => call.args?.[1] === "list-pipeline-executions"))
      .toHaveLength(2);
    const firstCdkCallIndex = runner.calls.findIndex((call) => call.executable !== "aws");
    expect(Math.max(...pipelineCalls.map(({ index }) => index))).toBeLessThan(firstCdkCallIndex);

    expect(runner.present).toContain(`${base.stackPrefix}-Database`);
    expect(runner.present).toContain(`${base.stackPrefix}-Cicd`);
  });

  it("rejects an in-progress Compute stack when no pipeline can be drained", async () => {
    const base = config();
    const runner = new RecordingRunner();
    runner.present.add(`${base.stackPrefix}-Compute`);
    runner.stackStatuses.set(`${base.stackPrefix}-Compute`, ["UPDATE_IN_PROGRESS"]);
    const confirmed = config({
      WREN_UNDEPLOY_CONFIRM: requiredUndeployConfirmation(ACCOUNT_ID, base),
    });

    await expect(new UndeployWorkflow(confirmed, root, runner).run())
      .rejects.toBeInstanceOf(ActionRequiredError);
    expect(runner.calls.some((call) => call.args?.[0] === "codepipeline")).toBe(false);
    expect(runner.calls.some((call) => call.executable !== "aws")).toBe(false);
  });

  it("rejects a pipeline-owned Compute update that settles retryable", async () => {
    const base = config();
    const runner = new RecordingRunner();
    runner.pipelinePresent = true;
    runner.present.add(`${base.stackPrefix}-Cicd`);
    runner.present.add(`${base.stackPrefix}-Compute`);
    runner.stackStatuses.set(
      `${base.stackPrefix}-Compute`,
      ["UPDATE_IN_PROGRESS", "UPDATE_ROLLBACK_COMPLETE"],
    );
    const confirmed = config({
      WREN_UNDEPLOY_CONFIRM: requiredUndeployConfirmation(ACCOUNT_ID, base),
    });

    await expect(new UndeployWorkflow(confirmed, root, runner).run())
      .rejects.toThrow("settled in UPDATE_ROLLBACK_COMPLETE");
    expect(runner.calls.filter((call) => call.args?.[1] === "disable-stage-transition"))
      .toHaveLength(3);
    expect(runner.calls.some((call) => call.executable !== "aws")).toBe(false);
  });

  it("reports retained stacks and protected resource classes", () => {
    const inventory: InventoryEntry[] = [{
      concern: "Database",
      region: "ca-central-1",
      stack: {
        stackName: "wren-dev-Database",
        status: "UPDATE_COMPLETE",
        disposition: "complete",
        outputs: {},
      },
      resources: [{
        logicalId: "Database",
        physicalId: "database-1",
        type: "AWS::RDS::DBInstance",
        status: "CREATE_COMPLETE",
      }],
    }];
    const manifest = buildRetainedManifest(inventory);
    expect(manifest.stacks).toEqual([expect.objectContaining({ stackName: "wren-dev-Database" })]);
    expect(manifest.resources).toEqual([expect.objectContaining({ type: "AWS::RDS::DBInstance" })]);
    expect(manifest.guarantees.join(" ")).toContain("never disabled");
  });
});
