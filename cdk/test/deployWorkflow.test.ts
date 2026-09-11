import {
  assertCorsPreflight,
  assertPipelineStages,
  buildCacheSmokeRequestBody,
  cacheSmokeSystemPrompt,
  checkpointImageMatchesCommit,
  classifyBedrockError,
  cdkContextArgs,
  commitImageTag,
  deploymentConfigDigest,
  evaluateCacheSmoke,
  hasLambdaPullPolicy,
  imageDeployRef,
  isCompletedDeployCheckpoint,
  parseCacheSmokeUsage,
  primaryFrontendHost,
  resolveCleanCommit,
  resolveImageTagForCommit,
  runBootstrapImageBuild,
  runWithRequiredCleanup,
  shouldRunCacheSmoke,
  sourceTag,
  uploadCommitSnapshot,
  verifyBootstrapAssetsBucket,
} from "../scripts/operations/deployWorkflow.js";
import type { CommandResult, CommandSpec } from "../scripts/operations/runner.js";
import { ActionRequiredError } from "../scripts/operations/errors.js";
import { newCheckpoint, updateStage } from "../scripts/operations/checkpoint.js";
import { DEPLOY_STAGES } from "../scripts/operations/plan.js";
import { parseDeploymentConfig } from "../scripts/operations/config.js";

const config = parseDeploymentConfig({
  WREN_GITHUB_OWNER: "owner",
  WREN_GITHUB_REPO: "repo",
  WREN_GITHUB_BRANCH: "release",
  WREN_EXPECTED_ACCOUNT_ID: "123456789012",
  WREN_NON_INTERACTIVE: "true",
  WREN_ECR_OWNERSHIP: "external",
});

describe("deployment workflow command construction", () => {
  it("passes one consistent context set to every CDK phase", () => {
    const args = cdkContextArgs(config, "sha-abc123", false);
    expect(args).toEqual(expect.arrayContaining([
      "feedbackEngineImageTag=sha-abc123",
      "enableCicd=false",
      "ecrOwnership=external",
      "githubBranch=release",
      "region=ca-central-1",
    ]));
  });

  it("passes the safe prompt-cache context by default", () => {
    const args = cdkContextArgs(config, "sha-abc123", false);
    expect(args).toEqual(expect.arrayContaining([
      "cacheMode=observe",
      "cacheTtl=5m",
      "cacheEnabledWorkloads=",
    ]));
  });

  it("adds the bootstrap subject only when explicitly armed", () => {
    const safe = cdkContextArgs(config, "sha-abc123", false);
    const armed = cdkContextArgs(config, "sha-abc123", false, "subject-123");
    expect(safe.some((value) => value.includes("technicalAdminBootstrapSubject"))).toBe(false);
    expect(armed).toContain("technicalAdminBootstrapSubject=subject-123");
  });

  it("adds the custom-domain context only when a domain is configured", () => {
    const withoutDomain = cdkContextArgs(config, "sha-abc123", false);
    expect(withoutDomain.some((value) => value.startsWith("customDomain="))).toBe(false);

    const domainConfig = parseDeploymentConfig({
      WREN_GITHUB_OWNER: "owner",
      WREN_GITHUB_REPO: "repo",
      WREN_GITHUB_BRANCH: "release",
      WREN_EXPECTED_ACCOUNT_ID: "123456789012",
      WREN_NON_INTERACTIVE: "true",
      WREN_ECR_OWNERSHIP: "external",
      WREN_CUSTOM_DOMAIN: "cloud-inov.com",
    });
    expect(cdkContextArgs(domainConfig, "sha-abc123", false)).toContain("customDomain=cloud-inov.com");
  });

  it("adds the allowed-email-domains context only when configured", () => {
    const withoutDomains = cdkContextArgs(config, "sha-abc123", false);
    expect(withoutDomains.some((value) => value.startsWith("allowedEmailDomains="))).toBe(false);

    const domainConfig = parseDeploymentConfig({
      WREN_GITHUB_OWNER: "owner",
      WREN_GITHUB_REPO: "repo",
      WREN_GITHUB_BRANCH: "release",
      WREN_EXPECTED_ACCOUNT_ID: "123456789012",
      WREN_NON_INTERACTIVE: "true",
      WREN_ECR_OWNERSHIP: "external",
      WREN_ALLOWED_EMAIL_DOMAINS: "ubc.ca,alumni.ubc.ca",
    });
    expect(cdkContextArgs(domainConfig, "sha-abc123", false)).toContain(
      "allowedEmailDomains=ubc.ca,alumni.ubc.ca",
    );
  });

  it("prefers the custom domain over the Amplify default for the frontend host", () => {
    expect(primaryFrontendHost("cloud-inov.com", "main.d123.amplifyapp.com")).toBe("cloud-inov.com");
    expect(primaryFrontendHost(undefined, "main.d123.amplifyapp.com")).toBe("main.d123.amplifyapp.com");
    expect(primaryFrontendHost("cloud-inov.com", undefined)).toBe("cloud-inov.com");
    expect(primaryFrontendHost(undefined, undefined)).toBeUndefined();
  });

  it("classifies actionable Bedrock failures", () => {
    expect(classifyBedrockError(new Error("AccessDeniedException"))).toContain("IAM/SCP");
    expect(classifyBedrockError(new Error("ThrottlingException"))).toContain("quota");
    expect(classifyBedrockError(new Error("ValidationException"))).toContain("unavailable");
  });

  it("creates a stable non-secret deployment digest", () => {
    expect(deploymentConfigDigest(config)).toBe(deploymentConfigDigest({ ...config, githubToken: "different" }));
  });

  it("validates the Lambda pull statement for external ECR repositories", () => {
    const valid = JSON.stringify({
      Statement: [{
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
        Action: [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability",
        ],
      }],
    });
    expect(hasLambdaPullPolicy(valid)).toBe(true);
    expect(hasLambdaPullPolicy(JSON.stringify({ Statement: [] }))).toBe(false);
    expect(hasLambdaPullPolicy("not-json")).toBe(false);
  });

  it("requires the deployed pipeline stages in their safe execution order", () => {
    expect(() => assertPipelineStages({
      stageStates: ["Source", "Build", "Deploy", "UpdateLambda"].map((stageName) => ({ stageName })),
    })).not.toThrow();
    expect(() => assertPipelineStages({
      stageStates: ["Source", "Build", "UpdateLambda", "Deploy"].map((stageName) => ({ stageName })),
    })).toThrow("Pipeline stage verification failed");
  });
});

describe("required administrator cleanup", () => {
  it("runs cleanup and preserves the original failure when safety is proven", async () => {
    const cleanup = jest.fn(async () => undefined);

    await expect(runWithRequiredCleanup(
      async () => { throw new Error("initial administrator lookup failed"); },
      cleanup,
    )).rejects.toThrow("initial administrator lookup failed");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("runs cleanup after a successful administrator probe", async () => {
    const cleanup = jest.fn(async () => undefined);

    await expect(runWithRequiredCleanup(async () => "verified", cleanup)).resolves.toBe("verified");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("escalates cleanup failure as an explicit security action", async () => {
    const operation = runWithRequiredCleanup(
      async () => { throw new Error("expired access token"); },
      async () => { throw new Error("authorizer readback failed"); },
    );

    await expect(operation).rejects.toBeInstanceOf(ActionRequiredError);
    await expect(operation).rejects.toThrow("TechnicalAdmin bootstrap may still be armed");
    await expect(operation).rejects.toThrow("expired access token");
    await expect(operation).rejects.toThrow("authorizer readback failed");
  });
});

describe("browser CORS preflight validation", () => {
  const origin = "https://main.example.amplifyapp.com";

  it("accepts exact origin and case-insensitive method/header tokens", () => {
    const headers = new Headers({
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "OPTIONS, get",
      "access-control-allow-headers": "Content-Type, AUTHORIZATION, x-requested-with",
    });
    expect(() => assertCorsPreflight(
      headers,
      origin,
      "GET",
      ["authorization", "content-type"],
    )).not.toThrow();
  });

  it.each(["*", "https://other.example.com"])("rejects mismatched origin %s", (allowedOrigin) => {
    const headers = new Headers({
      "access-control-allow-origin": allowedOrigin,
      "access-control-allow-methods": "GET",
      "access-control-allow-headers": "authorization,content-type",
    });
    expect(() => assertCorsPreflight(headers, origin, "GET", ["authorization", "content-type"]))
      .toThrow("expected exactly");
  });

  it("rejects substring methods and missing requested headers", () => {
    const substringMethod = new Headers({
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "TARGET",
      "access-control-allow-headers": "authorization,content-type",
    });
    expect(() => assertCorsPreflight(
      substringMethod,
      origin,
      "GET",
      ["authorization", "content-type"],
    )).toThrow("method GET");

    const missingAuthorization = new Headers({
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET",
      "access-control-allow-headers": "content-type",
    });
    expect(() => assertCorsPreflight(
      missingAuthorization,
      origin,
      "GET",
      ["authorization", "content-type"],
    )).toThrow("authorization");
  });
});

describe("successful deployment checkpoint freshness", () => {
  it("recognizes only checkpoints with every deploy stage complete", () => {
    let checkpoint = newCheckpoint("deploy", config, "123456789012");
    expect(isCompletedDeployCheckpoint(checkpoint)).toBe(false);
    for (const stage of DEPLOY_STAGES) checkpoint = updateStage(checkpoint, stage, "complete");
    expect(isCompletedDeployCheckpoint(checkpoint)).toBe(true);
  });

  it("uses millisecond-precise generated tags and preserves explicit tags", () => {
    const first = newCheckpoint("deploy", config, "123456789012", new Date("2026-09-01T12:00:00.001Z"));
    const second = newCheckpoint("deploy", config, "123456789012", new Date("2026-09-01T12:00:00.002Z"));
    expect(sourceTag(first)).not.toBe(sourceTag(second));
    expect(sourceTag(first, "release-fixed")).toBe("release-fixed");
  });
});

describe("CodeBuild bootstrap image build (S3 source snapshot)", () => {
  const okResult = (stdout = ""): CommandResult => ({ exitCode: 0, stdout, stderr: "", durationMs: 1 });
  const cleanSha = "0123456789abcdef0123456789abcdef01234567";

  it("derives a stable commit-scoped tag and honors an explicit override", () => {
    expect(commitImageTag(cleanSha)).toBe("src-0123456789ab");
    expect(resolveImageTagForCommit(cleanSha)).toBe("src-0123456789ab");
    expect(resolveImageTagForCommit(cleanSha, "release-fixed")).toBe("release-fixed");
  });

  it("pins the deploy to the recorded digest, falling back to tag then source tag", () => {
    const base = newCheckpoint("deploy", config, "123456789012", new Date("2026-09-01T00:00:00.000Z"));
    // Digest present → the deployed Lambda is pinned by the immutable digest.
    const withDigest = { ...base, image: { tag: "src-abc", digest: "sha256:deadbeef", sourceCommit: "abc" } };
    expect(imageDeployRef(withDigest)).toBe("sha256:deadbeef");
    // Digest absent but a tag recorded → use the tag.
    const withTagOnly = { ...base, image: { tag: "src-abc", digest: "" } as never };
    expect(imageDeployRef(withTagOnly)).toBe("src-abc");
    // No image at all → computed source tag (direct-CDK/bootstrap path).
    expect(imageDeployRef(base, "release-fixed")).toBe("release-fixed");
  });

  it("reuses a checkpoint image only when its recorded commit matches", () => {
    expect(checkpointImageMatchesCommit({ tag: "t", digest: "d", sourceCommit: cleanSha }, cleanSha)).toBe(true);
    // Different commit → rebuild (never deploy the wrong commit's image).
    expect(checkpointImageMatchesCommit({ tag: "t", digest: "d", sourceCommit: "deadbeef" }, cleanSha)).toBe(false);
    // Legacy v1 image with no sourceCommit → commit unknown → rebuild.
    expect(checkpointImageMatchesCommit({ tag: "t", digest: "d" }, cleanSha)).toBe(false);
    expect(checkpointImageMatchesCommit(undefined, cleanSha)).toBe(false);
  });

  it("resolves the HEAD SHA when the working tree is clean", async () => {
    const calls: string[][] = [];
    const runner = {
      run: async (spec: CommandSpec): Promise<CommandResult> => {
        calls.push([spec.executable, ...(spec.args ?? [])]);
        if (spec.args?.[0] === "status") return okResult("");
        return okResult(`${cleanSha}\n`);
      },
    };
    await expect(resolveCleanCommit(runner, "/repo")).resolves.toBe(cleanSha);
    expect(calls).toEqual([
      ["git", "status", "--porcelain", "--untracked-files=all"],
      ["git", "rev-parse", "HEAD"],
    ]);
  });

  it("refuses to build from a dirty working tree", async () => {
    const runner = {
      run: async (spec: CommandSpec): Promise<CommandResult> =>
        spec.args?.[0] === "status" ? okResult(" M backend/engine/python/handler.py\n") : okResult(cleanSha),
    };
    await expect(resolveCleanCommit(runner, "/repo")).rejects.toThrow(ActionRequiredError);
    await expect(resolveCleanCommit(runner, "/repo")).rejects.toThrow("uncommitted or untracked changes");
  });

  it("fails clearly when the bootstrap assets bucket is unavailable", async () => {
    const aws = { command: async () => { throw new Error("Not Found"); } };
    await expect(verifyBootstrapAssetsBucket(aws, "cdk-hnb659fds-assets-123-ca-central-1"))
      .rejects.toThrow(ActionRequiredError);
    await expect(verifyBootstrapAssetsBucket(aws, "cdk-hnb659fds-assets-123-ca-central-1"))
      .rejects.toThrow("cdk-hnb659fds-assets-123-ca-central-1");
  });

  it("archives the exact SHA and uploads under a SHA-based key (no VersionId)", async () => {
    const runnerCalls: string[][] = [];
    const awsCalls: string[][] = [];
    const deps = {
      repoRoot: "/repo",
      runner: {
        run: async (spec: CommandSpec): Promise<CommandResult> => {
          runnerCalls.push([spec.executable, ...(spec.args ?? [])]);
          return okResult();
        },
      },
      aws: {
        json: async () => ({}) as never,
        tryJson: async () => undefined,
        command: async (args: readonly string[]): Promise<CommandResult> => {
          awsCalls.push([...args]);
          return okResult();
        },
      },
    };
    const result = await uploadCommitSnapshot(deps, "the-bucket", "wren-bootstrap-source/wren-dev", cleanSha);

    expect(result).toEqual({ bucket: "the-bucket", key: `wren-bootstrap-source/wren-dev/${cleanSha}.zip` });
    // git archive is pinned to the resolved SHA.
    const archive = runnerCalls.find((c) => c[1] === "archive");
    expect(archive).toContain(cleanSha);
    expect(archive).toContain("--format=zip");
    // Upload uses `s3 cp` (not `s3api put-object --body fileb://`, which is
    // broken on the Windows AWS CLI v2/Python 3.14 build) and targets the
    // SHA-keyed s3:// destination. No VersionId is requested/relied on.
    const put = awsCalls.find((c) => c[0] === "s3" && c[1] === "cp");
    expect(put).toBeDefined();
    expect(put?.[put.length - 1]).toBe(`s3://the-bucket/wren-bootstrap-source/wren-dev/${cleanSha}.zip`);
    expect(put?.join(" ")).not.toContain("version-id");
  });

  it("starts a build against the SHA-keyed S3 source and resolves on SUCCEEDED", async () => {
    const startArgs: string[] = [];
    const aws = {
      json: async (args: readonly string[]): Promise<never> => {
        if (args[1] === "start-build") {
          startArgs.push(...args);
          return { build: { id: "build-1" } } as never;
        }
        return { builds: [{ buildStatus: "SUCCEEDED" }] } as never;
      },
    };
    await expect(runBootstrapImageBuild(
      aws,
      "wren-dev-bootstrap-image",
      { bucket: "the-bucket", key: `wren-bootstrap-source/wren-dev/${cleanSha}.zip` },
      "src-0123456789ab",
      { sleep: async () => undefined },
    )).resolves.toBeUndefined();

    expect(startArgs).toContain("--source-location-override");
    expect(startArgs).toContain(`the-bucket/wren-bootstrap-source/wren-dev/${cleanSha}.zip`);
    expect(startArgs.join(" ")).toContain("IMAGE_TAG,value=src-0123456789ab");
    expect(startArgs.join(" ")).not.toContain("source-version");
  });

  it("throws with the build id and logs link when the build fails", async () => {
    const aws = {
      json: async (args: readonly string[]): Promise<never> =>
        args[1] === "start-build"
          ? ({ build: { id: "build-2" } } as never)
          : ({ builds: [{ buildStatus: "FAILED", logs: { deepLink: "https://logs.example/build-2" } }] } as never),
    };
    await expect(runBootstrapImageBuild(
      aws,
      "wren-dev-bootstrap-image",
      { bucket: "b", key: "k.zip" },
      "src-abc",
      { sleep: async () => undefined },
    )).rejects.toThrow("build-2");
  });
});

describe("cache-aware synthetic smoke (plan §17/§20)", () => {
  it("is skipped in observe and off, and only runs in explicit with a workload enabled", () => {
    // Skipped: safe default posture.
    expect(shouldRunCacheSmoke({ cacheMode: "observe", cacheEnabledWorkloads: ["ask_wren"] }))
      .toBe(false);
    // Skipped: rollback.
    expect(shouldRunCacheSmoke({ cacheMode: "off", cacheEnabledWorkloads: ["ask_wren"] }))
      .toBe(false);
    // Skipped: explicit but no workload can ever cache.
    expect(shouldRunCacheSmoke({ cacheMode: "explicit", cacheEnabledWorkloads: [] }))
      .toBe(false);
    // Runs: explicit AND a workload enabled.
    expect(shouldRunCacheSmoke({ cacheMode: "explicit", cacheEnabledWorkloads: ["ask_wren"] }))
      .toBe(true);
  });

  it("builds a benign synthetic body: fixed prompt over the min prefix, checkpoint on system only, no student data", () => {
    const body = buildCacheSmokeRequestBody("5m") as {
      system: Array<{ type: string; text: string; cache_control?: unknown }>;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };

    // Single system block carrying the ONLY cache checkpoint.
    expect(body.system).toHaveLength(1);
    expect(body.system[0]!.cache_control).toEqual({ type: "ephemeral", ttl: "5m" });
    // The user message carries no marker and no sensitive content.
    expect(body.messages[0]!.content).toBe("Reply with OK.");
    expect(JSON.stringify(body.messages)).not.toContain("cache_control");
    // The prompt is large (exceeds the 1,024-token min prefix by character proxy).
    expect(cacheSmokeSystemPrompt().length).toBeGreaterThan(4096);
    // The synthetic prompt describes itself as a probe with no user data.
    expect(cacheSmokeSystemPrompt()).toContain("no user or reference data");
  });

  it("honors the 1h ttl on the checkpoint", () => {
    const body = buildCacheSmokeRequestBody("1h") as {
      system: Array<{ cache_control: { ttl: string } }>;
    };
    expect(body.system[0]!.cache_control.ttl).toBe("1h");
  });

  it("parses the Anthropic usage block, tolerating a missing usage field", () => {
    expect(parseCacheSmokeUsage(JSON.stringify({ usage: { cache_read_input_tokens: 5 } })))
      .toEqual({ cache_read_input_tokens: 5 });
    expect(parseCacheSmokeUsage(JSON.stringify({}))).toEqual({});
  });

  it("demonstrates cache only when the SECOND request reports cache-read tokens", () => {
    const demonstrated = evaluateCacheSmoke(
      { cache_creation_input_tokens: 1500, cache_read_input_tokens: 0 },
      { cache_creation_input_tokens: 0, cache_read_input_tokens: 1500 },
    );
    expect(demonstrated.cacheDemonstrated).toBe(true);
    expect(demonstrated.firstWriteTokens).toBe(1500);
    expect(demonstrated.secondReadTokens).toBe(1500);

    const notDemonstrated = evaluateCacheSmoke(
      { cache_creation_input_tokens: 1500, cache_read_input_tokens: 0 },
      { cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    );
    expect(notDemonstrated.cacheDemonstrated).toBe(false);
    expect(notDemonstrated.detail).toContain("No cache read");
  });
});