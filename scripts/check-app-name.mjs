#!/usr/bin/env node
/**
 * Build-time guard for REQ-NFR-APPNAME-01 (application-name decoupling).
 *
 * WHAT THIS SCAN CHECKS
 * ---------------------
 * It fails the build if the configurable application NAME appears as a
 * hardcoded *string literal* anywhere in backend/source code, EXCEPT in its
 * single configuration definition (`cdk/lib/config.ts`). This enforces
 * acceptance criteria 53.1, 53.3, and 53.4: a backend source search for the
 * application name must return zero matches outside the one config definition.
 *
 * The app-name token is NOT hardcoded here — it is read from `DEFAULT_APP_NAME`
 * in `cdk/lib/config.ts`, keeping a single source of truth. With the default
 * the token is `wren`.
 *
 * WHAT COUNTS AS A VIOLATION
 *   A quoted string literal whose *entire* value is exactly the app-name token,
 *   case-insensitively: "wren", 'wren', or `wren`. This is the shape a
 *   hardcoded app name takes in API responses, logs, error strings, email
 *   templates, seed data, and system prompts.
 *
 * WHAT IS DELIBERATELY NOT A VIOLATION (legitimate path/package identifiers)
 *   - File/path identifiers and bin names: `bin/wren.ts`, `bin/wren.js`
 *   - Package names and slugs: `wren-cdk`, `wren-writing-coach`
 *   - Stack-prefix-derived names: `wren-dev`, `wren-dev-Skeleton`
 *   These never match because the token must be the WHOLE quoted value
 *   (a `-`, `/`, or `.` after `wren` breaks the match), and because the scan
 *   only inspects source code — not `package.json`, `cdk.json`, lockfiles, or
 *   generated `cdk.out` artifacts.
 *
 * SCAN SCOPE
 *   Source roots:        cdk/{bin,lib,lambda,layers}, frontend/src (if present)
 *   Extensions:          .ts .tsx .js .jsx .mjs .cjs .py
 *   Excluded:            node_modules, cdk.out, dist, build, coverage, .git,
 *                        *.d.ts, and the single config definition file.
 *
 * EXIT CODES
 *   0 = clean (no hardcoded app-name literal outside the config definition)
 *   1 = one or more violations found (paths + line numbers printed)
 *   2 = scan could not run (e.g. could not read the config definition)
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");

/** The one file allowed to define the app-name literal. */
const CONFIG_DEFINITION_REL = join("cdk", "lib", "config.ts");
const CONFIG_DEFINITION_ABS = join(REPO_ROOT, CONFIG_DEFINITION_REL);

const SOURCE_ROOTS = [
  join("cdk", "bin"),
  join("cdk", "lib"),
  join("cdk", "lambda"),
  join("cdk", "layers"),
  join("frontend", "src"),
];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
]);

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  "cdk.out",
  "dist",
  "build",
  "coverage",
  ".git",
]);

/**
 * Read the single-source app-name token from cdk/lib/config.ts so this scan
 * never duplicates the literal it is guarding.
 */
function readAppNameToken() {
  let content;
  try {
    content = readFileSync(CONFIG_DEFINITION_ABS, "utf8");
  } catch (err) {
    console.error(
      `[check-app-name] FATAL: cannot read config definition at ${CONFIG_DEFINITION_REL}: ${err.message}`,
    );
    process.exit(2);
  }
  const match = content.match(/DEFAULT_APP_NAME\s*=\s*["'`]([^"'`]+)["'`]/);
  if (!match) {
    console.error(
      `[check-app-name] FATAL: could not find DEFAULT_APP_NAME in ${CONFIG_DEFINITION_REL}`,
    );
    process.exit(2);
  }
  return match[1];
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (EXCLUDED_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walk(full);
    } else if (stat.isFile()) {
      yield full;
    }
  }
}

function hasSourceExtension(file) {
  const dot = file.lastIndexOf(".");
  if (dot < 0) return false;
  if (file.endsWith(".d.ts")) return false;
  return SOURCE_EXTENSIONS.has(file.slice(dot));
}

function main() {
  const token = readAppNameToken();
  // Match a quoted string literal whose ENTIRE value is exactly the app name.
  // e.g. "wren" / 'wren' / `wren`  — but NOT "wren-cdk", "bin/wren.ts", etc.
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const literalRe = new RegExp(`(["'\`])${escaped}\\1`, "i");

  const violations = [];

  for (const root of SOURCE_ROOTS) {
    const absRoot = join(REPO_ROOT, root);
    if (!existsSync(absRoot)) continue;
    for (const file of walk(absRoot)) {
      if (!hasSourceExtension(file)) continue;
      // Skip the single allowed config definition.
      if (relative(CONFIG_DEFINITION_ABS, file) === "") continue;

      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (literalRe.test(line)) {
          violations.push({
            file: relative(REPO_ROOT, file).split(sep).join("/"),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }
  }

  const configRel = CONFIG_DEFINITION_REL.split(sep).join("/");
  if (violations.length > 0) {
    console.error(
      `\n[check-app-name] FAILED — application name "${token}" is hardcoded as a string literal outside the single config definition (${configRel}).\n`,
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.text}`);
    }
    console.error(
      `\nResolve the application name from configuration (SSM / AppConfig) instead of a literal. See REQ-NFR-APPNAME-01.\n`,
    );
    process.exit(1);
  }

  console.log(
    `[check-app-name] OK — no hardcoded application-name literal ("${token}") found in backend source outside ${configRel}.`,
  );
}

main();
