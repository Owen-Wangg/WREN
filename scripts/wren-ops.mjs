#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SECRET_ENV = new Set(["WREN_GITHUB_TOKEN"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operation = process.argv[2];

if (operation !== "deploy" && operation !== "undeploy" && operation !== "disarm") {
  console.error("Usage: node scripts/wren-ops.mjs <deploy|undeploy|disarm>");
  process.exit(2);
}

const nodeMajor = Number.parseInt(
  process.versions.node.split(".")[0] ?? "0",
  10,
);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  console.error(
    `WREN deployment requires Node.js 22 or newer; found ${process.versions.node}.`,
  );
  process.exit(2);
}

function sanitizedEnv(includeSecrets) {
  const env = { ...process.env };
  if (!includeSecrets) {
    for (const key of SECRET_ENV) delete env[key];
  }
  return env;
}

function run(executable, args, cwd, includeSecrets = false) {
  // On Windows, npm ships as npm.cmd. Recent Node.js versions (>=18.20.2/20.12.2)
  // refuse to spawn .cmd/.bat files without a shell, failing with EINVAL.
  const needsShell =
    process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
  const result = spawnSync(executable, args, {
    cwd,
    env: sanitizedEnv(includeSecrets),
    shell: needsShell,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Unable to start ${executable}: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const skipInstall = process.env.WREN_SKIP_INSTALL === "true";
if (skipInstall) {
  const rootModules = path.join(root, "node_modules");
  const cdkModules = path.join(root, "cdk", "node_modules");
  if (!existsSync(rootModules) || !existsSync(cdkModules)) {
    console.error(
      "WREN_SKIP_INSTALL=true requires existing root and cdk node_modules directories.",
    );
    process.exit(2);
  }
} else {
  console.log("[wren] Installing locked root dependencies...");
  run(npm, ["ci"], root);
  console.log("[wren] Installing locked CDK dependencies...");
  run(npm, ["ci"], path.join(root, "cdk"));
}

const script =
  operation === "deploy"
    ? "deploy:orchestrator"
    : operation === "disarm"
      ? "disarm:orchestrator"
      : "undeploy:orchestrator";
run(npm, ["run", script], path.join(root, "cdk"), true);
