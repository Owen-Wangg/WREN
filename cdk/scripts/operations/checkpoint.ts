import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import type { DeploymentConfig } from "./config.js";
import { publicDeploymentConfig } from "./config.js";

export type Operation = "deploy" | "undeploy";
export type StageState = "pending" | "complete" | "action-required" | "failed";

export interface StageCheckpoint {
  readonly state: StageState;
  readonly updatedAt: string;
  readonly message?: string;
}

/** Current checkpoint schema version. */
export const CHECKPOINT_SCHEMA_VERSION = 2 as const;

/**
 * The image recorded in a checkpoint. `digest` is the authoritative,
 * immutable artifact identity; `tag` is a mutable convenience label; and
 * `sourceCommit` ties the image to the exact Git revision it was built from so
 * a rerun can prove the recorded image belongs to the revision being deployed.
 *
 * `sourceCommit` is optional only to tolerate a legacy v1 checkpoint on disk
 * (image built before this field existed): when it is absent the workflow must
 * treat the commit as unknown and rebuild rather than reuse the image.
 */
export interface CheckpointImage {
  readonly tag: string;
  readonly digest: string;
  readonly sourceCommit?: string;
}

export interface DeploymentCheckpoint {
  readonly schemaVersion: 1 | 2;
  readonly operation: Operation;
  readonly accountId: string;
  readonly region: string;
  readonly stackPrefix: string;
  readonly configFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stages: Readonly<Record<string, StageCheckpoint>>;
  readonly image?: CheckpointImage;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export function configFingerprint(config: DeploymentConfig): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(publicDeploymentConfig(config))))
    .digest("hex");
}

export function newCheckpoint(
  operation: Operation,
  config: DeploymentConfig,
  accountId: string,
  now = new Date(),
): DeploymentCheckpoint {
  const timestamp = now.toISOString();
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    operation,
    accountId,
    region: config.region,
    stackPrefix: config.stackPrefix,
    configFingerprint: configFingerprint(config),
    createdAt: timestamp,
    updatedAt: timestamp,
    stages: {},
  };
}

export function updateStage(
  checkpoint: DeploymentCheckpoint,
  stage: string,
  state: StageState,
  message?: string,
  now = new Date(),
): DeploymentCheckpoint {
  const updatedAt = now.toISOString();
  return {
    ...checkpoint,
    updatedAt,
    stages: {
      ...checkpoint.stages,
      [stage]: { state, updatedAt, ...(message ? { message } : {}) },
    },
  };
}

export function withImage(
  checkpoint: DeploymentCheckpoint,
  tag: string,
  digest: string,
  sourceCommit: string,
  now = new Date(),
): DeploymentCheckpoint {
  return {
    ...checkpoint,
    // Writing a v2-shaped image ({tag,digest,sourceCommit}) upgrades the
    // checkpoint's schema label so it matches the payload — e.g. when a
    // recovered legacy v1 checkpoint records a new image.
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    image: { tag, digest, sourceCommit },
  };
}

export function assertCheckpointMatches(
  checkpoint: DeploymentCheckpoint,
  operation: Operation,
  config: DeploymentConfig,
  accountId: string,
): void {
  const mismatch =
    (checkpoint.schemaVersion !== 1 && checkpoint.schemaVersion !== 2) ||
    checkpoint.operation !== operation ||
    checkpoint.accountId !== accountId ||
    checkpoint.region !== config.region ||
    checkpoint.stackPrefix !== config.stackPrefix ||
    checkpoint.configFingerprint !== configFingerprint(config);
  if (mismatch) {
    throw new Error("Existing WREN deployment checkpoint does not match this operation, account, region, prefix, or configuration.");
  }
}

export class CheckpointStore {
  public readonly checkpointPath: string;
  private readonly lockPath: string;
  private lockFd: number | undefined;

  public constructor(
    rootDirectory: string,
    operation: Operation,
    accountId: string,
    region: string,
    stackPrefix: string,
  ) {
    const safeKey = `${accountId}-${region}-${stackPrefix}`.replace(/[^A-Za-z0-9_.-]/g, "_");
    const directory = path.join(rootDirectory, ".wren-deploy");
    this.checkpointPath = path.join(directory, `${safeKey}-${operation}.json`);
    this.lockPath = path.join(directory, `${safeKey}.lock`);
  }

  public acquireLock(): void {
    this.acquireLockInternal(true);
  }

  private acquireLockInternal(allowStaleRecovery: boolean): void {
    mkdirSync(path.dirname(this.lockPath), { recursive: true });
    try {
      this.lockFd = openSync(this.lockPath, "wx", 0o600);
      writeSync(this.lockFd, JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        startedAt: new Date().toISOString(),
      }));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (allowStaleRecovery && this.reclaimStaleLocalLock()) {
        this.acquireLockInternal(false);
        return;
      }
      throw new Error(`Another WREN operation holds ${this.lockPath}.`);
    }
  }

  private reclaimStaleLocalLock(): boolean {
    try {
      const metadata = JSON.parse(readFileSync(this.lockPath, "utf8")) as {
        readonly pid?: unknown;
        readonly hostname?: unknown;
      };
      if (typeof metadata.pid !== "number" || !Number.isSafeInteger(metadata.pid) || metadata.pid <= 0) {
        return false;
      }
      if (typeof metadata.hostname !== "string" || metadata.hostname !== hostname()) return false;
      try {
        process.kill(metadata.pid, 0);
        return false;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") return false;
      }
      rmSync(this.lockPath);
      return true;
    } catch {
      return false;
    }
  }

  public releaseLock(): void {
    if (this.lockFd !== undefined) {
      closeSync(this.lockFd);
      this.lockFd = undefined;
    }
    rmSync(this.lockPath, { force: true });
  }

  public load(): DeploymentCheckpoint | undefined {
    if (!existsSync(this.checkpointPath)) return undefined;
    const parsed = JSON.parse(readFileSync(this.checkpointPath, "utf8")) as DeploymentCheckpoint;
    // Accept both the current v2 and a legacy v1 (whose `image` carries no
    // `sourceCommit`); the workflow treats a commit-less image as "unknown
    // commit" and rebuilds rather than reusing it.
    if ((parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) || typeof parsed.stages !== "object") {
      throw new Error(`Unsupported or malformed WREN checkpoint: ${this.checkpointPath}`);
    }
    return parsed;
  }

  public save(checkpoint: DeploymentCheckpoint): void {
    mkdirSync(path.dirname(this.checkpointPath), { recursive: true });
    const temporary = `${this.checkpointPath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.checkpointPath);
  }

  public retireCheckpoint(): void {
    rmSync(this.checkpointPath, { force: true });
  }
}
