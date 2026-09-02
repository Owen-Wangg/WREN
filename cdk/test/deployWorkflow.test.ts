import {
  assertCorsPreflight,
  assertPipelineStages,
  classifyBedrockError,
  cdkContextArgs,
  deploymentConfigDigest,
  hasLambdaPullPolicy,
  isCompletedDeployCheckpoint,
  runWithRequiredCleanup,
  sourceTag,
} from "../scripts/operations/deployWorkflow.js";
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

  it("adds the bootstrap subject only when explicitly armed", () => {
    const safe = cdkContextArgs(config, "sha-abc123", false);
    const armed = cdkContextArgs(config, "sha-abc123", false, "subject-123");
    expect(safe.some((value) => value.includes("technicalAdminBootstrapSubject"))).toBe(false);
    expect(armed).toContain("technicalAdminBootstrapSubject=subject-123");
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