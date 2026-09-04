import { parseDeploymentConfig, publicDeploymentConfig } from "../scripts/operations/config.js";
import { redactText, withoutSecretEnvironment } from "../scripts/operations/redaction.js";
import { runCommand } from "../scripts/operations/runner.js";

const github = {
  WREN_GITHUB_OWNER: "example-owner",
  WREN_GITHUB_REPO: "WREN",
};

describe("deployment configuration", () => {
  it("applies safe development defaults", () => {
    const config = parseDeploymentConfig(github);
    expect(config).toMatchObject({
      region: "ca-central-1",
      projectName: "wren",
      environmentName: "dev",
      stackPrefix: "wren-dev",
      enableAmplify: true,
      enableCicd: true,
      ecrOwnership: "managed",
      dryRun: false,
    });
  });

  it.each(["TRUE", "1", "yes", ""])('rejects malformed booleans except an empty value (%s)', (raw) => {
    const env = { ...github, WREN_ENABLE_CICD: raw };
    if (raw === "") expect(parseDeploymentConfig(env).enableCicd).toBe(true);
    else expect(() => parseDeploymentConfig(env)).toThrow("WREN_ENABLE_CICD");
  });

  it("builds the pipeline by default and allows explicit opt-out", () => {
    expect(parseDeploymentConfig(github).enableCicd).toBe(true);
    expect(parseDeploymentConfig({ ...github, WREN_ENABLE_CICD: "false" }).enableCicd).toBe(false);
  });

  it("requires an expected account in CI and production", () => {
    expect(() => parseDeploymentConfig({ ...github, CI: "true" })).toThrow("WREN_EXPECTED_ACCOUNT_ID");
    expect(() => parseDeploymentConfig({ ...github, WREN_ENVIRONMENT: "prod" })).toThrow("WREN_EXPECTED_ACCOUNT_ID");
  });

  it("rejects malformed account IDs and inconsistent prefixes", () => {
    expect(() => parseDeploymentConfig({ ...github, WREN_EXPECTED_ACCOUNT_ID: "123" })).toThrow("12-digit");
    expect(() => parseDeploymentConfig({ ...github, WREN_STACK_PREFIX: "other-dev" })).toThrow("derived prefix");
  });

  it("requires GitHub source settings for hosted deployment", () => {
    expect(() => parseDeploymentConfig({})).toThrow("WREN_GITHUB_OWNER");
    // CI/CD is on by default, so disabling Amplify alone still requires GitHub vars.
    expect(() => parseDeploymentConfig({ WREN_ENABLE_AMPLIFY: "false" })).toThrow("WREN_GITHUB_OWNER");
    // GitHub vars become optional only when both Amplify and CI/CD are disabled.
    const bothDisabled = parseDeploymentConfig({ WREN_ENABLE_AMPLIFY: "false", WREN_ENABLE_CICD: "false" });
    expect(bothDisabled.enableAmplify).toBe(false);
    expect(bothDisabled.enableCicd).toBe(false);
  });

  it("never includes tokens in public configuration", () => {
    const config = parseDeploymentConfig({
      ...github,
      WREN_GITHUB_TOKEN: "github-secret",
      WREN_SMOKE_ACCESS_TOKEN: "access-secret",
    });
    const serialized = JSON.stringify(publicDeploymentConfig(config));
    expect(serialized).not.toContain("github-secret");
    expect(serialized).not.toContain("access-secret");
  });
});

describe("deployment command safety", () => {
  it("redacts all configured secrets", () => {
    expect(redactText("token-a then token-b", ["token-a", "token-b"])).toBe("[REDACTED] then [REDACTED]");
  });

  it("removes deployment secrets from unrelated subprocess environments", () => {
    const env = withoutSecretEnvironment({
      SAFE: "value",
      WREN_GITHUB_TOKEN: "github-secret",
      WREN_SMOKE_ACCESS_TOKEN: "access-secret",
    });
    expect(env).toEqual({ SAFE: "value" });
  });

  it("runs commands without shell syntax", async () => {
    const result = await runCommand({
      executable: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", "safe value; not a command"],
    });
    expect(result.stdout).toBe("safe value; not a command");
  });
});
