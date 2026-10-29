#!/usr/bin/env node
/**
 * Lambda bundling hook: make sure the Document Lambda asset ships the Linux
 * x64 (glibc) native binding for `@napi-rs/canvas`.
 *
 * `pdfjs-dist` loads `@napi-rs/canvas` in Node. CDK installs the asset's
 * `nodeModules` on the deploying machine, so a deploy from Windows or macOS
 * ships only that platform's binding and the digital PDF path fails on Lambda
 * with "Cannot find module '@napi-rs/canvas-linux-x64-gnu'" — every PDF then
 * falls back to Textract OCR.
 *
 * The binding is installed into a scratch directory (so the asset's own
 * dependency tree is never re-resolved) and copied in, pinned to the exact
 * `@napi-rs/canvas` version already in the asset. No-op when the binding is
 * already present (Linux host or Docker bundling).
 *
 * Usage: node installLinuxCanvasBinding.mjs <bundle output dir>
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BINDING_PACKAGE = '@napi-rs/canvas-linux-x64-gnu';
const BINDING_FILE = 'skia.linux-x64-gnu.node';

const outputDir = process.argv[2];
if (!outputDir) {
  console.error('installLinuxCanvasBinding: missing bundle output directory argument');
  process.exit(1);
}

const canvasManifest = path.join(outputDir, 'node_modules', '@napi-rs', 'canvas', 'package.json');
if (!existsSync(canvasManifest)) {
  // Nothing in this asset depends on @napi-rs/canvas.
  process.exit(0);
}

const target = path.join(outputDir, 'node_modules', ...BINDING_PACKAGE.split('/'));
if (existsSync(path.join(target, BINDING_FILE))) process.exit(0);

const { version } = JSON.parse(readFileSync(canvasManifest, 'utf8'));
const scratch = mkdtempSync(path.join(tmpdir(), 'wren-canvas-'));
try {
  // --force: npm cannot evaluate the glibc constraint on a non-Linux host.
  execSync(
    `npm install --no-save --no-package-lock --no-audit --no-fund --force ` +
      `--os=linux --cpu=x64 ${BINDING_PACKAGE}@${version}`,
    { cwd: scratch, stdio: 'inherit' },
  );
  const installed = path.join(scratch, 'node_modules', ...BINDING_PACKAGE.split('/'));
  if (!existsSync(path.join(installed, BINDING_FILE))) {
    throw new Error(`${BINDING_PACKAGE}@${version} did not contain ${BINDING_FILE}`);
  }
  cpSync(installed, target, { recursive: true });
  console.log(`installLinuxCanvasBinding: added ${BINDING_PACKAGE}@${version}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
