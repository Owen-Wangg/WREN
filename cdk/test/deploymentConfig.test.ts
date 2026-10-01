import { parseDeploymentConfig, publicDeploymentConfig } from "../scripts/operations/config.js";
import { configFingerprint } from "../scripts/operations/checkpoint.js";
import { redactText, withoutSecretEnvironment } from "../scripts/operations/redaction.js";
import { runCommand } from "../scripts/operations/runner.js";

/** GitHub settings without a signup allowlist, for the allowlist-specific tests. */
const githubNoAllowlist = {
  WREN_GITHUB_OWNER: "example-owner",
  WREN_GITHUB_REPO: "WREN",
};

const github = {
  ...githubNoAllowlist,
  // Deploys require a signup allowlist (empty denies every signup).
  WREN_ALLOWED_EMAIL_DOMAINS: "example.ca",
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

  it("defaults prompt caching to the safe observe/5m/none posture", () => {
    const config = parseDeploymentConfig(github);
    expect(config.cacheMode).toBe("observe");
    expect(config.cacheTtl).toBe("5m");
    expect(config.cacheEnabledWorkloads).toEqual([]);
  });

  it("resolves explicit prompt-cache overrides and normalizes workload tokens", () => {
    const config = parseDeploymentConfig({
      ...github,
      WREN_CACHE_MODE: "explicit",
      WREN_CACHE_TTL: "1h",
      WREN_CACHE_ENABLED_WORKLOADS: "ask-wren, feedback_primary",
    });
    expect(config.cacheMode).toBe("explicit");
    expect(config.cacheTtl).toBe("1h");
    expect(config.cacheEnabledWorkloads).toEqual(["ask_wren", "feedback_primary"]);
  });

  it("resolves the off rollback mode and rejects invalid cache values", () => {
    expect(parseDeploymentConfig({ ...github, WREN_CACHE_MODE: "off" }).cacheMode).toBe("off");
    expect(() => parseDeploymentConfig({ ...github, WREN_CACHE_MODE: "on" })).toThrow("WREN_CACHE_MODE");
    expect(() => parseDeploymentConfig({ ...github, WREN_CACHE_TTL: "10m" })).toThrow("WREN_CACHE_TTL");
    expect(() => parseDeploymentConfig({ ...github, WREN_CACHE_ENABLED_WORKLOADS: "bogus" }))
      .toThrow("unknown workload");
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
    const bothDisabled = parseDeploymentConfig({
      WREN_ENABLE_AMPLIFY: "false",
      WREN_ENABLE_CICD: "false",
      WREN_ALLOWED_EMAIL_DOMAINS: "example.ca",
    });
    expect(bothDisabled.enableAmplify).toBe(false);
    expect(bothDisabled.enableCicd).toBe(false);
  });

  it("parses an optional custom domain and omits it when absent", () => {
    expect(parseDeploymentConfig(github).customDomain).toBeUndefined();
    const config = parseDeploymentConfig({ ...github, WREN_CUSTOM_DOMAIN: "cloud-inov.com" });
    expect(config.customDomain).toBe("cloud-inov.com");
  });

  it.each([
    "https://cloud-inov.com",
    "Cloud-Inov.com",
    "cloud inov.com",
    "cloud-inov.com/app",
    "cloud-inov.com.",
    "cloudinov",
    "-cloud.com",
    `${"a".repeat(64)}.com`,
  ])("rejects a malformed custom domain (%s)", (raw) => {
    expect(() => parseDeploymentConfig({ ...github, WREN_CUSTOM_DOMAIN: raw })).toThrow("WREN_CUSTOM_DOMAIN");
  });

  it("accepts a label at the maximum 63-character length", () => {
    const domain = `${"a".repeat(63)}.com`;
    expect(parseDeploymentConfig({ ...github, WREN_CUSTOM_DOMAIN: domain }).customDomain).toBe(domain);
  });

  it("accepts a multi-label subdomain custom domain", () => {
    const config = parseDeploymentConfig({ ...github, WREN_CUSTOM_DOMAIN: "wren.cloud-inov.com" });
    expect(config.customDomain).toBe("wren.cloud-inov.com");
  });

  it("echoes the custom domain in public configuration, defaulting when unset", () => {
    expect(publicDeploymentConfig(parseDeploymentConfig(github)).customDomain).toBe("(amplify default)");
    const withDomain = parseDeploymentConfig({ ...github, WREN_CUSTOM_DOMAIN: "cloud-inov.com" });
    expect(publicDeploymentConfig(withDomain).customDomain).toBe("cloud-inov.com");
  });

  it("changes the checkpoint fingerprint when the custom domain changes", () => {
    const base = parseDeploymentConfig(github);
    const withDomain = parseDeploymentConfig({ ...github, WREN_CUSTOM_DOMAIN: "cloud-inov.com" });
    expect(configFingerprint(withDomain)).not.toBe(configFingerprint(base));
  });

  it("parses the signup email-domain allowlist", () => {
    const config = parseDeploymentConfig({
      ...github,
      WREN_ALLOWED_EMAIL_DOMAINS: "ubc.ca, alumni.ubc.ca",
    });
    expect(config.allowedEmailDomains).toEqual(["ubc.ca", "alumni.ubc.ca"]);
  });

  it("requires a non-empty allowlist for deploy", () => {
    expect(() => parseDeploymentConfig(githubNoAllowlist)).toThrow(
      "WREN_ALLOWED_EMAIL_DOMAINS is required",
    );
    expect(() =>
      parseDeploymentConfig({ ...githubNoAllowlist, WREN_ALLOWED_EMAIL_DOMAINS: "  " }),
    ).toThrow("WREN_ALLOWED_EMAIL_DOMAINS is required");
  });

  it("does not require an allowlist for undeploy", () => {
    expect(parseDeploymentConfig(githubNoAllowlist, "undeploy").allowedEmailDomains).toEqual([]);
  });

  it.each([
    "https://ubc.ca",
    "UBC.CA",
    "ubc.ca/app",
    "ubc.ca.",
    "ubc",
    "*.ubc.ca",
  ])("rejects a malformed allowed email domain (%s)", (raw) => {
    expect(() =>
      parseDeploymentConfig({ ...github, WREN_ALLOWED_EMAIL_DOMAINS: raw }),
    ).toThrow("WREN_ALLOWED_EMAIL_DOMAINS");
  });

  it("echoes allowed email domains in public configuration", () => {
    expect(
      publicDeploymentConfig(parseDeploymentConfig(githubNoAllowlist, "undeploy")).allowedEmailDomains,
    ).toBe("(none: signup denied)");
    const restricted = parseDeploymentConfig({
      ...github,
      WREN_ALLOWED_EMAIL_DOMAINS: "ubc.ca",
    });
    expect(publicDeploymentConfig(restricted).allowedEmailDomains).toBe("ubc.ca");
  });

  it("changes the checkpoint fingerprint when allowed email domains change", () => {
    const base = parseDeploymentConfig(github);
    const restricted = parseDeploymentConfig({
      ...github,
      WREN_ALLOWED_EMAIL_DOMAINS: "ubc.ca",
    });
    expect(configFingerprint(restricted)).not.toBe(configFingerprint(base));
  });

  it("rejects an admin email outside the signup allowlist", () => {
    expect(() =>
      parseDeploymentConfig({
        ...github,
        WREN_ALLOWED_EMAIL_DOMAINS: "ubc.ca",
        WREN_ADMIN_EMAIL: "admin@example.com",
      }),
    ).toThrow("WREN_ADMIN_EMAIL");
  });

  it("accepts an admin email on the signup allowlist", () => {
    const config = parseDeploymentConfig({
      ...github,
      WREN_ALLOWED_EMAIL_DOMAINS: "ubc.ca",
      WREN_ADMIN_EMAIL: "admin@ubc.ca",
    });
    expect(config.adminEmail).toBe("admin@ubc.ca");
  });

  it("never includes tokens in public configuration", () => {
    const config = parseDeploymentConfig({
      ...github,
      WREN_GITHUB_TOKEN: "github-secret",
    });
    const serialized = JSON.stringify(publicDeploymentConfig(config));
    expect(serialized).not.toContain("github-secret");
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
