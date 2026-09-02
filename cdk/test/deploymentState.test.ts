import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import {
  assertCheckpointMatches,
  CheckpointStore,
  configFingerprint,
  newCheckpoint,
  updateStage,
  withImage,
} from "../scripts/operations/checkpoint.js";
import { classifyStackStatus } from "../scripts/operations/discovery.js";
import { parseDeploymentConfig } from "../scripts/operations/config.js";
import { pendingStages } from "../scripts/operations/plan.js";

const config = parseDeploymentConfig({
  WREN_ENABLE_AMPLIFY: "false",
  WREN_EXPECTED_ACCOUNT_ID: "123456789012",
});

describe("deployment checkpoints", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "wren-checkpoint-"));
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("writes and reloads an atomic non-secret checkpoint", () => {
    const store = new CheckpointStore(directory, "deploy", "123456789012", config.region, config.stackPrefix);
    let checkpoint = newCheckpoint("deploy", config, "123456789012", new Date("2026-01-01T00:00:00Z"));
    checkpoint = updateStage(checkpoint, "preflight", "complete", undefined, new Date("2026-01-01T00:01:00Z"));
    checkpoint = withImage(checkpoint, "abc123", "sha256:digest", new Date("2026-01-01T00:02:00Z"));
    store.save(checkpoint);

    expect(store.load()).toEqual(checkpoint);
    const raw = readFileSync(store.checkpointPath, "utf8");
    expect(raw).not.toContain("WREN_GITHUB_TOKEN");
    expect(raw).not.toContain("WREN_SMOKE_ACCESS_TOKEN");
  });

  it("rejects stale configuration and account state", () => {
    const checkpoint = newCheckpoint("deploy", config, "123456789012");
    expect(() => assertCheckpointMatches(checkpoint, "deploy", config, "999999999999")).toThrow("does not match");
    const changed = parseDeploymentConfig({ WREN_ENABLE_AMPLIFY: "false", WREN_ENVIRONMENT: "staging" });
    expect(configFingerprint(changed)).not.toBe(configFingerprint(config));
  });

  it("recovers a stale lock owned by a dead local process", () => {
    const store = new CheckpointStore(directory, "deploy", "123456789012", config.region, config.stackPrefix);
    const lockDirectory = path.join(directory, ".wren-deploy");
    mkdirSync(lockDirectory, { recursive: true });
    const lockPath = path.join(
      lockDirectory,
      `123456789012-${config.region}-${config.stackPrefix}.lock`,
    );
    writeFileSync(lockPath, JSON.stringify({
      pid: 2_147_483_647,
      hostname: hostname(),
      startedAt: "2020-01-01T00:00:00.000Z",
    }));

    expect(() => store.acquireLock()).not.toThrow();
    store.releaseLock();
  });

  it("prevents concurrent operations with a lock", () => {
    const first = new CheckpointStore(directory, "deploy", "123456789012", config.region, config.stackPrefix);
    const second = new CheckpointStore(directory, "deploy", "123456789012", config.region, config.stackPrefix);
    first.acquireLock();
    expect(() => second.acquireLock()).toThrow("Another WREN operation");
    first.releaseLock();
    expect(() => second.acquireLock()).not.toThrow();
    second.releaseLock();
  });
});

describe("live deployment state classification", () => {
  it.each([
    [undefined, "absent"],
    ["CREATE_COMPLETE", "complete"],
    ["UPDATE_COMPLETE", "complete"],
    ["CREATE_IN_PROGRESS", "in-progress"],
    ["UPDATE_ROLLBACK_COMPLETE", "retryable"],
    ["ROLLBACK_COMPLETE", "retryable"],
    ["UPDATE_ROLLBACK_FAILED", "blocked"],
    ["DELETE_FAILED", "blocked"],
    ["UNKNOWN_STATUS", "blocked"],
  ] as const)("classifies %s as %s", (status, disposition) => {
    expect(classifyStackStatus(status)).toBe(disposition);
  });

  it("derives remaining ordered stages", () => {
    expect(pendingStages(new Set(["preflight", "bedrock"])).slice(0, 2)).toEqual([
      "bootstrap-data-region",
      "bootstrap-us-east-1",
    ]);
  });
});

describe("checkpoint retirement and strict lock ownership", () => {
  it("retires a successful checkpoint idempotently", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "wren-retire-test-"));
    try {
      const store = new CheckpointStore(directory, "deploy", "123456789012", config.region, config.stackPrefix);
      store.save(newCheckpoint("deploy", config, "123456789012"));
      expect(store.load()).toBeDefined();
      store.retireCheckpoint();
      store.retireCheckpoint();
      expect(store.load()).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["numeric", 1234],
    ["empty", ""],
    ["other host", "another-host.example"],
  ])("does not reclaim a dead-PID lock with %s hostname metadata", (_label, lockHostname) => {
    const directory = mkdtempSync(path.join(tmpdir(), "wren-lock-owner-test-"));
    try {
      const store = new CheckpointStore(directory, "deploy", "123456789012", config.region, config.stackPrefix);
      const lockDirectory = path.join(directory, ".wren-deploy");
      mkdirSync(lockDirectory, { recursive: true });
      const lockPath = path.join(
        lockDirectory,
        `123456789012-${config.region}-${config.stackPrefix}.lock`,
      );
      const metadata: Record<string, unknown> = { pid: 2_147_483_647 };
      if (lockHostname !== undefined) metadata.hostname = lockHostname;
      writeFileSync(lockPath, JSON.stringify(metadata));

      expect(() => store.acquireLock()).toThrow("Another WREN operation");
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});