import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  type CheckpointImage,
  type DeploymentCheckpoint,
} from "./checkpoint.js";
import { CicdStack } from "../../lib/stacks/CicdStack.js";
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

interface StartBuildResponse {
  readonly build?: { readonly id?: string };
}

interface BatchGetBuildsResponse {
  readonly builds?: readonly {
    readonly buildStatus?: string;
    readonly logs?: { readonly deepLink?: string; readonly groupName?: string };
  }[];
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
    "-c", `cacheMode=${config.cacheMode}`,
    "-c", `cacheTtl=${config.cacheTtl}`,
    "-c", `cacheEnabledWorkloads=${config.cacheEnabledWorkloads.join(",")}`,
    "-c", `feedbackEngineImageTag=${imageTag}`,
    "-c", `enableCicd=${enableCicd}`,
    "-c", `ecrOwnership=${config.ecrOwnership}`,
    "-c", `auditPseudonymSaltOwnership=${auditPseudonymSaltOwnership}`,
    ...(config.githubOwner ? ["-c", `githubOwner=${config.githubOwner}`] : []),
    ...(config.githubRepo ? ["-c", `githubRepo=${config.githubRepo}`] : []),
    "-c", `githubBranch=${config.githubBranch}`,
    ...(config.customDomain ? ["-c", `customDomain=${config.customDomain}`] : []),
    ...(technicalAdminBootstrapSubject
      ? ["-c", `technicalAdminBootstrapSubject=${technicalAdminBootstrapSubject}`]
      : []),
  ];
}

/**
 * The primary frontend origin to surface in logs, signup guidance, and the
 * smoke test. Prefers the configured custom domain (root) when set, otherwise
 * falls back to the Amplify default domain. Returns `undefined` when neither is
 * available (e.g. Amplify hosting disabled and no custom domain). Values are
 * bare hostnames (no scheme); callers prepend `https://`.
 */
export function primaryFrontendHost(
  customDomain: string | undefined,
  amplifyDefaultDomain: string | undefined,
): string | undefined {
  return customDomain ?? amplifyDefaultDomain ?? undefined;
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

// ---------------------------------------------------------------------------
// Cache-aware synthetic smoke (prompt-cache plan §17/§18/§20).
//
// This is an OPTIONAL, non-sensitive verification that only runs when explicit
// caching is enabled. It NEVER touches student or reference content — it sends
// a fixed, benign synthetic prompt twice with a cache checkpoint and asserts the
// second invocation reports cache-read tokens. In observe/off it is skipped
// entirely. All logic below is pure and unit-testable without any AWS calls.
// ---------------------------------------------------------------------------

/**
 * Whether the cache-aware synthetic smoke should run for this deployment.
 *
 * It runs ONLY when `cacheMode === 'explicit'` AND at least one workload is
 * enabled — i.e. only when caching can actually take effect. In `off` and
 * `observe` (the safe default) it is skipped, so the default deploy behavior
 * is unchanged and no synthetic cache request is ever sent.
 */
export function shouldRunCacheSmoke(config: {
  readonly cacheMode: string;
  readonly cacheEnabledWorkloads: readonly string[];
}): boolean {
  return config.cacheMode === "explicit" && config.cacheEnabledWorkloads.length > 0;
}

/**
 * A benign, fixed synthetic prompt large enough (>1,024 tokens) to exceed the
 * minimum cacheable prefix for Claude Sonnet 4.6 (plan §7). It contains NO
 * student, reference, or otherwise sensitive content — only repeated neutral
 * filler describing that this is a deployment cache probe.
 */
export function cacheSmokeSystemPrompt(): string {
  const sentence =
    "This is a synthetic WREN deployment cache-verification probe containing no user or reference data. ";
  // ~13 tokens/sentence * 120 => comfortably over the 1,024-token minimum.
  return sentence.repeat(120).trim();
}

/**
 * Build the Anthropic `InvokeModel` body for the synthetic cache probe. The
 * large fixed system block carries a single `cache_control` ephemeral
 * checkpoint (the only approved place); the user message is a trivial fixed
 * prompt. Byte-identical across both invocations so the second can hit the
 * cache written by the first.
 */
export function buildCacheSmokeRequestBody(ttl: "5m" | "1h" = "5m"): Record<string, unknown> {
  return {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1,
    system: [
      {
        type: "text",
        text: cacheSmokeSystemPrompt(),
        cache_control: { type: "ephemeral", ttl },
      },
    ],
    messages: [{ role: "user", content: "Reply with OK." }],
  };
}

/** Minimal shape of the Anthropic usage block we inspect (plan §7). */
export interface CacheSmokeUsage {
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

/** Extract the usage block from a parsed Anthropic InvokeModel response. */
export function parseCacheSmokeUsage(responseText: string): CacheSmokeUsage {
  const parsed = JSON.parse(responseText) as { readonly usage?: CacheSmokeUsage };
  return parsed.usage ?? {};
}

/** Outcome of the two-request cache probe. */
export interface CacheSmokeResult {
  readonly cacheDemonstrated: boolean;
  readonly firstWriteTokens: number;
  readonly secondReadTokens: number;
  readonly detail: string;
}

/**
 * Evaluate the two synthetic responses. Cache is "demonstrated" when the SECOND
 * response reports `cache_read_input_tokens > 0` (plan §20 acceptance gate).
 * This is a pure evaluation — the caller decides whether to treat a negative
 * result as soft (reported) or hard.
 */
export function evaluateCacheSmoke(
  first: CacheSmokeUsage,
  second: CacheSmokeUsage,
): CacheSmokeResult {
  const firstWriteTokens = first.cache_creation_input_tokens ?? 0;
  const secondReadTokens = second.cache_read_input_tokens ?? 0;
  const cacheDemonstrated = secondReadTokens > 0;
  const detail = cacheDemonstrated
    ? `Cache read demonstrated: first write=${firstWriteTokens} tokens, second read=${secondReadTokens} tokens.`
    : `No cache read observed on the second request (write=${firstWriteTokens}, read=${secondReadTokens}). ` +
      "This can happen below the minimum prefix, on cache expiry, or under concurrent routing.";
  return { cacheDemonstrated, firstWriteTokens, secondReadTokens, detail };
}

export function sourceTag(checkpoint: DeploymentCheckpoint, configured?: string): string {
  if (configured) return configured;
  const timestamp = checkpoint.createdAt.replace(/[-:.TZ]/g, "");
  return `deploy-${timestamp}`;
}

/**
 * Derive an immutable, commit-scoped ECR tag from a full Git commit SHA.
 * The tag is a stable function of the commit, so the image built under it
 * always corresponds to exactly that revision — the basis for commit-safe
 * idempotency. `WREN_ENGINE_IMAGE_TAG` overrides this when set (see
 * {@link resolveImageTagForCommit}).
 */
export function commitImageTag(sha: string): string {
  return `src-${sha.slice(0, 12)}`;
}

/**
 * Resolve the ECR tag to build under for a given commit. The commit-scoped
 * `src-<shortsha>` is the default and guarantees the tag maps to the revision.
 * An explicit `WREN_ENGINE_IMAGE_TAG` bypasses commit-scoping — it is an
 * operator-owned override whose safe reuse relies on the checkpoint's recorded
 * `sourceCommit` matching the revision being deployed.
 */
export function resolveImageTagForCommit(sha: string, configured?: string): string {
  return configured ?? commitImageTag(sha);
}

/**
 * True when a recorded checkpoint image may be reused for the revision being
 * deployed. Reuse is allowed only when the image is provably from this commit:
 * the checkpoint recorded a `sourceCommit` equal to the resolved SHA. A legacy
 * v1 checkpoint (no `sourceCommit`) or a commit mismatch forces a rebuild, so a
 * pre-existing tag can never cause the wrong commit's image to be deployed.
 */
export function checkpointImageMatchesCommit(
  image: CheckpointImage | undefined,
  sha: string,
): boolean {
  return image?.sourceCommit === sha;
}

/**
 * The image identifier handed to CDK as `feedbackEngineImageTag` (consumed by
 * `Code.fromEcrImage`'s `tagOrDigest`). Prefer the immutable **digest** the
 * `feedback-image` stage recorded this run, so the deployed Lambda is pinned to
 * exactly the image that was built — a mutable tag cannot be repointed
 * out-of-band between build and deploy. Falls back to the recorded tag, then to
 * the computed source tag (direct-CDK / `bootstrap` compatibility when no image
 * was published this run).
 */
export function imageDeployRef(
  checkpoint: DeploymentCheckpoint,
  configured?: string,
): string {
  const image = checkpoint.image;
  return (image?.digest || image?.tag) ?? sourceTag(checkpoint, configured);
}

/**
 * The `aws`/`runner` surface the git + S3 + CodeBuild helpers depend on,
 * narrowed so they are unit-testable with lightweight mocks.
 */
export interface ImageBuildDeps {
  readonly runner: Runner;
  readonly aws: Pick<AwsCli, "json" | "tryJson" | "command">;
  readonly repoRoot: string;
}

/**
 * Resolve the exact Git revision being deployed and enforce a clean working
 * tree. CodeBuild builds from a `git archive <sha>` snapshot, not the working
 * directory, so uncommitted changes would silently not be in the image — a
 * dirty tree is therefore a hard, actionable error.
 */
export async function resolveCleanCommit(runner: Runner, repoRoot: string): Promise<string> {
  // `--untracked-files=all` makes the guard independent of the operator's
  // `status.showUntrackedFiles` config: untracked files never enter
  // `git archive <sha>`, so a "clean" check must still flag them rather than
  // let them silently drop out of the image.
  const status = await runner.run({
    executable: "git",
    args: ["status", "--porcelain", "--untracked-files=all"],
    cwd: repoRoot,
  });
  if (status.stdout.trim().length > 0) {
    throw new ActionRequiredError(
      "The working tree has uncommitted or untracked changes. The Feedback Engine image is " +
      "built in CodeBuild from a snapshot of the committed revision (git archive), so those " +
      "changes would not be included. Commit, stash, or remove them, then rerun npm run deploy.",
    );
  }
  const head = await runner.run({
    executable: "git",
    args: ["rev-parse", "HEAD"],
    cwd: repoRoot,
  });
  const sha = head.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`git rev-parse HEAD did not return a full commit SHA (got "${sha}").`);
  }
  return sha;
}

/**
 * Verify the CDK bootstrap assets bucket exists and is reachable, failing with
 * an actionable error if not. This makes a missing/renamed bootstrap bucket a
 * clear prerequisite failure rather than an opaque CodeBuild source error.
 */
export async function verifyBootstrapAssetsBucket(
  aws: Pick<AwsCli, "command">,
  bucket: string,
): Promise<void> {
  try {
    await aws.command(["s3api", "head-bucket", "--bucket", bucket]);
  } catch {
    throw new ActionRequiredError(
      `The CDK bootstrap assets bucket ${bucket} is not available. The Feedback Engine image ` +
      "build uploads its source snapshot there. Bootstrap the account/region (npx cdk bootstrap " +
      "or set WREN_BOOTSTRAP_MISSING=true so npm run deploy bootstraps it), then rerun.",
    );
  }
}

/**
 * `git archive <sha>` the full repository to a temporary zip and upload it under
 * a SHA-based key in the bootstrap assets bucket. The key encodes the commit,
 * so the CodeBuild S3 source is pinned by object key with no dependency on S3
 * versioning or a VersionId. Returns the bucket and key of the snapshot.
 */
export async function uploadCommitSnapshot(
  deps: ImageBuildDeps,
  bucket: string,
  keyPrefix: string,
  sha: string,
): Promise<{ readonly bucket: string; readonly key: string }> {
  const key = `${keyPrefix}/${sha}.zip`;
  const directory = mkdtempSync(path.join(tmpdir(), "wren-bootstrap-src-"));
  const zipPath = path.join(directory, `${sha}.zip`);
  try {
    await deps.runner.run({
      executable: "git",
      args: ["archive", "--format=zip", "-o", zipPath, sha],
      cwd: deps.repoRoot,
    });
    await deps.aws.command([
      "s3api", "put-object",
      "--bucket", bucket,
      "--key", key,
      "--body", `fileb://${zipPath.replace(/\\/g, "/")}`,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return { bucket, key };
}

/**
 * Start the standing bootstrap CodeBuild project against the SHA-keyed S3
 * snapshot (via `--source-location-override`, never a VersionId), overriding
 * `IMAGE_TAG` with the commit-scoped tag, and poll until the build reaches a
 * terminal state. A non-`SUCCEEDED` outcome throws with the build id and its
 * CloudWatch logs location for triage.
 */
export async function runBootstrapImageBuild(
  aws: Pick<AwsCli, "json">,
  projectName: string,
  source: { readonly bucket: string; readonly key: string },
  imageTag: string,
  options: { readonly pollIntervalMs?: number; readonly timeoutMs?: number; readonly sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const started = await aws.json<StartBuildResponse>([
    "codebuild", "start-build",
    "--project-name", projectName,
    "--source-location-override", `${source.bucket}/${source.key}`,
    "--source-type-override", "S3",
    "--environment-variables-override", `name=IMAGE_TAG,value=${imageTag},type=PLAINTEXT`,
  ]);
  const buildId = started.build?.id;
  if (!buildId) throw new Error(`codebuild start-build did not return a build id for ${projectName}.`);

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await aws.json<BatchGetBuildsResponse>([
      "codebuild", "batch-get-builds", "--ids", buildId,
    ]);
    const build = response.builds?.[0];
    const status = build?.buildStatus;
    if (status && status !== "IN_PROGRESS") {
      if (status === "SUCCEEDED") return;
      const logs = build?.logs?.deepLink ?? build?.logs?.groupName ?? "CloudWatch Logs";
      throw new Error(
        `Bootstrap image build ${buildId} finished with status ${status}. Inspect ${logs}.`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(`Bootstrap image build ${buildId} did not finish within the timeout.`);
    }
    await sleep(pollIntervalMs);
  }
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
    await this.preflight(identityArn);
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

  private async preflight(identityArn: string): Promise<void> {
    if (Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10) < 22) {
      throw new Error(`Node.js 22 or newer is required; found ${process.versions.node}.`);
    }
    console.log(`[wren] AWS identity: ${identityArn}`);
    await this.runner.run({ executable: "aws", args: ["--version"] });
    // No local Docker check: the Feedback Engine image is built in CodeBuild
    // from an S3 source snapshot, so a running local Docker daemon is not a
    // deploy prerequisite.
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

  /**
   * Optional cache-aware synthetic smoke (plan §17/§18/§20). Skipped unless
   * explicit caching is enabled. Sends the same benign synthetic prompt twice
   * with a cache checkpoint and checks the second reports cache-read tokens.
   *
   * This is a SOFT check: a negative result or an execution failure is reported
   * (returned) but does NOT fail the deploy — the one-token availability smoke
   * remains the hard gate. It never sends student or reference content.
   */
  private async verifyCacheSmoke(): Promise<CacheSmokeResult | undefined> {
    if (!shouldRunCacheSmoke(this.config)) {
      console.log(
        `[wren] Cache smoke skipped (cacheMode=${this.config.cacheMode}); explicit caching not enabled.`,
      );
      return undefined;
    }

    const directory = mkdtempSync(path.join(tmpdir(), "wren-cache-smoke-"));
    const bodyPath = path.join(directory, "request.json");
    const firstOut = path.join(directory, "first.json");
    const secondOut = path.join(directory, "second.json");
    writeFileSync(
      bodyPath,
      JSON.stringify(buildCacheSmokeRequestBody(this.config.cacheTtl)),
      { mode: 0o600 },
    );
    const invoke = async (outputPath: string): Promise<CacheSmokeUsage> => {
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
      return parseCacheSmokeUsage(readFileSync(outputPath, "utf8"));
    };

    try {
      const first = await invoke(firstOut);
      const second = await invoke(secondOut);
      const result = evaluateCacheSmoke(first, second);
      console.log(`[wren] Cache smoke: ${result.detail}`);
      if (!result.cacheDemonstrated) {
        console.warn(
          "[wren] Cache smoke did NOT demonstrate a cache read. Reported as a soft check; " +
            "the deployment continues. Review before advancing the production acceptance gate.",
        );
      }
      return result;
    } catch (error) {
      // Soft check: surface the reason but do not fail the deploy.
      console.warn(
        `[wren] Cache smoke could not run (${errorMessage(error)}). ` +
          "Reported as a soft check; the deployment continues.",
      );
      return {
        cacheDemonstrated: false,
        firstWriteTokens: 0,
        secondReadTokens: 0,
        detail: `Cache smoke execution failed: ${errorMessage(error)}`,
      };
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
    // Build the Feedback Engine image in AWS CodeBuild from an S3 snapshot of
    // the exact Git revision being deployed. No local Docker daemon and no
    // GitHub credential are involved — the local repo is `git archive`d, the
    // snapshot is uploaded under a SHA-based key, and the standing bootstrap
    // CodeBuild project (created in the Cicd stack at the prerequisites stage)
    // builds and pushes the image.
    const sha = await resolveCleanCommit(this.runner, this.repoRoot);
    const tag = resolveImageTagForCommit(sha, this.config.engineImageTag);
    const repositoryName = `${this.config.stackPrefix}-feedback-engine`;

    // Commit-safe idempotency: only short-circuit when the tag already exists
    // in ECR AND we can prove it was built from this exact commit. A tag that
    // exists but whose recorded commit differs (or is unknown, e.g. a legacy
    // checkpoint) is rebuilt — a stale tag must never deploy the wrong commit.
    const existing = await this.aws.tryJson<ImagesResponse>([
      "ecr", "describe-images", "--repository-name", repositoryName, "--image-ids", `imageTag=${tag}`,
    ]);
    const existingDigest = existing?.imageDetails?.[0]?.imageDigest;
    if (existingDigest && checkpointImageMatchesCommit(this.checkpoint.image, sha)) {
      this.checkpoint = withImage(this.checkpoint, tag, existingDigest, sha);
      this.store.save(this.checkpoint);
      return;
    }

    const bucket = CicdStack.bootstrapAssetsBucketNameFor(this.accountId, this.config.region);
    await verifyBootstrapAssetsBucket(this.aws, bucket);

    const source = await uploadCommitSnapshot(
      { runner: this.runner, aws: this.aws, repoRoot: this.repoRoot },
      bucket,
      CicdStack.bootstrapSourcePrefixFor(this.config.stackPrefix),
      sha,
    );

    await runBootstrapImageBuild(
      this.aws,
      CicdStack.bootstrapImageProjectNameFor(this.config.stackPrefix),
      source,
      tag,
    );

    // Record the ECR digest alongside the source commit. The digest is the
    // immutable identity of what was built and is what the deployed Lambda is
    // pinned to (see imageDeployRef); recording the commit too lets a later
    // rerun prove the image belongs to this revision.
    const verified = await this.aws.json<ImagesResponse>([
      "ecr", "describe-images", "--repository-name", repositoryName, "--image-ids", `imageTag=${tag}`,
    ]);
    const digest = verified.imageDetails?.[0]?.imageDigest;
    if (!digest) throw new Error(`ECR did not return a digest for ${repositoryName}:${tag}.`);
    this.checkpoint = withImage(this.checkpoint, tag, digest, sha);
    this.store.save(this.checkpoint);
  }

  private async deployConcerns(concerns: readonly string[]): Promise<void> {
    const tag = imageDeployRef(this.checkpoint, this.config.engineImageTag);
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
    const tag = imageDeployRef(this.checkpoint, this.config.engineImageTag);
    const stackName = `${this.config.stackPrefix}-Amplify`;
    await this.deployStacks([stackName], tag, false);
    const stack = await this.discovery.stack(stackName);
    const appId = stack.outputs.AmplifyAppId;
    if (!appId) throw new Error(`${stackName} did not return AmplifyAppId.`);
    await this.waitForAmplify(appId);
    const amplifyDefaultDomain = stack.outputs.AmplifyDefaultDomain;
    const host = primaryFrontendHost(this.config.customDomain, amplifyDefaultDomain);
    if (host) console.log(`[wren] Hosted application: https://${host}`);
    if (this.config.customDomain && amplifyDefaultDomain) {
      // The custom-domain certificate/DNS association can take time to become
      // live after the stack deploys; the Amplify default domain is available
      // immediately as a fallback.
      console.log(
        `[wren] Custom domain https://${this.config.customDomain} is provisioning; ` +
          `the Amplify default https://${amplifyDefaultDomain} works immediately.`,
      );
    }
  }

  private async deployPipeline(): Promise<void> {
    if (!this.config.enableCicd) return;
    if (!this.config.githubOwner || !this.config.githubRepo) {
      throw new ActionRequiredError("CI/CD requires WREN_GITHUB_OWNER and WREN_GITHUB_REPO.");
    }

    await this.ensureGithubSecret(`${this.config.stackPrefix}/cicd/github-pat`);
    const tag = imageDeployRef(this.checkpoint, this.config.engineImageTag);
    await this.deployStacks([`${this.config.stackPrefix}-Cicd`], tag, true);

    const state = await this.aws.json<PipelineStateResponse>([
      "codepipeline", "get-pipeline-state", "--name", `${this.config.stackPrefix}-pipeline`,
    ]);
    assertPipelineStages(state);
  }

  private async configureAdministrator(): Promise<void> {
    const authorizerName = `${this.config.stackPrefix}-authorizer`;
    const tag = imageDeployRef(this.checkpoint, this.config.engineImageTag);

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
      // Prefer the Amplify default domain for the hand-followed signup URL: a
      // custom domain's certificate/DNS may not be live yet during this admin
      // setup step, whereas the Amplify default is available immediately. The
      // custom domain (if configured) is only surfaced as informational context.
      const signupDomain = amplify.outputs.AmplifyDefaultDomain ?? this.config.customDomain;
      const customDomainNote =
        this.config.customDomain && this.config.customDomain !== signupDomain
          ? ` (the app will also be reachable at https://${this.config.customDomain} once its certificate is live)`
          : "";
      if (!user?.Username) {
        throw new ActionRequiredError(
          `No Cognito user exists for ${this.config.adminEmail}. Sign up${signupDomain ? ` at https://${signupDomain}/signup${customDomainNote}` : " in the application"}, confirm the email, do not make an application request yet, and rerun.`,
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
      const amplifyDefaultDomain = amplify.outputs.AmplifyDefaultDomain;
      if (!amplifyDefaultDomain) throw new Error("Amplify did not publish a hosted domain.");

      // Prefer the custom domain when configured, but its certificate/DNS may
      // not be live yet. Try it first; on any failure fall back to the Amplify
      // default domain (always available) so the smoke test still verifies the
      // frontend. API CORS returns `*`, so either origin satisfies the
      // preflight assertion below.
      const reachable = async (host: string): Promise<boolean> => {
        try {
          const response = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(30_000) });
          return response.ok;
        } catch {
          return false;
        }
      };

      if (this.config.customDomain && (await reachable(this.config.customDomain))) {
        smokeOrigin = `https://${this.config.customDomain}`;
      } else {
        if (this.config.customDomain) {
          console.log(
            `[wren] Custom domain https://${this.config.customDomain} is not live yet; ` +
              `smoke-testing the Amplify default https://${amplifyDefaultDomain} instead.`,
          );
        }
        smokeOrigin = `https://${amplifyDefaultDomain}`;
        const response = await fetch(`${smokeOrigin}/`, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Amplify frontend returned HTTP ${response.status}.`);
      }
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

    // Optional, non-sensitive cache verification (plan §17/§20). Skipped unless
    // explicit caching is enabled; soft-reported so it never fails the deploy.
    await this.verifyCacheSmoke();
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
