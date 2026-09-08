# Dependency Management Guide

## Overview

This document explains how Node.js and Python dependencies are declared, pinned, and shipped in WREN.

| Workload | Language | How dependencies are installed |
| --- | --- | --- |
| Shared types, auth, admin, document, feedback, notification | Node 22 | npm workspaces + root `package-lock.json`; CDK esbuild bundles Lambdas |
| Frontend (React web app) | Node (Vite) | `frontend/package.json` + `frontend/package-lock.json` |
| CDK app | Node | `cdk/package.json` + `cdk/package-lock.json` |
| Feedback Engine | Python 3.12 (Lambda container image) | `pip install` in `backend/engine/python/Dockerfile` from a uv-compiled lockfile |
| Diff / Anchor / Progress Lambda | Python 3.12 zip | Standard library only — no `requirements.txt` on the function |
| Engine + DB Python tests | Python 3.12 | uv (`testing/pyproject.toml`, `testing/uv.lock`) |

Dependency policy (UBC CIC): production dependency versions must be pinned and generated lockfiles committed (`package-lock.json` for Node; `uv.lock` / compiled `requirements.txt` for Python). Files that install at deploy or container-build time should use exact pins (`==`).

### How the pieces fit together

This is the mental model:

```
Node
├── Root workspaces
│   └── package-lock.json → Lambda esbuild bundles
├── frontend
│   └── package-lock.json → Amplify
└── cdk
    └── package-lock.json → CDK application

Python
├── Feedback Engine (Lambda container image)
│   └── requirements-feedback-engine.in
│       → requirements-feedback-engine.txt (compiled lockfile)
│       → Docker image → ECR → Lambda
├── Engine tests
│   └── requirements.in → requirements.txt (test-only)
└── Diff / Anchor / Progress Lambda
    └── standard library only
```

The rest of this guide walks each tree top to bottom.

---

## Node.js (monorepo)

### Workspaces (repository root)

Root `package.json` workspaces:

- `types` (`@wren/types`)
- `backend/database/node` (`@wren/db-node`)
- `backend/auth`, `backend/admin`, `backend/document`, `backend/feedback`, `backend/notification`

Install workspace dependencies from the repository root so npm resolves the workspaces against the root `package-lock.json`:

```bash
npm ci
```

Workspace packages are linked into the root installation, which is what lets shared `@wren/*` packages resolve during CDK/esbuild bundling. Commit the root `package-lock.json`; any change to a `package.json` must be committed together with the corresponding lockfile change.

Workspace packages depend on each other with `"@wren/types": "*"` (and similar). Shared runtime validation uses Zod (also listed on the root package).

### Lambda bundling (Compute stack)

Node Lambdas are `NodejsFunction`s. esbuild runs with `projectRoot` = monorepo root and `depsLockFilePath` = root `package-lock.json`, so `@wren/*` resolves through workspace links.

By default esbuild minifies, emits source maps, targets `node22`, and bundles dependencies into the artifact rather than into Lambda layers. The Document Lambda is the exception: `pdfjs-dist` and `pdf-parse` are listed in `nodeModules` so they ship as real `node_modules` (they rely on worker files / ESM and break when bundled into a single file).

If a new npm package must stay unbundled (native addons, worker files), add it to that `nodeModules` array in `cdk/lib/stacks/ComputeStack.ts`.

### Frontend

```bash
cd frontend
npm ci
```

Lockfile: `frontend/package-lock.json`. Amplify builds use this package independently of the CDK lockfile.

### CDK package

```bash
cd cdk
npm ci
```

Lockfile: `cdk/package-lock.json`. This is not an npm workspace of the root package, so it has its own separate install.

---

## Python

Python 3.12 is the supported runtime version for WREN's Python workloads. The test-tooling project at `testing/pyproject.toml` declares `requires-python = ">=3.12"`.

### uv (tests and compile)

`testing/pyproject.toml` is the Python test-tooling root (`package = false`, no distributable package). Its `[dependency-groups] dev` holds pytest, Hypothesis, and `psycopg[binary,pool]`, and its `[tool.pytest.ini_options] testpaths` point at the engine, database, and helper test trees.

```bash
# from the testing/ directory
cd testing
uv sync
uv run pytest
```

Lockfile: `testing/uv.lock` (commit it).

Compile a pinned install file from a `.in` manifest (run from the repository root so the paths below resolve):

```bash
uv pip compile backend/engine/python/requirements-feedback-engine.in \
  -o backend/engine/python/requirements-feedback-engine.txt \
  --python 3.12
```

The engine test dependencies follow the same `.in` → compiled `.txt` pattern: `backend/engine/python/requirements.in` compiles to `requirements.txt` (test-only engine toolchain), as do the database Python dependencies under `backend/database/python/`.

### Feedback Engine (the heavy Python runtime)

The Feedback Engine is deployed as an AWS Lambda container image. The image is built in **AWS CodeBuild** — during a first-time `npm run deploy` by the standing `${stackPrefix}-bootstrap-image` project (from a snapshot of the committed revision, so no local Docker daemon is needed), and on later pushes by the CI/CD pipeline's Build stage. Docker still runs *inside* CodeBuild against the same `backend/engine/python/Dockerfile`; the result is pushed to ECR. Subsequent sections refer to it simply as "the image." See [How the Feedback Engine image is built](./deployment-guide.md#how-the-feedback-engine-image-is-built) for the bootstrap flow and how the ECR repository and initial image are created.

- **Location:** `backend/engine/python/`
- **Base image:** `public.ecr.aws/lambda/python:3.12`
- **ECR repository:** `{stackPrefix}-feedback-engine`

**A note on image tags and identity, because they cause confusion.** The immutable **image digest** is the true identity of a build; tags are labels that can move. The same image can carry:

- `bootstrap` — a mutable "latest" pointer that every build (bootstrap or CI) pushes.
- a commit-scoped tag — the bootstrap build tags each image `src-<first 12 of the commit sha>`; the CI pipeline tags with the full commit SHA. Both are per-commit pointers, immutable *by convention* (the ECR repo itself is `MUTABLE` so the `bootstrap` convenience tag can move).

What is enforced:

- The **deployed Lambda is pinned by the immutable digest.** `ComputeStack` resolves the image via `fromEcrImage(..., { tagOrDigest: config.feedbackEngineImageTag })`, and the deploy workflow passes the `sha256:...` **digest** it recorded for the built image (falling back to a tag only for direct-CDK/`bootstrap` use when no image was published that run). So an out-of-band `docker push` that repoints a tag cannot change what the deployed Lambda runs.
- **Commit-safe reuse** lives in the deploy workflow: it records the digest **and** the source commit in its checkpoint and reuses an existing image only when the recorded `sourceCommit` matches the revision being deployed. A stale or reused tag therefore never causes a different commit's image to ship.
- The `src-<sha>` and `bootstrap` tags remain **human-facing lookup labels** (the ECR repo is `MUTABLE` so `bootstrap` can move); they are not what the deployed Lambda is bound to.

This is the only Python workload that ships a third-party runtime stack — Bedrock via `langchain-aws`, Postgres via `psycopg`.

Declare direct dependencies in `requirements-feedback-engine.in`:

| Package | Pinned in `.in` | Purpose |
| --- | --- | --- |
| `langchain-aws` | `1.0.0` | `ChatBedrockConverse` — model-agnostic Bedrock calls |
| `langchain-core` | `1.4.9` | Imported directly (`langchain_core.messages`) in `model_invocation.py` |
| `boto3` | `1.40.63` | AWS SDK (meets langchain-aws's `boto3>=1.40.19` floor) |
| `psycopg[binary]` | `3.3.4` | PostgreSQL via RDS Proxy |

`langchain-core` is a direct dependency here because the model-invocation code imports `langchain_core.messages` itself. It also happens to be a dependency of `langchain-aws`, but it is listed directly because the code uses it directly.

Lock the full tree in `requirements-feedback-engine.txt` (compiled by uv). The Dockerfile installs that compiled file:

```dockerfile
COPY requirements-feedback-engine.txt .
RUN pip install -r requirements-feedback-engine.txt --target "${LAMBDA_TASK_ROOT}"
```

Changing the Bedrock model id does not require a new Python package (REQ-NFR-MODEL-01) — `ChatBedrockConverse` takes the model id as a runtime string. Changing the invocation library (for example, moving off `langchain-aws`) does.

### Engine test pin file

`backend/engine/python/requirements.txt` (compiled from `requirements.in`, as described above) holds only pytest + Hypothesis for local/CI engine tests. The important distinction: it is not installed into the Feedback Engine image — the image installs `requirements-feedback-engine.txt` instead. Keeping the two files separate is why the engine test toolchain and the engine runtime can pin different versions of shared packages without conflict.

### Python data-access package

`backend/database/python/` (`wren_db`) is the parameterized PostgreSQL data-access package and depends on `psycopg[binary,pool]`. Its docstring and `requirements.in` describe it as being packaged as a Lambda layer, but note that no `LayerVersion` is defined in the CDK today and the package is not yet bundled into any deployed function — the layer packaging is intended, not currently wired up.

`boto3` is deliberately left out of its `requirements.in` (the file's own comment says so). The reasoning is that code running under the AWS Lambda Python runtime uses the runtime's bundled SDK, so it does not need to package `boto3`. The Feedback Engine container image cannot rely on that bundled SDK, which is why the engine lockfile declares `boto3` explicitly.

### Diff / Anchor / Progress zip Lambda

The Diff / Anchor / Progress Lambda (`cdk/lambda/diff-anchor-progress/`) is deployed as a zip via `lambda.Code.fromAsset` with no dependency installation. Its `handler.py` is standard-library-only (`json`, `logging`), and the dependency rule for it is simple: it must stay that way. If a third-party dependency ever becomes necessary, the packaging strategy has to change to a layer or a container image first.

Current status, so you don't go looking for logic that isn't there: `handler.py` is a routing scaffold whose diff/anchor/progress bodies are still TODOs. The live diff and remapping logic currently runs inside the Feedback Engine (`wren_engine`), not this handler. The function is created in `ComputeStack` and included in Observability log retention, but it is not wired to API Gateway. From a dependency-management standpoint the only thing that matters is the stdlib-only rule above.

---

## Adding a New Dependency

### Node (workspace Lambda or shared package)

1. Add the package to the relevant workspace `package.json` (or root, if truly shared).
2. From the repo root: `npm install <pkg> -w @wren/<workspace>` (or edit the JSON and run `npm install`).
3. Commit both the updated `package.json` and the root `package-lock.json`.
4. Redeploy the appropriate Compute stack so esbuild includes the dependency, e.g. `npx cdk deploy <prefix>-Compute`.
5. If the package cannot be bundled, add it to `nodeModules` in `ComputeStack.ts`.

### Frontend

1. `cd frontend && npm install <pkg>`
2. Commit `frontend/package.json` and `frontend/package-lock.json`.
3. Amplify rebuild (or local `npm run build`).

### CDK constructs

1. `cd cdk && npm install <pkg>`
2. Commit `cdk/package.json` and `cdk/package-lock.json`.
3. `npx cdk deploy …`

### Feedback Engine (Python runtime)

1. Add a pinned line to `backend/engine/python/requirements-feedback-engine.in`:

   ```
   some-package==1.2.3
   ```

2. Recompile the lockfile:

   ```bash
   uv pip compile backend/engine/python/requirements-feedback-engine.in \
     -o backend/engine/python/requirements-feedback-engine.txt \
     --python 3.12
   ```

3. Commit the change (clean working tree) and rebuild the image. The normal path is automatic: `npm run deploy` builds it in CodeBuild from the committed revision, or the CI/CD pipeline builds it on push — neither needs local Docker. As an emergency escape hatch only, you can still build by hand from a machine with Docker (substitute your own prefix for `wren-dev`):

   ```bash
   docker build -t "${ACCOUNT}.dkr.ecr.ca-central-1.amazonaws.com/wren-dev-feedback-engine:bootstrap" \
     backend/engine/python/
   docker push …:bootstrap
   ```

4. Point the Lambda at the new image (the bootstrap flow and CI/CD UpdateLambda stage do this automatically; manual escape hatch: `update-function-code`).

5. Confirm the function starts (`handler.handler`) and Bedrock/DB access still works. The log group follows the same convention, e.g. `/aws/lambda/wren-dev-feedback-engine`.

### Engine or DB Python tests only

1. Edit the relevant `requirements.in`, or `testing/pyproject.toml`'s `[dependency-groups] dev`.
2. `uv lock` (from `testing/`) or `uv pip compile` as appropriate.
3. Commit `testing/uv.lock` and any regenerated `requirements.txt`.
4. No image push required.

---

## Updating an Existing Dependency

**Node:** update the version in the appropriate `package.json`, run `npm install` in that package tree, commit both `package.json` and its lockfile, then redeploy the consumer (Compute, Amplify, or CDK).

**Python runtime:** bump the pin in `requirements-feedback-engine.in`, recompile the `.txt`, commit, then let `npm run deploy` (bootstrap build) or the CI/CD pipeline rebuild the image in CodeBuild and update the Lambda.

Use exact pins (`==`) in `.in` files that feed production installs — unpinned ranges can drift between `uv pip compile` runs and between image builds.

After a `langchain-aws` bump, re-check the required `boto3` floor and IAM (the CRIS model ARNs in `ComputeStack.ts`). A new model family can need IAM changes even when `pip` succeeds.

---

## CI/CD

When GitHub context is set, `CicdStack` provisions a CodePipeline with four stages (see the header comment in `cdk/lib/stacks/CicdStack.ts`):

```
Source (GitHub webhook)
        ↓
Build       — Build_And_Test: runs tests, builds the container image,
              pushes it to ECR tagged with the commit SHA, and synths CDK
        ↓
Deploy      — Deploy_CDK: CloudFormation update of the Compute stack
              (only meaningful for infra changes)
        ↓
UpdateLambda — Update_Feedback_Engine: lambda update-function-code with the
               new image URI; a fast path that skips CloudFormation
```

So a change to `requirements-feedback-engine.txt` or engine source flows through Build (which pushes the SHA and `bootstrap` tags, per the tag note above) and then UpdateLambda (image swap to the SHA). Separating UpdateLambda from Deploy means a Python-only commit is a quick image swap rather than a full CloudFormation diff.

For a first-time or pipeline-less deploy, the standing `${stackPrefix}-bootstrap-image` CodeBuild project performs the equivalent build from a SHA-keyed source snapshot (no local Docker); see [How the Feedback Engine image is built](./deployment-guide.md#how-the-feedback-engine-image-is-built). A hand-run Docker build + ECR push + `lambda update-function-code` remains available as an emergency escape hatch.

Test commands: root `npm test` (Jest) for Node, `npm test` in `frontend/` (Vitest) for the web app, and `uv run pytest` for Python.

---

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Lambda `Cannot find module '@wren/…'` | Root `npm ci` before CDK deploy; esbuild `projectRoot` is the monorepo root |
| PDF extract fails in Document Lambda | `pdfjs-dist` / `pdf-parse` still in the `nodeModules` bundling options |
| Engine import error / missing langchain | Image was built from an old `requirements-feedback-engine.txt`; rebuild `bootstrap` |
| Two different `boto3` pins | The engine test `requirements.txt` and the runtime `requirements-feedback-engine.txt` are separate trees; the container uses the runtime file |

---

## Related documents

- [Deployment guide](./deployment-guide.md) (ECR bootstrap image)
- [Modification guide](./modification-guide.md) (Feedback Engine code changes)
- [Engine README](../backend/engine/python/README.md)
- [CDK README](../cdk/README.md)
