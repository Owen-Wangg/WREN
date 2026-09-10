import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { redactText, withoutSecretEnvironment } from "./redaction.js";

export interface CommandSpec {
  readonly executable: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdin?: string;
  readonly timeoutMs?: number;
  readonly streamOutput?: boolean;
  readonly secrets?: readonly (string | undefined)[];
  readonly includeSecretEnvironment?: boolean;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export class CommandError extends Error {
  public constructor(
    public readonly spec: CommandSpec,
    public readonly result: CommandResult,
  ) {
    const secrets = spec.secrets ?? [];
    const command = redactText([spec.executable, ...(spec.args ?? [])].join(" "), secrets);
    const detail = redactText(result.stderr || result.stdout, secrets).trim();
    super(`${command} exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`);
  }
}

function collect(stream: Readable, onChunk: (chunk: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.setEncoding("utf8");
    stream.on("data", onChunk);
    stream.on("end", resolve);
    stream.on("error", reject);
  });
}

export async function runCommand(spec: CommandSpec): Promise<CommandResult> {
  const started = Date.now();
  const secrets = spec.secrets ?? [];
  const baseEnv = spec.includeSecretEnvironment ? process.env : withoutSecretEnvironment(process.env);
  const child = spawn(spec.executable, [...(spec.args ?? [])], {
    cwd: spec.cwd,
    env: { ...baseEnv, ...spec.env },
    shell: false,
    windowsHide: true,
    stdio: [spec.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });

  if (!child.stdout || !child.stderr) {
    child.kill();
    throw new Error("Command runner failed to allocate output pipes.");
  }

  let stdout = "";
  let stderr = "";
  const stdoutDone = collect(child.stdout, (chunk) => {
    stdout += chunk;
    if (spec.streamOutput) process.stdout.write(redactText(chunk, secrets));
  });
  const stderrDone = collect(child.stderr, (chunk) => {
    stderr += chunk;
    if (spec.streamOutput) process.stderr.write(redactText(chunk, secrets));
  });

  if (spec.stdin !== undefined) {
    if (!child.stdin) {
      child.kill();
      throw new Error("Command runner failed to allocate an input pipe.");
    }
    child.stdin.write(spec.stdin);
    child.stdin.end();
  }

  let timer: NodeJS.Timeout | undefined;
  if (spec.timeoutMs !== undefined) {
    timer = setTimeout(() => child.kill(), spec.timeoutMs);
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (timer) clearTimeout(timer);
  await Promise.all([stdoutDone, stderrDone]);

  const result = { exitCode, stdout, stderr, durationMs: Date.now() - started };
  if (exitCode !== 0) throw new CommandError(spec, result);
  return result;
}
