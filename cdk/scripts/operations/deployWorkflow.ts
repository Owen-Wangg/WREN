import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AwsCli } from "./awsCli.js";
import { assertAdminProbeSafe } from "./adminState.js";
import {
  assertCheckpointMatches,
  CheckpointStore,
  newCheckpoint,
  updateStage,
  withImage,
  type DeploymentCheckpoint,
} from "./checkpoint.js";
import type { DeploymentConfig } from "./config.js";
import { DeploymentDiscovery } from "./discovery.js";
import { ActionRequiredError } from "./errors.js";
import { DEPLOY_STAGES } from "./plan.js";
import { runCommand, type CommandResult, type CommandSpec } from "./runner.js";

interface Runner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

interface InferenceProfilesResponse {
  readonly inferenceProfileSummaries?: readonly { readonly inferenceProfileId?: string }[];
}

interface RepositoriesResponse {
  readonly repositories?: readonly { readonly repositoryName?: string; readonly repositoryUri?: string }[];
}

interface ImagesResponse {
  readonly imageDetails?: readonly { readonly imageDigest?: string; readonly imageTags?: readonly string[] }[];
}

interface AmplifyJobsResponse {
  readonly jobSummaries?: readonly { readonly status?: string; readonly jobId?: string }[];
}

interface ParameterResponse {
  readonly Parameter?: { readonly Value?: string };
}

interface CognitoUsersResponse {
  readonly Users?: readonly {
    readonly Username?: string;
    readonly UserStatus?: string;
    readonly Attributes?: readonly { readonly Name?: string; readonly Value?: string }[];
  }[];
}

interface CognitoGroupsResponse {
  readonly Groups?: readonly { readonly GroupName?: string }[];
}

interface LambdaConfiguration {
  readonly State?: string;
  readonly Environment?: { readonly Variables?: Readonly<Record<string, string>> };
}

interface AuthMeResponse {
  readonly roles?: readonly string[];
  readonly email?: string;
}

interface PipelineStateResponse {
  readonly stageStates?: readonly { readonly stageName?: string }[];
}

const EXPECTED_PIPELINE_STAGES = ["Source", "Build", "Deploy", "UpdateLambda"] as const;

export function assertPipelineStages(state: PipelineStateResponse): void {
  const actualStages = (state.stageStates ?? []).map((stage) => stage.stageName).filter(
    (stageName): stageName is string => stageName !== undefined,
  );
  if (actualStages.length !== EXPECTED_PIPELINE_STAGES.length ||
      EXPECTED_PIPELINE_STAGES.some((stageName, index) => actualStages[index] !== stageName)) {
    throw new Error(
      `Pipeline stage verification failed. Expected ${EXPECTED_PIPELINE_STAGES.join(" -> ")}; ` +
      `found ${actualStages.join(" -> ") || "none"}.`,
    );
  }
}

export function hasLambdaPullPolicy(policyText: string | undefined): boolean {
  if (!policyText) return false;
  try {
    const policy = JSON.parse(policyText) as {
      readonly Statement?: readonly {
        readonly Effect?: string;
        readonly Principal?: { readonly Service?: string | readonly string[] } | string;
        readonly Action?: string | readonly string[];
      }[];
    };
    const required = new Set([
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:BatchCheckLayerAvailability",
    ]);
    return (policy.Statement ?? []).some((statement) => {
      const service = typeof statement.Principal === "object" ? statement.Principal.Service : undefined;
      const services = Array.isArray(service) ? service : service ? [service] : [];
      const actions = Array.isArray(statement.Action) ? statement.Action : statement.Action ? [statement.Action] : [];
      return statement.Effect === "Allow" && services.includes("lambda.amazonaws.com") &&
        [...required].every((action) => actions.includes(action));
    });
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runWithRequiredCleanup<T>(
  action: () => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let actionSucceeded = false;
  let result: T | undefined;
  let actionError: unknown;
  try {
    result = await action();
    actionSucceeded = true;
  } catch (error) {
    actionError = error;
  }

  try {
    await cleanup();
  } catch (cleanupError) {
    const original = actionSucceeded
      ? ""
      : ` Original administrator failure: ${errorMessage(actionError)}.`;
    throw new ActionRequiredError(
      "SECURITY ACTION REQUIRED: the TechnicalAdmin bootstrap may still be armed. " +
      `Cleanup verification failed: ${errorMessage(cleanupError)}.${original}`,
    );
  }

  if (!actionSucceeded) throw actionError;
  return result as T;
}

interface HeaderReader {
  get(name: string): string | null;
}

function headerTokens(value: string | null, normalize: (token: string) => string): ReadonlySet<string> {
  return new Set((value ?? "").split(",").map((token) => normalize(token.trim())).filter(Boolean));
}

export function assertCorsPreflight(
  headers: HeaderReader,
  requestedOrigin: string,
  requestedMethod: string,
  requestedHeaders: readonly string[],
): void {
  const allowOrigin = headers.get("access-control-allow-origin");
  if (allowOrigin !== requestedOrigin) {
    throw new Error(
      `API preflight allowed origin ${allowOrigin ?? "none"}; expected exactly ${requestedOrigin}.`,
    );
  }

  const methods = headerTokens(headers.get("access-control-allow-methods"), (token) => token.toUpperCase());
  if (!methods.has(requestedMethod.toUpperCase())) {
    throw new Error(`API preflight did not allow method ${requestedMethod}.`);
  }

  const allowedHeaders = headerTokens(
    headers.get("access-control-allow-headers"),
    (token) => token.toLowerCase(),
  );
  const missing = requestedHeaders
    .map((header) => header.toLowerCase())
    .filter((header) => !allowedHeaders.has(header));
  if (missing.length > 0) {
    throw new Error(`API preflight did not allow requested header(s): ${missing.join(", ")}.`);
  }
}

const FOUNDATION_CONCERNS = ["Config", "Vpc", "Storage", "Cognito", "Database"] as const;
const APPLICATION_CONCERNS = ["Compute", "Api", "Observability", "CloudFrontWaf"] as const;

export function cdkContextArgs(
  config: DeploymentConfig,
  imageTag: string,
  enableCicd: boolean,
  technicalAdminBootstrapSubject?: string,
  auditPseudonymSaltOwnership: "managed" | "external" = "managed",
): readonly string[] {
  return [
    "-c", `appName=${config.appName}`,
    "-c", `projectName=${config.projectName}`,
    "-c", `environmentName=${config.environmentName}`,
    "-c", `stackPrefix=${config.stackPrefix}`,
    "-c", `region=${config.region}`,
    "-c", `bedrockModelId=${config.bedrockModelId}`,
    "-c", `feedbackEngineImageTag=${imageTag}`,
    "-c", `enableCicd=${enableCicd}`,
    "-c", `ecrOwnership=${config.ecrOwnership}`,
    "-c", `auditPseudonymSaltOwnership=${auditPseudonymSaltOwnership}`,
    ...(config.githubOwner ? ["-c", `githubOwner=${config.githubOwner}`] : []),
    ...(config.githubRepo ? ["-c", `githubRepo=${config.githubRepo}`] : []),
    "-c", `githubBranch=${config.githubBranch}`,
    ...(technicalAdminBootstrapSubject
      ? ["-c", `technicalAdminBootstrapSubject=${technicalAdminBootstrapSubject}`]
      : []),
  ];
}

export function classifyBedrockError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/AccessDenied|not authorized|permission/i.test(text)) {
    return "Bedrock invocation was denied. Enable the configured model/profile and verify IAM/SCP permissions, then rerun npm run deploy.";
  }
  if (/Throttl|TooManyRequests|quota/i.test(text)) {
    return "Bedrock invocation was throttled. Request or wait for quota capacity, then rerun npm run deploy.";
  }
  if (/ValidationException|not found|unsupported/i.test(text)) {
    return "The configured Bedrock inference profile is unavailable in this region. Correct WREN_BEDROCK_MODEL_ID or enable the model, then rerun.";
  }
  return `Bedrock verification failed: ${text}`;
}

export function sourceTag(checkpoint: DeploymentCheckpoint, configured?: string): string {
  if (configured) return configured;
  const timestamp = checkpoint.createdAt.replace(/[-:.TZ]/g, "");
  return `deploy-${timestamp}`;
}

export function isCompletedDeployCheckpoint(checkpoint: DeploymentCheckpoint): boolean {
  return DEPLOY_STAGES.every((stage) => checkpoint.stages[stage]?.state === "complete");
}

function secretFileUri(filePath: string): string {
  return `file://${filePath.replace(/\\/g, "/")}`;
}

export class DeployWorkflow {
  private readonly aws: AwsCli;
  private readonly discovery: DeploymentDiscovery;
  private checkpoint!: DeploymentCheckpoint;
  private store!: CheckpointStore;
  private accountId = "";
  private verifiedTechnicalAdmin = false;
  private auditPseudonymSaltOwnership: "managed" | "external" = "managed";

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
    this.accountId = identity.Account;
    if (this.config.expectedAccountId && identity.Account !== this.config.expectedAccountId) {
      throw new Error(`AWS identity account ${identity.Account} does not match WREN_EXPECTED_ACCOUNT_ID ${this.config.expectedAccountId}.`);
    }

    if (this.config.dryRun) {
      // Dry runs use only in-memory state: they neither contend for the mutation
      // lock nor create a checkpoint that can conflict with a real deployment.
      this.checkpoint = newCheckpoint("deploy", this.config, identity.Account);
      await this.runDryPlan(identity.Arn);
      return;
    }

    this.store = new CheckpointStore(
      this.repoRoot,
      "deploy",
      identity.Account,
      this.config.region,
      this.config.stackPrefix,
    );
    this.store.acquireLock();
    try {
      const existing = this.store.load();
      if (existing) {
        assertCheckpointMatches(existing, "deploy", this.config, identity.Account);
        const completed = isCompletedDeployCheckpoint(existing);
        if (completed) {
          // Recover from a crash after the final stage was saved but before the
          // successful checkpoint was retired. A new run needs a fresh image tag.
          this.store.retireCheckpoint();
          this.checkpoint = newCheckpoint("deploy", this.config, identity.Account);
          this.store.save(this.checkpoint);
        } else {
          this.checkpoint = existing;
        }
      } else {
        this.checkpoint = newCheckpoint("deploy", this.config, identity.Account);
        this.store.save(this.checkpoint);
      }

      await this.stage("preflight", () => this.preflight(identity.Arn));
      await this.stage("bedrock", () => this.verifyBedrock(true));
      await this.stage("bootstrap-data-region", () => this.ensureBootstrap(this.config.region));
      await this.stage("bootstrap-us-east-1", () => this.ensureBootstrap("us-east-1"));
      await this.stage("prerequisites", () => this.deployPrerequisites());
      await this.stage("feedback-image", () => this.publishFeedbackImage());
      await this.stage("foundations", () => this.deployConcerns(FOUNDATION_CONCERNS));
      await this.stage("application", () => this.deployConcerns(APPLICATION_CONCERNS));
      await this.stage("amplify", () => this.deployAmplify());
      await this.stage("administrator", () => this.configureAdministrator());
      await this.stage("smoke", () => this.runSmokeTests());
      await this.stage("pipeline", () => this.deployPipeline());
      this.store.retireCheckpoint();
      console.log(`[wren] Deployment complete for ${this.config.stackPrefix}.`);
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
      const state = error instanceof ActionRequiredError ? "action-required" : "failed";
      this.checkpoint = updateStage(
        this.checkpoint,
        name,
        state,
        error instanceof Error ? error.message : String(error),
      );
      this.store.save(this.checkpoint);
      throw error;
    }
  }

  private async runDryPlan(identityArn: string): Promise<void> {
    console.log(`[wren] DRY RUN identity: ${identityArn}`);
    await this.preflight(identityArn, true);
    await this.verifyBedrock(false);
    const stacks = await this.discovery.allApplicationStacks();
    await this.resolveAuditPseudonymSaltOwnership();
    for (const stack of stacks) {
      console.log(`[wren] ${stack.stackName}: ${stack.status ?? "ABSENT"} (${stack.disposition})`);
    }
    const tag = sourceTag(this.checkpoint, this.config.engineImageTag);
    await this.cdk(["synth", ...this.context(tag, false)], false);
    console.log(`[wren] Planned stages: ${DEPLOY_STAGES.join(" -> ")}`);
    console.log("[wren] DRY RUN complete; no AWS resources were changed.");
  }

  private async preflight(identityArn: string, dryRun = false): Promise<void> {
    if (Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10) < 22) {
      throw new Error(`Node.js 22 or newer is required; found ${process.versions.node}.`);
    }
    console.log(`[wren] AWS identity: ${identityArn}`);
    await this.runner.run({ executable: "aws", args: ["--version"] });
    if (!dryRun) {
      await this.runner.run({ executable: "docker", args: ["version", "--format", "{{.Server.Version}}"] });
    }
    const cdkCli = this.cdkCliPath();
    if (!existsSync(cdkCli)) throw new Error(`Local CDK CLI was not found at ${cdkCli}.`);
  }

  private async verifyBedrock(invoke: boolean): Promise<void> {
    const profiles = await this.aws.json<InferenceProfilesResponse>([
      "bedrock",
      "list-inference-profiles",
      "--type-equals",
      "SYSTEM_DEFINED",
    ]);
    const found = profiles.inferenceProfileSummaries?.some(
      (profile) => profile.inferenceProfileId === this.config.bedrockModelId,
    );
    if (!found) {
      throw new ActionRequiredError(
        `Bedrock profile ${this.config.bedrockModelId} is not available in ${this.config.region}. Enable it or set WREN_BEDROCK_MODEL_ID, then rerun npm run deploy.`,
      );
    }
    if (!invoke) return;

    const directory = mkdtempSync(path.join(tmpdir(), "wren-bedrock-"));
    const bodyPath = path.join(directory, "request.json");
    const outputPath = path.join(directory, "response.json");
    writeFileSync(
      bodyPath,
      JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1,
        messages: [{ role: "user", content: "Reply with OK." }],
      }),
      { mode: 0o600 },
    );
    try {
      await this.aws.command([
        "bedrock-runtime",
        "invoke-model",
        "--model-id", this.config.bedrockModelId,
        "--content-type", "application/json",
        "--accept", "application/json",
        "--body", `fileb://${bodyPath.replace(/\\/g, "/")}`,
        "--cli-binary-format", "raw-in-base64-out",
        outputPath,
      ]);
    } catch (error) {
      throw new ActionRequiredError(classifyBedrockError(error));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  private async ensureBootstrap(region: string): Promise<void> {
    const toolkit = await this.discovery.stack("CDKToolkit", region);
    if (toolkit.disposition === "complete") return;
    if (toolkit.disposition === "in-progress" || toolkit.disposition === "blocked") {
      throw new ActionRequiredError(`CDKToolkit in ${region} is ${toolkit.status}; resolve the stack before rerunning.`);
    }
    if (!this.config.bootstrapMissing) {
      throw new ActionRequiredError(`CDKToolkit is missing in ${region}. Bootstrap it or set WREN_BOOTSTRAP_MISSING=true.`);
    }
    await this.cdk(["bootstrap", `aws://${this.accountId}/${region}`], true);
  }

  private async deployPrerequisites(): Promise<void> {
    await this.resolveAuditPseudonymSaltOwnership();
    const stackName = `${this.config.stackPrefix}-Cicd`;
    const stack = await this.discovery.stack(stackName);
    if (stack.disposition === "in-progress" || stack.disposition === "blocked") {
      throw new ActionRequiredError(`${stackName} is ${stack.status}; resolve it before rerunning.`);
    }
    const resources = stack.disposition === "absent" ? [] : await this.discovery.stackResources(stackName);
    const repositoryName = `${this.config.stackPrefix}-feedback-engine`;
    const repository = await this.aws.tryJson<RepositoriesResponse>([
      "ecr", "describe-repositories", "--repository-names", repositoryName,
    ]);
    const boundaryArn = `arn:aws:iam::${this.accountId}:policy/${this.config.stackPrefix}-compute-boundary`;
    const boundary = await this.aws.tryJson<Record<string, unknown>>(["iam", "get-policy", "--policy-arn", boundaryArn]);
    const stackOwnsRepository = resources.some((resource) => resource.type === "AWS::ECR::Repository");
    const stackOwnsBoundary = resources.some((resource) => resource.type === "AWS::IAM::ManagedPolicy");
    const stackHasPipeline = resources.some((resource) => resource.type === "AWS::CodePipeline::Pipeline");

    if (stackHasPipeline && !this.config.enableCicd) {
      throw new ActionRequiredError("An existing WREN pipeline was detected. Set WREN_ENABLE_CICD=true so deployment does not remove it.");
    }
    if (this.config.ecrOwnership === "managed" && repository && !stackOwnsRepository) {
      throw new ActionRequiredError(`ECR repository ${repositoryName} exists outside ${stackName}. Set WREN_ECR_OWNERSHIP=external after verifying ownership.`);
    }
    if (this.config.ecrOwnership === "external" && !repository) {
      throw new ActionRequiredError(`WREN_ECR_OWNERSHIP=external requires existing repository ${repositoryName}.`);
    }
    if (this.config.ecrOwnership === "external") {
      const policy = await this.aws.tryJson<{ readonly policyText?: string }>([
        "ecr", "get-repository-policy", "--repository-name", repositoryName,
      ]);
      if (!hasLambdaPullPolicy(policy?.policyText)) {
        throw new ActionRequiredError(
          `External ECR repository ${repositoryName} must allow lambda.amazonaws.com ` +
          "ecr:GetDownloadUrlForLayer, ecr:BatchGetImage, and ecr:BatchCheckLayerAvailability.",
        );
      }
    }
    if (boundary && !stackOwnsBoundary) {
      throw new ActionRequiredError(`IAM policy ${boundaryArn} exists outside ${stackName}; do not delete it. Resolve ownership before rerunning.`);
    }

    // Never update a restart-on-update pipeline before application/admin smoke
    // gates. Existing prerequisites are already present; the final pipeline
    // stage performs the only pipeline-bearing Cicd update.
    if (stackHasPipeline) return;

    const tag = sourceTag(this.checkpoint, this.config.engineImageTag);
    await this.deployStacks([stackName], tag, false);
  }

  private async publishFeedbackImage(): Promise<void> {
    const tag = sourceTag(this.checkpoint, this.config.engineImageTag);
    const repositoryName = `${this.config.stackPrefix}-feedback-engine`;
    const existing = await this.aws.tryJson<ImagesResponse>([
      "ecr", "describe-images", "--repository-name", repositoryName, "--image-ids", `imageTag=${tag}`,
    ]);
    const existingDigest = existing?.imageDetails?.[0]?.imageDigest;
    if (existingDigest) {
      this.checkpoint = withImage(this.checkpoint, tag, existingDigest);
      this.store.save(this.checkpoint);
      return;
    }

    const registry = `${this.accountId}.dkr.ecr.${this.config.region}.amazonaws.com`;
    const repositoryUri = `${registry}/${repositoryName}`;
    const password = await this.aws.text(["ecr", "get-login-password"]);
    await this.runner.run({
      executable: "docker",
      args: ["login", "--username", "AWS", "--password-stdin", registry],
      stdin: `${password}\n`,
      secrets: [password],
    });
    await this.runner.run({
      executable: "docker",
      args: [
        "build",
        "--platform", "linux/amd64",
        "-t", `${repositoryUri}:${tag}`,
        path.join(this.repoRoot, "backend", "engine", "python"),
      ],
      cwd: this.repoRoot,
      streamOutput: true,
    });
    await this.runner.run({ executable: "docker", args: ["push", `${repositoryUri}:${tag}`], streamOutput: true });
    await this.runner.run({ executable: "docker", args: ["tag", `${repositoryUri}:${tag}`, `${repositoryUri}:bootstrap`] });
    await this.runner.run({ executable: "docker", args: ["push", `${repositoryUri}:bootstrap`], streamOutput: true });

    const verified = await this.aws.json<ImagesResponse>([
      "ecr", "describe-images", "--repository-name", repositoryName, "--image-ids", `imageTag=${tag}`,
    ]);
    const digest = verified.imageDetails?.[0]?.imageDigest;
    if (!digest) throw new Error(`ECR did not return a digest for ${repositoryName}:${tag}.`);
    this.checkpoint = withImage(this.checkpoint, tag, digest);
    this.store.save(this.checkpoint);
  }

  private async deployConcerns(concerns: readonly string[]): Promise<void> {
    const tag = this.checkpoint.image?.tag ?? sourceTag(this.checkpoint, this.config.engineImageTag);
    for (const concern of concerns) {
      const stackName = `${this.config.stackPrefix}-${concern}`;
      const region = concern === "CloudFrontWaf" ? "us-east-1" : this.config.region;
      const current = await this.discovery.stack(stackName, region);
      if (current.disposition === "in-progress" || current.disposition === "blocked") {
        throw new ActionRequiredError(`${stackName} is ${current.status}; inspect CloudFormation events and resolve it before rerunning.`);
      }
      await this.deployStacks([stackName], tag, false);
    }
  }

  private async deployAmplify(): Promise<void> {
    if (!this.config.enableAmplify) return;
    if (!this.config.githubOwner || !this.config.githubRepo) {
      throw new ActionRequiredError("Amplify requires WREN_GITHUB_OWNER and WREN_GITHUB_REPO.");
    }
    await this.ensureGithubSecret(`${this.config.stackPrefix}/github/token`);
    const tag = this.checkpoint.image?.tag ?? sourceTag(this.checkpoint, this.config.engineImageTag);
    const stackName = `${this.config.stackPrefix}-Amplify`;
    await this.deployStacks([stackName], tag, false);
    const stack = await this.discovery.stack(stackName);
    const appId = stack.outputs.AmplifyAppId;
    if (!appId) throw new Error(`${stackName} did not return AmplifyAppId.`);
    await this.waitForAmplify(appId);
    const domain = stack.outputs.AmplifyDefaultDomain;
    if (domain) console.log(`[wren] Hosted application: https://${domain}`);
  }

  private async deployPipeline(): Promise<void> {
    if (!this.config.enableCicd) return;
    if (!this.config.githubOwner || !this.config.githubRepo) {
      throw new ActionRequiredError("CI/CD requires WREN_GITHUB_OWNER and WREN_GITHUB_REPO.");
    }

    await this.ensureGithubSecret(`${this.config.stackPrefix}/cicd/github-pat`);
    const tag = this.checkpoint.image?.tag ?? sourceTag(this.checkpoint, this.config.engineImageTag);
    await this.deployStacks([`${this.config.stackPrefix}-Cicd`], tag, true);

    const state = await this.aws.json<PipelineStateResponse>([
      "codepipeline", "get-pipeline-state", "--name", `${this.config.stackPrefix}-pipeline`,
    ]);
    assertPipelineStages(state);
  }

  private async configureAdministrator(): Promise<void> {
    const authorizerName = `${this.config.stackPrefix}-authorizer`;
    const tag = this.checkpoint.image?.tag ?? sourceTag(this.checkpoint, this.config.engineImageTag);

    const configureAndProbe = async (): Promise<void> => {
      if (this.config.adminAlreadyConfigured && !this.config.adminEmail) {
        console.warn("[wren] WREN_ADMIN_ALREADY_CONFIGURED=true: application-role discovery is being bypassed for a legacy environment.");
        return;
      }
      if (!this.config.adminEmail) {
        throw new ActionRequiredError("Set WREN_ADMIN_EMAIL to guide and verify the first TechnicalAdmin, then rerun npm run deploy.");
      }

      const pool = await this.aws.json<ParameterResponse>([
        "ssm", "get-parameter", "--name", `/${this.config.stackPrefix}/auth/user-pool-id`,
      ]);
      const poolId = pool.Parameter?.Value;
      if (!poolId) throw new Error("Cognito user-pool ID was not found in SSM.");
      const users = await this.aws.json<CognitoUsersResponse>([
        "cognito-idp", "list-users", "--user-pool-id", poolId,
        "--filter", `email = \"${this.config.adminEmail}\"`, "--limit", "1",
      ]);
      const user = users.Users?.[0];
      const amplify = await this.discovery.stack(`${this.config.stackPrefix}-Amplify`);
      const signupDomain = amplify.outputs.AmplifyDefaultDomain;
      if (!user?.Username) {
        throw new ActionRequiredError(
          `No Cognito user exists for ${this.config.adminEmail}. Sign up${signupDomain ? ` at https://${signupDomain}/signup` : " in the application"}, confirm the email, do not make an application request yet, and rerun.`,
        );
      }
      if (user.UserStatus !== "CONFIRMED") {
        throw new ActionRequiredError(`Cognito user ${this.config.adminEmail} is ${user.UserStatus ?? "unconfirmed"}. Confirm the email and rerun.`);
      }
      const subject = user.Attributes?.find((attribute) => attribute.Name === "sub")?.Value;
      if (!subject) throw new Error(`Confirmed Cognito user ${this.config.adminEmail} has no sub attribute.`);

      const groups = await this.aws.json<CognitoGroupsResponse>([
        "cognito-idp", "admin-list-groups-for-user", "--user-pool-id", poolId, "--username", user.Username,
      ]);
      if (!groups.Groups?.some((group) => group.GroupName === "SystemAdmin")) {
        await this.aws.command([
          "cognito-idp", "admin-add-user-to-group", "--user-pool-id", poolId,
          "--username", user.Username, "--group-name", "SystemAdmin",
        ]);
      }

      let authorizer = await this.aws.json<LambdaConfiguration>([
        "lambda", "get-function-configuration", "--function-name", authorizerName,
      ]);
      if (authorizer.Environment?.Variables?.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT !== subject) {
        await this.deployStacks([`${this.config.stackPrefix}-Compute`], tag, false, subject);
        authorizer = await this.aws.json<LambdaConfiguration>([
          "lambda", "get-function-configuration", "--function-name", authorizerName,
        ]);
        if (authorizer.Environment?.Variables?.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT !== subject) {
          throw new Error("Compute deployed but the exact TechnicalAdmin bootstrap subject is not armed.");
        }
      }

      const accessToken = this.config.smokeAccessToken;
      if (!accessToken) {
        throw new ActionRequiredError(
          "TechnicalAdmin gates are armed. Sign in as the confirmed candidate, set WREN_SMOKE_ACCESS_TOKEN to a fresh Cognito access token, and rerun npm run deploy.",
        );
      }

      assertAdminProbeSafe({
        exists: true,
        confirmed: true,
        inSystemAdmin: true,
        exactSubjectArmed: true,
        hasAccessToken: true,
      });
      const api = await this.apiEndpoint();
      const me = await this.apiJson<AuthMeResponse>(api, "/v1/auth/me", accessToken);
      if (!me.roles?.includes("TechnicalAdmin")) {
        throw new ActionRequiredError(
          `The authenticated application user has roles [${(me.roles ?? []).join(", ")}], not TechnicalAdmin. ` +
          "The temporary bootstrap will be removed; use a controlled role-recovery procedure.",
        );
      }
      this.verifiedTechnicalAdmin = true;
    };

    if (!this.config.smokeAccessToken) {
      await configureAndProbe();
      return;
    }

    // A supplied token means a previous or current run may have armed the gate.
    // Establish the cleanup obligation before any AWS lookup or early return.
    await runWithRequiredCleanup(
      configureAndProbe,
      () => this.disarmTechnicalAdminBootstrap(authorizerName, tag),
    );
  }

  private async disarmTechnicalAdminBootstrap(authorizerName: string, tag: string): Promise<void> {
    let deploymentError: unknown;
    try {
      await this.deployStacks([`${this.config.stackPrefix}-Compute`], tag, false);
    } catch (error) {
      deploymentError = error;
    }

    let safeAuthorizer: LambdaConfiguration;
    try {
      safeAuthorizer = await this.aws.json<LambdaConfiguration>([
        "lambda", "get-function-configuration", "--function-name", authorizerName,
      ]);
    } catch (verificationError) {
      throw new Error(
        `Could not verify the subject-free authorizer configuration: ${errorMessage(verificationError)}` +
        (deploymentError ? `; Compute cleanup deploy also failed: ${errorMessage(deploymentError)}` : ""),
      );
    }

    if (safeAuthorizer.Environment?.Variables?.TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT) {
      throw new Error(
        "The temporary bootstrap subject remains enabled" +
        (deploymentError ? ` after the Compute cleanup deploy failed: ${errorMessage(deploymentError)}` : "."),
      );
    }
    if (deploymentError) {
      console.warn("[wren] Compute cleanup deploy reported an error, but Lambda readback proves the bootstrap subject is absent.");
    }
  }

  private async runSmokeTests(): Promise<void> {
    if (!this.config.smokeAccessToken) {
      throw new ActionRequiredError("Set WREN_SMOKE_ACCESS_TOKEN to a fresh Cognito access token to complete application smoke tests.");
    }
    const amplify = await this.discovery.stack(`${this.config.stackPrefix}-Amplify`);
    let smokeOrigin = "http://localhost:5173";
    if (this.config.enableAmplify) {
      const domain = amplify.outputs.AmplifyDefaultDomain;
      if (!domain) throw new Error("Amplify did not publish a hosted domain.");
      smokeOrigin = `https://${domain}`;
      const response = await fetch(`${smokeOrigin}/`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Amplify frontend returned HTTP ${response.status}.`);
    }

    const api = await this.apiEndpoint();
    const preflight = await fetch(new URL("v1/auth/me", api), {
      method: "OPTIONS",
      headers: {
        Origin: smokeOrigin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!preflight.ok) throw new Error(`API preflight returned HTTP ${preflight.status}.`);
    assertCorsPreflight(
      preflight.headers,
      smokeOrigin,
      "GET",
      ["authorization", "content-type"],
    );

    const me = await this.apiJson<AuthMeResponse>(api, "/v1/auth/me", this.config.smokeAccessToken);
    const isAdmin = me.roles?.includes("TechnicalAdmin") === true;
    if (this.config.adminEmail && !this.config.adminAlreadyConfigured && !isAdmin) {
      throw new Error("Authenticated smoke user is not TechnicalAdmin after administrator setup.");
    }
    if (isAdmin || this.verifiedTechnicalAdmin) {
      for (const route of [
        "/v1/admin/config/model",
        "/v1/admin/config/usage-limits",
        "/v1/departments",
      ]) {
        await this.apiJson<unknown>(api, route, this.config.smokeAccessToken);
      }
    }

    for (const functionName of [
      `${this.config.stackPrefix}-authorizer`,
      `${this.config.stackPrefix}-document`,
      `${this.config.stackPrefix}-admin`,
      `${this.config.stackPrefix}-audit`,
      `${this.config.stackPrefix}-feedback-orchestrator`,
      `${this.config.stackPrefix}-feedback-engine`,
      `${this.config.stackPrefix}-diff-anchor-progress`,
      `${this.config.stackPrefix}-notification`,
      `${this.config.stackPrefix}-appsync-authorizer`,
    ]) {
      const lambda = await this.aws.json<LambdaConfiguration>([
        "lambda", "get-function-configuration", "--function-name", functionName,
      ]);
      if (lambda.State !== "Active") throw new Error(`Lambda ${functionName} is ${lambda.State ?? "not active"}.`);
    }

    for (const queueName of [
      `${this.config.stackPrefix}-feedback-dlq`,
      `${this.config.stackPrefix}-document-ingest-dlq`,
    ]) {
      const queue = await this.aws.json<{ readonly QueueUrl?: string }>([
        "sqs", "get-queue-url", "--queue-name", queueName,
      ]);
      if (!queue.QueueUrl) throw new Error(`SQS did not return a URL for ${queueName}.`);
      const attributes = await this.aws.json<{ readonly Attributes?: Readonly<Record<string, string>> }>([
        "sqs", "get-queue-attributes", "--queue-url", queue.QueueUrl,
        "--attribute-names", "ApproximateNumberOfMessages",
      ]);
      const messages = Number(attributes.Attributes?.ApproximateNumberOfMessages ?? "0");
      if (messages > 0) throw new Error(`${queueName} contains ${messages} message(s).`);
    }
  }

  private async apiEndpoint(): Promise<string> {
    const apiStack = await this.discovery.stack(`${this.config.stackPrefix}-Api`);
    const endpoint = apiStack.outputs.ApiEndpoint;
    if (!endpoint) throw new Error("Api stack did not publish ApiEndpoint.");
    return endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
  }

  private async apiJson<T>(baseUrl: string, route: string, token: string): Promise<T> {
    const response = await fetch(new URL(route.replace(/^\//, ""), baseUrl), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Authenticated API check ${route} returned HTTP ${response.status}.`);
    return await response.json() as T;
  }

  private async ensureGithubSecret(secretName: string): Promise<void> {
    const existing = await this.aws.tryJson<Record<string, unknown>>([
      "secretsmanager", "describe-secret", "--secret-id", secretName,
    ]);
    if (!this.config.githubToken) {
      if (existing) return;
      throw new ActionRequiredError(`Set WREN_GITHUB_TOKEN to create ${secretName}, then rerun npm run deploy.`);
    }
    const directory = mkdtempSync(path.join(tmpdir(), "wren-secret-"));
    const filePath = path.join(directory, "secret.txt");
    writeFileSync(filePath, this.config.githubToken, { mode: 0o600 });
    try {
      const operation = existing ? "put-secret-value" : "create-secret";
      const identifier = existing ? "--secret-id" : "--name";
      await this.aws.command([
        "secretsmanager", operation, identifier, secretName,
        "--secret-string", secretFileUri(filePath),
      ], this.config.region, [this.config.githubToken]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  private async waitForAmplify(appId: string): Promise<void> {
    const deadline = Date.now() + 60 * 60 * 1000;
    while (Date.now() < deadline) {
      const jobs = await this.aws.json<AmplifyJobsResponse>([
        "amplify", "list-jobs", "--app-id", appId, "--branch-name", this.config.githubBranch, "--max-results", "1",
      ]);
      const status = jobs.jobSummaries?.[0]?.status;
      if (status === "SUCCEED") return;
      if (status === "FAILED" || status === "CANCELLED") {
        throw new Error(`Amplify build ${jobs.jobSummaries?.[0]?.jobId ?? "unknown"} ended with ${status}.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    throw new Error("Timed out waiting for the Amplify branch build.");
  }

  private async resolveAuditPseudonymSaltOwnership(): Promise<void> {
    const secretName = `${this.config.stackPrefix}/audit/pseudonym-salt`;
    const secret = await this.aws.tryJson<Record<string, unknown>>([
      "secretsmanager", "describe-secret", "--secret-id", secretName,
    ]);
    if (!secret) {
      this.auditPseudonymSaltOwnership = "managed";
      return;
    }

    const computeStackName = `${this.config.stackPrefix}-Compute`;
    const compute = await this.discovery.stack(computeStackName);
    const resources = compute.disposition === "absent"
      ? []
      : await this.discovery.stackResources(computeStackName);
    const stackOwnsSalt = resources.some((resource) =>
      resource.type === "AWS::SecretsManager::Secret" &&
      (resource.physicalId?.startsWith(secretName) ?? false),
    );
    this.auditPseudonymSaltOwnership = stackOwnsSalt ? "managed" : "external";
    if (!stackOwnsSalt) {
      console.log(`[wren] Reusing retained audit pseudonym salt ${secretName}.`);
    }
  }

  private context(tag: string, enableCicd: boolean, subject?: string): readonly string[] {
    return cdkContextArgs(
      this.config,
      tag,
      enableCicd,
      subject,
      this.auditPseudonymSaltOwnership,
    );
  }

  private async deployStacks(stackNames: readonly string[], tag: string, enableCicd: boolean, subject?: string): Promise<void> {
    await this.cdk([
      "deploy",
      ...stackNames,
      ...this.context(tag, enableCicd, subject),
      "--require-approval", this.config.requireApproval,
    ], true);
  }

  private async cdk(args: readonly string[], streamOutput: boolean): Promise<void> {
    await this.runner.run({
      executable: process.execPath,
      args: [this.cdkCliPath(), ...args],
      cwd: path.join(this.repoRoot, "cdk"),
      streamOutput,
      timeoutMs: 2 * 60 * 60 * 1000,
    });
  }

  private cdkCliPath(): string {
    return path.join(this.repoRoot, "cdk", "node_modules", "aws-cdk", "bin", "cdk");
  }
}

export function deploymentConfigDigest(config: DeploymentConfig): string {
  return createHash("sha256").update(JSON.stringify({
    region: config.region,
    stackPrefix: config.stackPrefix,
    branch: config.githubBranch,
    ecrOwnership: config.ecrOwnership,
  })).digest("hex");
}
