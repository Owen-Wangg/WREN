# WREN — AWS Deployment Guide

This guide deploys the WREN writing coach (repository and AWS prefix **WREN**) into an AWS account. The recommended path is the cross-platform `npm run deploy` orchestrator: after AWS authentication, Docker startup, Bedrock access, and environment-variable configuration, it installs locked dependencies and completes the ordered deployment. The detailed CDK commands remain below as an advanced recovery/reference path. AWS resource names use the `wren` project prefix; **LEON** is the user-facing display name shown in the UI and emails.

## Table of Contents

- [WREN — AWS Deployment Guide](#wren--aws-deployment-guide)
  - [Table of Contents](#table-of-contents)
  - [What You'll Have When You're Done](#what-youll-have-when-youre-done)
  - [Architecture at a Glance](#architecture-at-a-glance)
  - [Requirements](#requirements)
    - [People and Access](#people-and-access)
    - [Cost and Time Expectations](#cost-and-time-expectations)
    - [Enable and Verify Bedrock Model Access](#enable-and-verify-bedrock-model-access)
    - [Service Quotas](#service-quotas)
    - [Request Higher Bedrock Invocation Quotas](#request-higher-bedrock-invocation-quotas)
    - [Cognito Email](#cognito-email)
  - [AWS credentials for all deployment paths](#aws-credentials-for-all-deployment-paths)
  - [Deployment](#deployment)
    - [Recommended: one command from the repository root](#recommended-one-command-from-the-repository-root)
    - [Deployment workflow implementation](#deployment-workflow-implementation)
    - [Variables for the standard deployment](#variables-for-the-standard-deployment)
    - [Managed versus external ECR](#managed-versus-external-ecr)
    - [Optional CodePipeline](#optional-codepipeline)
    - [Automated smoke criteria](#automated-smoke-criteria)
    - [Direct-CDK recovery path (advanced only)](#direct-cdk-recovery-path-advanced-only)
      - [A. Install dependencies](#a-install-dependencies)
      - [B. Bootstrap CDK in two Regions](#b-bootstrap-cdk-in-two-regions)
      - [C. Choose direct-CDK configuration](#c-choose-direct-cdk-configuration)
      - [D. Build and push the Feedback Engine image](#d-build-and-push-the-feedback-engine-image)
      - [E. Deploy with CDK](#e-deploy-with-cdk)
  - [Direct-CDK recovery continuation](#direct-cdk-recovery-continuation)
    - [F. Configure GitHub, Amplify, and CI/CD](#f-configure-github-amplify-and-cicd)
    - [G. Configure the first administrator](#g-configure-the-first-administrator)
    - [H. Open the web app](#h-open-the-web-app)
      - [Run the frontend locally (without Amplify)](#run-the-frontend-locally-without-amplify)
    - [I. Confirm the application is running](#i-confirm-the-application-is-running)
  - [Day-2 Operations](#day-2-operations)
    - [VPC Endpoint Cost and Security Change Runbook](#vpc-endpoint-cost-and-security-change-runbook)
      - [1. Establish a read-only baseline](#1-establish-a-read-only-baseline)
      - [2. Configure and understand monitoring](#2-configure-and-understand-monitoring)
      - [3. Deploy and verify the combined endpoint removal](#3-deploy-and-verify-the-combined-endpoint-removal)
      - [4. Roll back if health evidence regresses](#4-roll-back-if-health-evidence-regresses)
  - [Troubleshooting](#troubleshooting)
    - [Common Issues](#common-issues)
  - [Cleanup](#cleanup)
    - [Protected application teardown (recommended)](#protected-application-teardown-recommended)
    - [Full data destruction is a separate manual operation](#full-data-destruction-is-a-separate-manual-operation)
  - [Quick Reference - First-Time Commands](#quick-reference---first-time-commands)

---

## What You'll Have When You're Done

- A React frontend on **AWS Amplify** (optional until GitHub is connected)
- REST APIs on **API Gateway**, fronted by **CloudFront + WAF**
- Node.js and Python **Lambda** backends running in a VPC
- **Amazon RDS PostgreSQL 16** (private), behind **RDS Proxy**
- **Cognito** sign-up / sign-in
- **Amazon Bedrock** for writing feedback (Feedback Engine container Lambda)
- Database schema applied automatically via a migration Lambda

Default naming uses project `wren` and environment `dev`, so stacks are named `wren-dev-<Concern>` (e.g. `wren-dev-Vpc`). The **data-plane Region** is CDK context `region` (examples in this guide use `ca-central-1`; override with `-c region=...`). **Amazon CloudFront is a global CDN** — it is not “the API in us-east-1.” The `CloudFrontWaf` *CloudFormation stack* is created in `us-east-1` because AWS manages CloudFront-scoped WAF web ACLs there. That stack does not store student drafts or chat history.

## Architecture at a Glance

| Stack | Where it deploys | Role |
| --- | --- | --- |
| `Config` | Data-plane Region | SSM Parameter Store (display name, Bedrock model id) and a Bedrock Guardrail |
| `Vpc` | Data-plane Region | Three-tier VPC, NAT gateway, VPC endpoints, flow logs |
| `Storage` | Data-plane Region | S3 buckets (documents, reference material) and DynamoDB conversation table |
| `Cognito` | Data-plane Region | User pool, app client, `SystemAdmin` group |
| `Database` | Data-plane Region | RDS PostgreSQL 16.13 (`db.t3.medium`), RDS Proxy, schema migrations |
| `Cicd` | Data-plane Region | Always-present ECR repo/import + Compute permissions boundary; optional CodePipeline when explicitly enabled |
| `Compute` | Data-plane Region | Named Lambdas (Document, Admin, Audit, Feedback Orchestrator, Feedback Engine, Notification, authorizers), SQS, AppSync |
| `Api` | Data-plane Region | REST API Gateway from `cdk/lib/openapi.yaml` |
| `Observability` | Data-plane Region | CloudWatch log retention and alarms |
| `CloudFrontWaf` | `us-east-1` (WAF control plane for CloudFront scope) | CloudFront distribution + CloudFront-scoped WAF |
| `Amplify` | Data-plane Region | Frontend hosting (only if GitHub owner/repo are set) |

> **Use `npm run deploy` for normal deployments.** The orchestrator creates or validates ECR ownership, pushes both an immutable image tag and the compatibility `bootstrap` tag, and deploys stacks in dependency order. The manual image and stack commands later in this guide are retained for advanced recovery.
>
> `Amplify` is enabled by default by the orchestrator and requires GitHub owner/repo variables. CodePipeline is separately opt-in with `WREN_ENABLE_CICD=true`; the `Cicd` prerequisite stack remains present even when the pipeline is disabled.

---

## Requirements

Before you deploy, you must have the following installed on your device:

- [git](https://git-scm.com/downloads)
- An [AWS Account](https://aws.amazon.com/account/) with permission to create IAM, VPC, RDS, Lambda, API Gateway, Cognito, CloudFront, WAF, Amplify, Bedrock, and KMS resources
- A [GitHub Account](https://github.com/) — required for the default hosted frontend and optional CI/CD; set its details in the [standard deployment variables](#variables-for-the-standard-deployment)
- [AWS CLI](https://aws.amazon.com/cli/) _(v2.0.0+ required)_
- [Node.js](https://nodejs.org/en/learn/getting-started/how-to-install-nodejs) _(v22.x+ required)_
- [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) _(comes with Node)_
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the daemon running — required to build the Feedback Engine image and for CDK asset bundling

> The AWS CDK CLI (`aws-cdk`) is a **dev dependency** of `cdk/` — you do not need a global `cdk` install. All commands below use `npx cdk`. The pinned version is **`2.1138.0`** (see `cdk/package.json`); Node.js v22+ is required by the project's `engines` field and by Amplify's build environment.

### People and Access

For the default hosted workflow, you also need a GitHub repository this account can read (fork or the original) and a GitHub personal access token (PAT); provide them through the [standard deployment variables](#variables-for-the-standard-deployment). Direct-CDK recovery token setup is documented in [F. Configure GitHub, Amplify, and CI/CD](#f-configure-github-amplify-and-cicd).

### Cost and Time Expectations

This is not a free-tier stack. Typical always-on costs include:

- NAT Gateway (**one** NAT in a two-AZ VPC — private subnets in both AZs send egress through that single NAT)
- RDS `db.t3.medium` + RDS Proxy
- Several **VPC interface endpoints** (Secrets Manager, SSM, Bedrock Runtime), billed per AZ. S3 and DynamoDB use free gateway endpoints; RDS control-plane and API Gateway interface endpoints are intentionally not deployed.
- CloudFront, WAF, S3, DynamoDB, Lambda, Amplify (usage-based)

Plan for **hundreds of dollars per month** in a running `dev` environment — not a few dollars. Tear down unused environments (see [Cleanup](#cleanup)).

A first deploy from an empty account typically takes **45–90 minutes**, dominated by VPC, RDS, and CloudFront.

### Enable and Verify Bedrock Model Access

The default model id is `us.anthropic.claude-sonnet-4-6` (a US cross-region inference profile). Lambdas run in `ca-central-1` and invoke Bedrock there.

**Step 1: Enable model access**

1. Open the AWS Console → **Amazon Bedrock** in **`ca-central-1`**.
2. Open **Model access** (or **Playground** → request access) and enable the Anthropic Claude models your account needs, including the model behind that inference profile.
3. If the console also requires access in US regions for `us.*` profiles, enable the same models in **`us-east-1`** and follow any account-level "cross-region inference" prompts.

**Step 2: Verify the inference profile before deploying**

The configured id (`us.anthropic.claude-sonnet-4-6`) is a **cross-region inference profile**, not a foundation-model id. Confirm it is listed:

<details>
<summary>macOS/Linux</summary>

```bash
aws bedrock list-inference-profiles \
  --region ca-central-1 \
  --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'anthropic')].inferenceProfileId" \
  --output text
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
aws bedrock list-inference-profiles `
  --region ca-central-1 `
  --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'anthropic')].inferenceProfileId" `
  --output text
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
aws bedrock list-inference-profiles ^
  --region ca-central-1 ^
  --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'anthropic')].inferenceProfileId" ^
  --output text
```

</details>

&nbsp;

Without model access, the app deploys but **feedback generation fails at runtime**.

### Service Quotas

Default quotas are usually fine for `dev`. You should have headroom on:

- VPCs, Elastic IPs (NAT), RDS instances
- Lambda concurrent executions
- CloudFormation stacks (this app creates ~9–11 stacks)

If a deploy fails with a quota error, request an increase in **Service Quotas** and retry the same `cdk deploy` command.

### Request Higher Bedrock Invocation Quotas

For heavier or concurrent usage, request a higher Bedrock "requests per minute" quota before deploying:

1. Navigate to the **AWS Service Quotas** console.
2. Search for "Bedrock" and select the Anthropic Claude model behind your configured inference profile.
3. Request a quota increase for "Requests per minute" based on expected usage.
4. Submit and wait for AWS approval — this can take 24–48 hours.

### Cognito Email

Cognito uses Cognito's default email for verification codes (limited volume). For production, configure a Cognito SES identity later — it is not required to get the app running.

---

## AWS credentials for all deployment paths

Authenticate with an AWS identity that has broad first-rollout deployment rights (`AdministratorAccess`, or a dedicated CDK deploy role). For the standard workflow, prefer AWS IAM Identity Center/SSO or another standard AWS credential-chain method; the workflow uses those credentials (or `AWS_PROFILE`) and never asks for long-lived access keys.

For example, configure and sign in with SSO:

```bash
aws configure sso
aws sso login --profile <your-profile>
```

Confirm the account before any deployment:

```bash
aws sts get-caller-identity
```

> **Standard deployment:** stop here and use the [`npm run deploy` workflow](#recommended-one-command-from-the-repository-root). Do **not** manually install dependencies or bootstrap CDK; the workflow does both. The direct-CDK bootstrap commands later in this guide are only for the [advanced recovery path](#direct-cdk-recovery-path-advanced-only).

---

## Deployment

### Recommended: one command from the repository root

The orchestrator is the canonical deployment path. It uses the AWS CLI's current credentials or `AWS_PROFILE`; it never asks for long-lived AWS access keys. It installs locked dependencies in the root and `cdk/`, verifies the target identity and Bedrock inference profile with a minimal live invocation, bootstraps the data Region and `us-east-1`, safely establishes ECR/IAM prerequisites, builds and pushes an immutable engine image, deploys each stack in order, waits for Amplify, guides TechnicalAdmin setup, runs smoke checks, and optionally enables CodePipeline last.

> **Simplified first-time deployment:** the user only needs to authenticate to AWS, enable the selected Bedrock model/inference profile, start Docker Desktop, set the environment variables below, and run **`npm run deploy`** from the repository root. The command performs locked dependency installation, CDK bootstrap, ECR setup, image build/push, secret setup, and ordered CDK stack deployment automatically. Do **not** manually run `npm ci`, `cdk bootstrap`, `aws ecr create-repository`, Docker push commands, or individual `cdk deploy` commands when using this recommended path.

Before running the command, complete these prerequisites:

1. Configure or sign in to AWS using the standard credential chain (for example, `aws configure sso` and your SSO login) and confirm the intended account with `aws sts get-caller-identity`.
2. Enable access to the configured Bedrock model/inference profile in the target Region.
3. Start Docker Desktop and confirm its daemon is running.

For the default hosted deployment, set the target, GitHub source, PAT, and intended first administrator before running the command. `WREN_EXPECTED_ACCOUNT_ID` is strongly recommended everywhere and required for production or non-interactive runs. **Choose exactly one of the following command blocks for your terminal, replace the placeholder values, and run it from the repository root.**

<details>
<summary>macOS/Linux</summary>

```bash
export WREN_EXPECTED_ACCOUNT_ID=123456789012
export WREN_GITHUB_OWNER=YourOrgOrUser
export WREN_GITHUB_REPO=WREN
export WREN_GITHUB_BRANCH=main
export WREN_GITHUB_TOKEN='YOUR_GITHUB_PAT'
export WREN_ADMIN_EMAIL=admin@example.com
npm run deploy
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$env:WREN_EXPECTED_ACCOUNT_ID = "123456789012"
$env:WREN_GITHUB_OWNER = "YourOrgOrUser"
$env:WREN_GITHUB_REPO = "WREN"
$env:WREN_GITHUB_BRANCH = "main"
$env:WREN_GITHUB_TOKEN = "YOUR_GITHUB_PAT"
$env:WREN_ADMIN_EMAIL = "admin@example.com"
npm run deploy
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
set WREN_EXPECTED_ACCOUNT_ID=123456789012
set WREN_GITHUB_OWNER=YourOrgOrUser
set WREN_GITHUB_REPO=WREN
set WREN_GITHUB_BRANCH=main
set WREN_GITHUB_TOKEN=YOUR_GITHUB_PAT
set WREN_ADMIN_EMAIL=admin@example.com
npm run deploy
```

</details>

The first run normally pauses with exit code **3** when human action is required. For a new administrator:

1. Follow the printed Amplify sign-up URL, sign up with `WREN_ADMIN_EMAIL`, confirm the email, and do not make an application request before rerunning.
2. Rerun `npm run deploy`. The workflow recognizes the confirmed user, adds that exact user to Cognito `SystemAdmin`, and temporarily arms Compute for the exact Cognito subject.
3. Sign in once and set `WREN_SMOKE_ACCESS_TOKEN` to that user's fresh Cognito **access token** (from your authenticated client/session tooling), then rerun `npm run deploy`.
4. The workflow verifies `/v1/auth/me` reports `TechnicalAdmin`, immediately redeploys Compute without the bootstrap subject, and performs the full smoke suite. Do not save the access token in a file or commit it.

Until a token is supplied, the exact-subject gate intentionally remains armed so the intended first login can provision the role. Once `WREN_SMOKE_ACCESS_TOKEN` is supplied, cleanup is fail-closed and its obligation is established before any administrator AWS lookup or early return: Compute is redeployed without the subject and the Lambda configuration is independently verified even if the token is expired, the API is unavailable, or `/v1/auth/me` reports the wrong role. If safety cannot be proven, the command exits with an explicit `SECURITY ACTION REQUIRED` message. Resolve that state through a controlled recovery process rather than re-arming the gate casually.

A rerun re-discovers live AWS state; `.wren-deploy/` checkpoints are resumability hints, not the source of truth. Interrupted or action-required deployments retain their checkpoint and immutable image identity for retry. A fully successful deployment retires its checkpoint, so the next invocation generates a fresh millisecond-precise image tag and rebuilds current source. Correct the requested action and invoke the same command. Exit code `3` means a safe human action is required; exit code `1` means a command or verification failed. A target-specific lock prevents deploy and undeploy from racing; a lock from a confirmed-dead process on the exact same host is reclaimed automatically, while a live, malformed, missing-host, or other-host lock remains blocked for safety.

Preview without changing AWS resources:

```bash
WREN_DRY_RUN=true npm run deploy       # macOS/Linux
```

```powershell
$env:WREN_DRY_RUN = "true"; npm run deploy
```

Dry run performs identity, Bedrock availability, CloudFormation discovery, and local CDK synthesis only. It does not acquire the mutation lock or create/load a deployment checkpoint. Remove/unset `WREN_DRY_RUN` before the real deployment.

### Deployment workflow implementation

The runnable workflow is intentionally kept in source alongside the infrastructure rather than duplicated as a second runbook:

- Root command bootstrap: [`scripts/wren-ops.mjs`](../scripts/wren-ops.mjs)
- Deploy orchestration: [`cdk/scripts/deploy.ts`](../cdk/scripts/deploy.ts) and [`cdk/scripts/operations/deployWorkflow.ts`](../cdk/scripts/operations/deployWorkflow.ts)
- Protected teardown: [`cdk/scripts/undeploy.ts`](../cdk/scripts/undeploy.ts) and [`cdk/scripts/operations/undeployWorkflow.ts`](../cdk/scripts/operations/undeployWorkflow.ts)
- Configuration, checkpointing, AWS discovery, redaction, and shell-free execution: [`cdk/scripts/operations/`](../cdk/scripts/operations/)

Use this guide for operator inputs, safety gates, and recovery behavior. Consult the linked workflow modules when extending the deployment sequence or diagnosing an implementation-specific failure; changes should preserve the documented ordering, secret-handling, and retention guarantees.

### Variables for the standard deployment

For the default hosted deployment, set only the following variables before the first `npm run deploy`. The first-admin token is a follow-up input, not a first-run requirement.

| Variable | Default | Standard deployment use |
| --- | --- | --- |
| `WREN_EXPECTED_ACCOUNT_ID` | unset | Your expected 12-digit AWS account ID. Strongly recommended everywhere; required for production or non-interactive deployments. |
| `WREN_GITHUB_OWNER` / `WREN_GITHUB_REPO` | unset | GitHub owner and repository for the default Amplify-hosted frontend. |
| `WREN_GITHUB_BRANCH` | `main` | GitHub branch deployed by Amplify. |
| `WREN_GITHUB_TOKEN` | unset | GitHub personal access token used to create or update the Amplify secret. It can be omitted on later runs when the required secret already exists. |
| `WREN_ADMIN_EMAIL` | unset | Email address for the intended first administrator. The guided first-admin flow uses this value. |
| `WREN_SMOKE_ACCESS_TOKEN` | unset | Set only after the first administrator signs in: their fresh Cognito access token completes authenticated administrator and application smoke checks. Never commit or persist it. |

All target customization, API-only hosting, CI/CD, ECR ownership, image, recovery, automation, preview, and teardown variables are in [Advanced deployment configuration](./modification-guide.md#advanced-deployment-configuration). Leave them unset for the standard path.

Secrets are redacted from command errors/output. GitHub secret values are passed to AWS through temporary mode-`0600` files that are removed immediately after use.

### Managed versus external ECR

For ownership modes and the mandatory external-repository policy, see [Advanced deployment configuration](./modification-guide.md#advanced-deployment-configuration).

Use the default `WREN_ECR_OWNERSHIP=managed` for new environments. The always-present `Cicd` stack creates the ECR repository and Compute permissions boundary before the image build; enabling CodePipeline is independent. Managed repositories expire only untagged images older than 30 days, so immutable tagged releases remain available for deployment and rollback. If a legacy/manual repository named `{prefix}-feedback-engine` already exists outside CloudFormation, explicitly set `WREN_ECR_OWNERSHIP=external`. The workflow refuses a managed deployment over an external repository and refuses external mode when the repository is missing. External mode also requires a repository policy that allows the `lambda.amazonaws.com` service principal to call `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, and `ecr:BatchCheckLayerAvailability`; deployment stops with an action-required error if that policy is absent or incomplete.

### Optional CodePipeline

CodePipeline is an optional advanced setting; see [Advanced deployment configuration](./modification-guide.md#advanced-deployment-configuration) before enabling it.

Set `WREN_ENABLE_CICD=true` before `npm run deploy`. The workflow creates/updates `{prefix}/cicd/github-pat`, deploys the pipeline only after smoke checks pass, and verifies the exact stages `Source → Build → Deploy → UpdateLambda`. It never removes an existing pipeline during a normal deploy merely because the flag was omitted; rerun with the flag enabled when an existing pipeline is detected. An existing pipeline is not updated during prerequisite setup—the final post-smoke pipeline stage is the only pipeline-bearing update.

### Automated smoke criteria

Deployment is complete only after the hosted frontend (when enabled) returns success; a browser-shaped API `OPTIONS` request validates the exact requested CORS origin, an exact GET allow-method token, and both `authorization` and `content-type` allow-header tokens; authenticated `/v1/auth/me` succeeds; and TechnicalAdmin read-only routes succeed when applicable. The workflow also requires `Active` state for the authorizer, document, admin, audit, feedback orchestrator, feedback engine, diff-anchor-progress, notification, and AppSync authorizer Lambdas, and verifies that both the feedback and document-ingest dead-letter queues are empty.

### Direct-CDK recovery path (advanced only)

> **Do not use this path for a normal deployment.** If you use, or plan to use, `npm run deploy`, stop here: it installs dependencies, bootstraps CDK, establishes ECR ownership, publishes the engine image, deploys stacks, configures hosted deployment inputs, and runs smoke checks.
>
> Use the direct-CDK instructions below only for a deliberate end-to-end direct-CDK recovery or when a documented recovery procedure specifically requires them. Do not switch between direct CDK and the orchestrator mid-deployment without an explicit ECR/CloudFormation ownership migration plan.

The following recovery actions are lettered—not numbered—to show that they are not the next steps after the standard workflow.

#### A. Install dependencies

```bash
git clone <YOUR_REPO_URL> WREN
cd WREN
```

Install **both** the monorepo root and the CDK package. The `Compute` stack bundles workspace packages (`@wren/auth`, `@wren/db-node`, …) from the root `node_modules`.

```bash
npm ci
cd cdk
npm ci
cd ..
```

_Note: If `npm ci` fails with a lockfile mismatch, use `npm install` in the same directories instead._

How Node workspaces, uv/pip pins, and the Feedback Engine image relate: [Dependency Management Guide](./dependency-management.md).

#### B. Bootstrap CDK in two Regions

AWS requires a CDK bootstrap in the **data-plane Region** and in **`us-east-1`** (only because the CloudFront-scoped WAF stack is created there). CloudFront itself remains a global CDN. Run this from `cdk/` **after** `npm ci` in that directory.

<details>
<summary>macOS/Linux</summary>

```bash
cd cdk
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

npx cdk bootstrap "aws://$ACCOUNT/ca-central-1"
npx cdk bootstrap "aws://$ACCOUNT/us-east-1"
cd ..
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
cd cdk
$ACCOUNT = (aws sts get-caller-identity --query Account --output text)

npx cdk bootstrap "aws://$ACCOUNT/ca-central-1"
npx cdk bootstrap "aws://$ACCOUNT/us-east-1"
cd ..
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
cd cdk
for /f %%A in ('aws sts get-caller-identity --query Account --output text') do set ACCOUNT=%%A

npx cdk bootstrap "aws://%ACCOUNT%/ca-central-1"
npx cdk bootstrap "aws://%ACCOUNT%/us-east-1"
cd ..
```

</details>

&nbsp;

You should see CloudFormation stacks named `CDKToolkit` in both regions.

#### C. Choose direct-CDK configuration

All naming and display settings are **CDK context** (or environment variables) — you do not edit source to rebrand.

| Context key | Default | Meaning |
| --- | --- | --- |
| `appName` | `LEON` | UI / email display name (SSM `/wren-dev/config/app-name`) |
| `projectName` | `wren` | Resource naming |
| `environmentName` | `dev` (also in `cdk/cdk.json`) | `dev` / `staging` / `prod` |
| `stackPrefix` | `{projectName}-{environmentName}` | e.g. `wren-dev` |
| `bedrockModelId` | `us.anthropic.claude-sonnet-4-6` | Bedrock model |
| `technicalAdminBootstrapSubject` | unset (**disabled**) | Temporary exact Cognito `sub` allowlist for the first TechnicalAdmin; remove immediately after verified bootstrap |
| `alarmEmail` | unset (**no recipient**) | Optional email recipient for CloudWatch alarms; the recipient must confirm the SNS subscription |
| `region` | `ca-central-1` | Data-plane region (not taken from your AWS CLI default region) |
| `githubOwner` | unset | GitHub org or user (enables Amplify + CI/CD) |
| `githubRepo` | unset | Repository name |
| `githubBranch` | `main` | Pipeline source branch |

Set the GitHub values now if you're ready for hosting; otherwise leave them unset for the core deploy.

> **GitHub context note:** Setting `GITHUB_OWNER`/`GITHUB_REPO` tells direct CDK commands to include `Amplify`; the `Cicd` stack itself is always synthesized because it owns prerequisites, while its pipeline requires `-c enableCicd=true`. Amplify and pipeline source actions reference Secrets Manager entries (`wren-dev/github/token` and `wren-dev/cicd/github-pat`) described in [F. Configure GitHub, Amplify, and CI/CD](#f-configure-github-amplify-and-cicd). The recommended `npm run deploy` path creates or updates those secrets safely.

<details>
<summary>macOS/Linux</summary>

```bash
export GITHUB_OWNER=YourOrgOrUser
export GITHUB_REPO=WREN
export GITHUB_BRANCH=main
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$env:GITHUB_OWNER = "YourOrgOrUser"
$env:GITHUB_REPO = "WREN"
$env:GITHUB_BRANCH = "main"
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
set GITHUB_OWNER=YourOrgOrUser
set GITHUB_REPO=WREN
set GITHUB_BRANCH=main
```

</details>

&nbsp;

> **appName note:** You can override the display name at deploy time without touching context defaults: `npx cdk deploy -c appName="My Coach" -c environmentName=dev`. The default display name is `LEON`.

#### D. Build and push the Feedback Engine image

`Compute` **will fail** if this repository or the `bootstrap` tag is missing.

**4.1 Create the ECR repository**

Use the same prefix as your stacks (default `wren-dev`):

<details>
<summary>macOS/Linux</summary>

```bash
aws ecr create-repository \
  --repository-name wren-dev-feedback-engine \
  --region ca-central-1 \
  --image-scanning-configuration scanOnPush=true
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
aws ecr create-repository `
  --repository-name wren-dev-feedback-engine `
  --region ca-central-1 `
  --image-scanning-configuration scanOnPush=true
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
aws ecr create-repository ^
  --repository-name wren-dev-feedback-engine ^
  --region ca-central-1 ^
  --image-scanning-configuration scanOnPush=true
```

</details>

&nbsp;

If the repository already exists, continue.

> **Manual-path ECR ownership:** the recommended orchestrator defaults to CDK-managed ownership and creates this repository through the always-present `Cicd` prerequisite stack. If you manually created the repository using this section, set `WREN_ECR_OWNERSHIP=external` when switching to `npm run deploy`; the orchestrator will import it by name and will not silently adopt or delete it. Do not alternate ownership modes without an explicit CloudFormation migration plan.

**4.2 Build and push the engine image**

Run this from the **repository root** (not `cdk/`):

<details>
<summary>macOS/Linux</summary>

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=ca-central-1
REPO="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/wren-dev-feedback-engine"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

docker build -t "${REPO}:bootstrap" backend/engine/python/
docker push "${REPO}:bootstrap"
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$ACCOUNT = (aws sts get-caller-identity --query Account --output text)
$REGION = "ca-central-1"
$REPO = "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/wren-dev-feedback-engine"

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

docker build -t "${REPO}:bootstrap" backend/engine/python/
docker push "${REPO}:bootstrap"
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
for /f %%A in ('aws sts get-caller-identity --query Account --output text') do set ACCOUNT=%%A
set REGION=ca-central-1
set REPO=%ACCOUNT%.dkr.ecr.%REGION%.amazonaws.com/wren-dev-feedback-engine

aws ecr get-login-password --region %REGION% | docker login --username AWS --password-stdin %ACCOUNT%.dkr.ecr.%REGION%.amazonaws.com

docker build -t %REPO%:bootstrap backend/engine/python/
docker push %REPO%:bootstrap
```

</details>

&nbsp;

> Do **not** push only the empty `public.ecr.aws/lambda/python:3.12` base image — CloudFormation will succeed, but the Feedback Engine won't run the WREN handler.

Confirm the push:

```bash
aws ecr describe-images --repository-name wren-dev-feedback-engine --region ca-central-1
```

You should see tag `bootstrap`.

#### E. Deploy with CDK

The repository created in direct-CDK recovery action D was created outside CloudFormation, so keep ownership explicit for every direct CDK command in this shell:

```bash
export WREN_ECR_OWNERSHIP=external        # macOS/Linux
```

```powershell
$env:WREN_ECR_OWNERSHIP = "external"      # PowerShell
```

```cmd
set WREN_ECR_OWNERSHIP=external
```

From `cdk/`, synth once to catch errors early:

```bash
cd cdk
npx cdk synth
```

You should see a warning that Amplify is skipped if GitHub context is not set. The `Cicd` prerequisite stack is still synthesized, but CodePipeline remains disabled unless `enableCicd=true`.

Deploy in this order, approving IAM changes when prompted (`y`), or pass `--require-approval never` if your security process allows it:

```bash
npx cdk deploy wren-dev-Config
npx cdk deploy wren-dev-Vpc
npx cdk deploy wren-dev-Storage
npx cdk deploy wren-dev-Cognito
npx cdk deploy wren-dev-Database
```

`Database` takes the longest (RDS + proxy + migration custom resource) — wait until it reaches `CREATE_COMPLETE`. Migrations run automatically against the proxy.

Then:

```bash
npx cdk deploy wren-dev-Compute
npx cdk deploy wren-dev-Api
npx cdk deploy wren-dev-Observability
npx cdk deploy wren-dev-CloudFrontWaf
```

`CloudFrontWaf` deploys to `us-east-1` and may take 10–20 minutes.

Alternatively, once `Config` through `Database` are up and the ECR image exists:

```bash
npx cdk deploy --all
```

_Note: `--all` still skips Amplify/CI-CD without GitHub settings, but it **will** include `Compute` — the ECR `bootstrap` image must already exist._

##### Stacks deployed

| Stack | Description |
| --- | --- |
| `wren-dev-Config` | SSM parameters and Bedrock Guardrail |
| `wren-dev-Vpc` | VPC, subnets, NAT gateway, VPC endpoints, flow logs |
| `wren-dev-Storage` | S3 buckets and DynamoDB conversation table |
| `wren-dev-Cognito` | User pool, app client, `SystemAdmin` group |
| `wren-dev-Database` | RDS PostgreSQL 16.13, RDS Proxy, schema migrations |
| `wren-dev-Compute` | Lambdas, SQS queues, AppSync (realtime) |
| `wren-dev-Api` | REST API Gateway |
| `wren-dev-Observability` | CloudWatch log retention and alarms |
| `wren-dev-CloudFrontWaf` | CloudFront distribution + CloudFront-scoped WAF (stack in `us-east-1`) |
| `wren-dev-Cicd` | ECR repo/import + Compute permissions boundary; optional CodePipeline |
| `wren-dev-Amplify` | Frontend hosting (GitHub context only) |

##### Capture important outputs

```bash
aws cloudformation describe-stacks --stack-name wren-dev-Api --region ca-central-1 --query "Stacks[0].Outputs"
aws cloudformation describe-stacks --stack-name wren-dev-Compute --region ca-central-1 --query "Stacks[0].Outputs"
aws cloudformation describe-stacks --stack-name wren-dev-CloudFrontWaf --region us-east-1 --query "Stacks[0].Outputs"
```

Record:

- **ApiEndpoint** — `https://{apiId}.execute-api.ca-central-1.amazonaws.com/dev/`
- Cognito **user pool id** and **client id** from SSM (the Cognito stack does not export CloudFormation outputs):

```bash
aws ssm get-parameter --name /wren-dev/auth/user-pool-id --region ca-central-1 --query Parameter.Value --output text
aws ssm get-parameter --name /wren-dev/auth/client-id --region ca-central-1 --query Parameter.Value --output text
```

- **AppSyncGraphqlUrl** from the `Compute` stack
- **DistributionDomainName** from `CloudFrontWaf` (API CDN)

_Note: The frontend should call the API Gateway URL (Amplify injects `VITE_API_BASE_URL` from the `Api` stack). CloudFront fronts the API as its default origin, so you can also use the CloudFront domain as an alternate API hostname._

---

## Direct-CDK recovery continuation

> **This section is only for the direct-CDK recovery path above.** It does not follow a standard `npm run deploy` run. The orchestrator creates or updates required hosted-deployment secrets, deploys Amplify, guides first-administrator setup through its action-required reruns, and performs smoke checks. Standard-path operators should follow the exit-code-3 instructions printed by `npm run deploy` instead.

### F. Configure GitHub, Amplify, and CI/CD

This direct-CDK recovery action is optional when you only run the UI locally (see [H. Open the web app](#h-open-the-web-app)). For a direct-CDK hosted deployment, complete it.

**F.1 Create a GitHub personal access token**

Create a **classic** PAT with:

- `repo` (private repo access if the repo is private)
- `admin:repo_hook` (webhooks for Amplify / CodePipeline)

See GitHub's [guide to creating a classic personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic) for step-by-step instructions. Fine-grained tokens are not supported by Amplify or the CodePipeline GitHub source action used in this project.

**Once you create a token, note down its value** — you'll store it in Secrets Manager, not in git.

**F.2 Store secrets in AWS**

Names must match the CDK app (default prefix `wren-dev`):

<details>
<summary>macOS/Linux</summary>

```bash
aws secretsmanager create-secret \
  --name "wren-dev/github/token" \
  --secret-string "YOUR_GITHUB_PAT" \
  --region ca-central-1

aws secretsmanager create-secret \
  --name "wren-dev/cicd/github-pat" \
  --secret-string "YOUR_GITHUB_PAT" \
  --region ca-central-1
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
aws secretsmanager create-secret `
  --name "wren-dev/github/token" `
  --secret-string "YOUR_GITHUB_PAT" `
  --region ca-central-1

aws secretsmanager create-secret `
  --name "wren-dev/cicd/github-pat" `
  --secret-string "YOUR_GITHUB_PAT" `
  --region ca-central-1
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
aws secretsmanager create-secret ^
  --name "wren-dev/github/token" ^
  --secret-string "YOUR_GITHUB_PAT" ^
  --region ca-central-1

aws secretsmanager create-secret ^
  --name "wren-dev/cicd/github-pat" ^
  --secret-string "YOUR_GITHUB_PAT" ^
  --region ca-central-1
```

</details>

&nbsp;

`Amplify` uses `wren-dev/github/token`. The pipeline uses `wren-dev/cicd/github-pat`. The same PAT can be stored in both secrets.

If a secret already exists, update it instead:

```bash
aws secretsmanager put-secret-value --secret-id "wren-dev/github/token" --secret-string "YOUR_GITHUB_PAT" --region ca-central-1
```

**F.3 Deploy Amplify (required for hosted UI)**

From `cdk/`:

```bash
npx cdk deploy wren-dev-Amplify \
  -c githubOwner=YourOrgOrUser \
  -c githubRepo=WREN \
  -c githubBranch=main
```

Or set `GITHUB_OWNER` / `GITHUB_REPO` in the environment (see [C. Choose direct-CDK configuration](#c-choose-direct-cdk-configuration)) and run `npx cdk deploy wren-dev-Amplify`.

Amplify builds `frontend/` with Node 22 and injects:

- `VITE_API_BASE_URL` — API Gateway stage URL
- `VITE_APP_NAME` — CDK `appName`
- `VITE_ENVIRONMENT` — `dev` (or your `environmentName`)
- `VITE_USE_LIVE_API=true`
- `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_CLIENT_ID`
- `VITE_AWS_REGION`
- `VITE_APPSYNC_URL`

Get the URL:

```bash
aws cloudformation describe-stacks --stack-name wren-dev-Amplify --region ca-central-1 --query "Stacks[0].Outputs"
```

`AmplifyDefaultDomain` looks like `main.dxxxxxxxx.amplifyapp.com`. The first Amplify build starts on deploy — watch **Amplify → Hosting → your app → main** until the build is green.

> Amplify deploys the configured `githubBranch` (default **`main`**). If your default branch differs, pass `-c githubBranch=...` for direct CDK commands or set `WREN_GITHUB_BRANCH` for the orchestrator.

**F.4 Deploy CI/CD (optional)**

The pipeline builds the Python engine image, pushes it to ECR, and updates the `Compute` Lambda.

```bash
npx cdk deploy wren-dev-Cicd \
  -c githubOwner=YourOrgOrUser \
  -c githubRepo=WREN \
  -c githubBranch=main \
  -c enableCicd=true \
  -c ecrOwnership=external
```

Requirements:

- Secret `wren-dev/cicd/github-pat` exists
- The PAT can read the repo and create webhooks
- Source branch exists (`main` by default)

_Note: direct CDK operation must use the deployed repository's ownership mode. Use `ecrOwnership=managed` when the Cicd stack owns ECR, or `ecrOwnership=external` for a verified manually created repository. The orchestrator discovers and enforces this distinction; it will not silently adopt a repository._

### G. Configure the first administrator

TechnicalAdmin bootstrap is **off by default**. It succeeds only when all three conditions are true on the first application login: the verified Cognito `sub` exactly matches temporary CDK context `technicalAdminBootstrapSubject`, the user belongs to `SystemAdmin`, and no `app_user` exists for either that subject or email. Group membership alone never grants an application role.

1. Open the Amplify URL, **sign up**, and enter the email verification code. **Do not log in yet.**
2. Retrieve the new user's Cognito `Username` and exact `sub`, then add that username to `SystemAdmin`.

<details>
<summary>macOS/Linux</summary>

```bash
ADMIN_EMAIL="admin@example.com"
POOL_ID=$(aws ssm get-parameter --name /wren-dev/auth/user-pool-id --region ca-central-1 --query Parameter.Value --output text)
ADMIN_USERNAME=$(aws cognito-idp list-users --user-pool-id "$POOL_ID" --region ca-central-1 --filter "email = \"$ADMIN_EMAIL\"" --query "Users[0].Username" --output text)
ADMIN_SUBJECT=$(aws cognito-idp list-users --user-pool-id "$POOL_ID" --region ca-central-1 --filter "email = \"$ADMIN_EMAIL\"" --query "Users[0].Attributes[?Name=='sub'].Value | [0]" --output text)
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID" --username "$ADMIN_USERNAME" --group-name SystemAdmin --region ca-central-1
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$AdminEmail = "admin@example.com"
$PoolId = aws ssm get-parameter --name /wren-dev/auth/user-pool-id --region ca-central-1 --query Parameter.Value --output text
$User = (aws cognito-idp list-users --user-pool-id $PoolId --region ca-central-1 --filter "email = `"$AdminEmail`"" --max-results 1 | ConvertFrom-Json).Users[0]
$AdminUsername = $User.Username
$AdminSubject = ($User.Attributes | Where-Object Name -eq "sub").Value
aws cognito-idp admin-add-user-to-group --user-pool-id $PoolId --username $AdminUsername --group-name SystemAdmin --region ca-central-1
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
set ADMIN_EMAIL=admin@example.com
for /f %%A in ('aws ssm get-parameter --name /wren-dev/auth/user-pool-id --region ca-central-1 --query Parameter.Value --output text') do set POOL_ID=%%A
aws cognito-idp list-users --user-pool-id %POOL_ID% --region ca-central-1 --filter "email = \"%ADMIN_EMAIL%\"" --max-results 1 --output json

rem Copy Users[0].Username and the Attributes entry named sub from the output.
set ADMIN_USERNAME=PASTE_USERNAME_HERE
set ADMIN_SUBJECT=PASTE_SUB_VALUE_HERE
aws cognito-idp admin-add-user-to-group --user-pool-id %POOL_ID% --username %ADMIN_USERNAME% --group-name SystemAdmin --region ca-central-1
```

</details>

&nbsp;

3. From the repository root, temporarily enable the exact-subject allowlist and redeploy **Compute only**:

<details>
<summary>macOS/Linux</summary>

```bash
cd cdk
npx cdk deploy wren-dev-Compute -c technicalAdminBootstrapSubject="$ADMIN_SUBJECT"
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
cd cdk
npx cdk deploy wren-dev-Compute -c technicalAdminBootstrapSubject=$AdminSubject
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
cd cdk
npx cdk deploy wren-dev-Compute -c technicalAdminBootstrapSubject=%ADMIN_SUBJECT%
```

</details>

&nbsp;

4. Log in to the application **once** with that account. This first login creates the genuinely new `app_user` and assigns `TechnicalAdmin`.
5. Verify the bootstrap before disabling it: open **System Configuration** and confirm its protected data loads successfully. If it does not, stop and use the troubleshooting note below; repeated logins or changing Cognito groups cannot escalate an existing application user.
6. Remove the temporary context by redeploying Compute **without** `technicalAdminBootstrapSubject`:

```bash
npx cdk deploy wren-dev-Compute
```

This command is identical in bash, PowerShell, and Windows CMD. Confirm the deployment reports an update to the authorizer Lambda. Future users, including `SystemAdmin` group members, now provision as `Student` unless an application administrator assigns another role through the application.

> **Do not leave the context enabled.** The exact subject check limits exposure, but removing it and redeploying Compute restores the secure default-off state. Do not substitute an email, Cognito username, or group name for the exact `sub` value.

### H. Open the web app

Navigate to the Amplify URL (found in the Amplify console, or via `AmplifyDefaultDomain` above) to see the application running.

**Default URL format:** `https://main.<app-id>.amplifyapp.com`

#### Run the frontend locally (without Amplify)

From `frontend/`:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
VITE_APP_NAME="LEON"
VITE_ENVIRONMENT="dev"
VITE_API_BASE_URL="https://{apiId}.execute-api.ca-central-1.amazonaws.com/dev"
VITE_USE_LIVE_API="true"
VITE_COGNITO_USER_POOL_ID="..."
VITE_COGNITO_CLIENT_ID="..."
VITE_AWS_REGION="ca-central-1"
VITE_APPSYNC_URL="https://....appsync-api.ca-central-1.amazonaws.com/graphql"
```

Then:

```bash
cd frontend
npm ci
npm run dev
```

### I. Confirm the application is running

Work through this checklist:

1. Amplify URL loads the React web app (not a 404 on refresh — the rewrite to `index.html` is configured).
2. Sign-up / sign-in with Cognito succeeds.
3. After login, the dashboard loads (API authorizer + database are reachable).
4. As System Admin (TechnicalAdmin), open **System Configuration** (model and usage limits).
5. Upload or create a document and request feedback — the job is queued on SQS, and the Python engine Lambda must succeed.
6. If debrief realtime is enabled, AppSync subscriptions should connect; otherwise the UI falls back to polling.

Useful log groups in `ca-central-1` (prefix `wren-dev-`):

- `/aws/lambda/wren-dev-authorizer`
- `/aws/lambda/wren-dev-document`
- `/aws/lambda/wren-dev-feedback-orchestrator`
- `/aws/lambda/wren-dev-feedback-engine`
- `/aws/lambda/wren-dev-admin`

_Note: If feedback fails, check Bedrock model access and the Feedback Engine logs first._

---

## Day-2 Operations

**Standard redeploy after a code change:** run the same orchestrated command from the repository root:

```bash
npm run deploy
```

It re-discovers AWS state, builds and deploys the current application safely, and preserves the standard ownership and verification safeguards.

**Direct-CDK operations (advanced only):** use `npx cdk deploy` only when you are deliberately operating the direct-CDK recovery path or following a controlled infrastructure-change runbook. Do not substitute it for a normal application deployment.

```bash
cd cdk
npx cdk deploy --all
```

Include GitHub context if you need Amplify/CI-CD in the synth.

**Change display name or Bedrock model:**

```bash
npx cdk deploy wren-dev-Config -c appName="My Coach" -c bedrockModelId="YOUR_MODEL_ID"
```

Redeploy `Compute` if Lambdas bake `BEDROCK_MODEL_ID` from synth-time config. Runtime SSM is `/wren-dev/config/bedrock-model-id`. `VITE_APP_NAME` updates on the next Amplify stack deploy + frontend rebuild.

**Update only the Feedback Engine image:** for a standard deployment, run `npm run deploy` to build, publish, and deploy a new immutable image. For direct-CDK recovery, follow the image and hosting/pipeline procedure in [D. Build and push the Feedback Engine image](#d-build-and-push-the-feedback-engine-image) and [F. Configure GitHub, Amplify, and CI/CD](#f-configure-github-amplify-and-cicd), or let the CI/CD pipeline run on push to `main`.

**Database migrations:** SQL files live in `backend/database/migrations/`. The `Database` stack's migration Lambda runs them on deploy when the custom resource updates — new files must be included in the Lambda bundle (already copied by `MigrationRunner`). After adding a migration, use `npm run deploy` for the standard workflow; direct-CDK recovery can redeploy `wren-dev-Database`.

---

### VPC Endpoint Cost and Security Change Runbook

The VPC stack keeps the no-hourly-cost S3 and DynamoDB gateway endpoints and three paid interface endpoints: **Secrets Manager**, **SSM**, and **Bedrock Runtime**. These three have active VPC Lambda callers. The RDS control-plane and `execute-api` interface endpoints are intentionally absent: PostgreSQL uses RDS Proxy over TLS, and the REST API is Regional rather than private.

> **Important:** Never delete a VPC endpoint in the AWS Console. Change `NetworkResources` and deploy `wren-dev-Vpc` so CloudFormation remains the source of truth. The unrelated `com.amazonaws.vpce.ca-central-1.vpce-svc-*` PrivateLink endpoint is not managed by this app and is out of scope.

#### 1. Establish a read-only baseline

Run the evidence collector before any endpoint change. It reads CloudFormation, EC2, Flow Logs, CloudTrail, and Cost Explorer only; it does not print secret values or mutate AWS resources. The report expects five managed interface endpoints in `baseline` mode and three in `post-removal` mode.

<details>
<summary>macOS/Linux</summary>

```bash
cd cdk
npx tsx scripts/vpcEndpointBaseline.ts \
  --profile wren-dev \
  --region ca-central-1 \
  --stack-prefix wren-dev \
  --phase baseline \
  --out ../artifacts/wren-dev-vpc-baseline.json
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
cd cdk
npx tsx scripts/vpcEndpointBaseline.ts `
  --profile wren-dev `
  --region ca-central-1 `
  --stack-prefix wren-dev `
  --phase baseline `
  --out ..\artifacts\wren-dev-vpc-baseline.json
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
cd cdk
npx tsx scripts/vpcEndpointBaseline.ts ^
  --profile wren-dev ^
  --region ca-central-1 ^
  --stack-prefix wren-dev ^
  --phase baseline ^
  --out ..\artifacts\wren-dev-vpc-baseline.json
```

</details>

The report must show one available NAT gateway, a successful `ALL`-traffic VPC Flow Log, two subnets for each managed interface endpoint, available S3/DynamoDB gateway endpoints with route-table associations, and no unexpected managed interface services. It records an unavailable Cost Explorer query as a warning; resolve that permission gap before making a savings claim.

#### 2. Configure and understand monitoring

Configure a confirmed alarm recipient before making production infrastructure changes. The reusable account-neutral setup, alert thresholds, verification commands, and operational limitations are in the [Monitoring and Operational Ownership](./modification-guide.md#monitoring-and-operational-ownership) section of the modification guide.

#### 3. Deploy and verify the combined endpoint removal

First inspect the change set/diff. It must delete only the two managed endpoint resources (`RdsEndpoint` and `ApiGatewayEndpoint`) and must not alter the NAT gateway, RDS Proxy, Lambda IAM policies, security groups, gateway endpoints, or the unrelated `vpce-svc-*` endpoint.

```powershell
cd cdk
npx cdk diff wren-dev-Vpc
npx cdk deploy wren-dev-Vpc
```

Immediately run authenticated smoke tests for login, document access, an admin configuration read, feedback processing, and Ask WREN/Bedrock. Then capture the post-deployment report:

```powershell
npx tsx scripts/vpcEndpointBaseline.ts `
  --profile wren-dev `
  --region ca-central-1 `
  --stack-prefix wren-dev `
  --phase post-removal `
  --out ..\artifacts\wren-dev-vpc-post-removal.json
```

Observe representative workload for at least seven calendar days. For two deleted services across two AZs, Cost Explorer should show approximately four fewer endpoint-AZ-hours for every elapsed hour. Compare this with NAT byte usage before claiming savings.

#### 4. Roll back if health evidence regresses

If retained-service access, application smoke tests, Flow Logs, Lambda/API errors, queue/DLQ depth, or NAT health regress, restore the two CDK endpoint declarations in `cdk/lib/constructs/NetworkResources.ts`, run the VPC tests, review `npx cdk diff wren-dev-Vpc`, and redeploy only `wren-dev-Vpc`. Do not manually recreate endpoints outside CloudFormation.

## Troubleshooting

### Common Issues

For a failed standard deployment, first complete the action printed by `npm run deploy` and rerun that same command. The direct CDK, bootstrap, ECR, and individual-stack commands in the entries below apply only when you deliberately use the [direct-CDK recovery path](#direct-cdk-recovery-path-advanced-only).

**Issue: `npm run deploy` exits with code 3**

- Solution: this is an intentional action-required pause, not a rollback. Complete the exact printed Bedrock, Cognito sign-up/confirmation, access-token, ownership, or CloudFormation recovery action and rerun the same command. Live AWS state is rediscovered.

**Issue: checkpoint configuration does not match**

- Solution: use the same account, Region, project/environment prefix, branch, and ownership mode as the original operation. If you intentionally changed the target configuration, archive the matching non-secret file under `.wren-deploy/` and start a new operation only after confirming no deploy/undeploy is active. Never copy checkpoints between accounts.

**Issue: ECR exists outside the Cicd stack**

- Solution: verify that `{prefix}-feedback-engine` is the intended legacy/manual repository, then set `WREN_ECR_OWNERSHIP=external`. Do not delete or import it merely to bypass the ownership gate.

**Issue: an existing pipeline is detected while CI/CD is disabled**

- Solution: normal deployment will not implicitly remove it. Set `WREN_ENABLE_CICD=true` and rerun. Protected undeploy explicitly disables it before destroying Compute.

**Issue: `Source image …:bootstrap does not exist`**

- Solution: for the standard workflow, do not create or push the image manually—rerun `npm run deploy` after correcting its reported ECR/ownership failure. The ECR repository/tag procedure in [D. Build and push the Feedback Engine image](#d-build-and-push-the-feedback-engine-image) is for direct-CDK recovery only.

**Issue: `Cannot find module '@aws-cdk/aws-amplify-alpha'`**

- Solution: for `npm run deploy`, resolve any reported dependency-install failure and rerun the command; it installs CDK dependencies itself. Run `npm ci` in `cdk/` manually only for direct-CDK recovery.

**Issue: `Cannot find module '@wren/…'` in a Lambda**

- Solution: Bundling skipped workspace packages — install root `npm ci` and do not restore `externalModules` for those packages.

**Issue: `npx canceled due to missing packages: esbuild`**

- Solution: esbuild isn't at the repo root — run `npm ci` at the repository root.

**Issue: Database migrate fails with `ECONNRESET`**

- Solution: the proxy target was not ready. For the standard workflow, rerun `npm run deploy`; for direct-CDK recovery, retry the `Database` deployment.

**Issue: `Cannot find version … for postgres`**

- Solution: The engine version isn't available in this region. The stack uses `VER_16_13` — don't pin an unavailable minor version.

**Issue: Amplify stack fails on the GitHub token**

- Solution: for the standard workflow, re-export `WREN_GITHUB_TOKEN` and rerun `npm run deploy`; it creates or updates the required secret. Creating `wren-dev/github/token` directly is a direct-CDK recovery operation.

**Issue: Pipeline error `[GitHub] No Branch [main]`**

- Solution: Confirm the branch name, PAT scopes, and org SSO authorization.

**Issue: Amplify build fails on `npm ci`**

- Solution: Check the lockfile and Node version — Amplify sets `NODE_VERSION=22`; keep lockfiles committed.

**Issue: Feedback jobs stay in the queue**

- Solution: The engine image may be a stub, Bedrock access may be denied, or there's a VPC/DNS issue. Check `wren-dev-feedback-engine` logs, confirm Bedrock access, and confirm the image contains `handler.handler`.

**Issue: Sign-up email never arrives**

- Solution: Check junk/spam — Cognito's default email has limited volume. For higher volume, attach an SES identity.

**Issue: User is not Technical Admin**

- Solution: All bootstrap gates must be present on the genuinely first application login: exact `technicalAdminBootstrapSubject`, `SystemAdmin` membership, and no existing subject/email row. Do not keep retrying or leave bootstrap enabled; remove the context and redeploy Compute. Assign the role through the application once a Technical Admin exists, or follow your controlled database recovery procedure.

**Issue: `cdk deploy` puts resources in the wrong region**

- Solution: Region is **CDK context**, defaulting to `ca-central-1` — it doesn't follow `CDK_DEFAULT_REGION`. Override with `-c region=...` only if you intend to leave the residency default.

**Issue: CloudFront stack fails in `us-east-1`**

- Solution: for a standard deployment, rerun `npm run deploy` after resolving the reported bootstrap permission/account issue; it bootstraps both Regions. Run `npx cdk bootstrap aws://ACCOUNT/us-east-1` only for direct-CDK recovery.

**Issue: `Fn::Sub` / OpenAPI errors on the `Api` stack**

- Solution: Stale local change to spec injection — deploy the current `ApiStack` `resolveSpec()` code and don't reintroduce string-injection of `Fn::Sub`.

_The issues listed above represent the most common historical deploy bugs encountered in this repo, all of which have been resolved._

---

## Cleanup

### Protected application teardown (recommended)

`npm run undeploy` is intentionally conservative. It validates the current AWS account, inventories both Regions, and quiesces an existing WREN CodePipeline before removing it: inbound transitions to `Build`, `Deploy`, and `UpdateLambda` are disabled, active executions are stopped without abandoning in-flight actions, and the workflow waits for executions plus the Compute stack to settle. Only then does it update `Cicd` to remove pipeline resources and destroy:

```text
Amplify → CloudFrontWaf → Observability → Api → Compute
```

It does **not** destroy `Cicd` prerequisites, `Database`, `Cognito`, `Storage`, `Vpc`, `Config`, or either `CDKToolkit` stack. It never disables RDS deletion protection and never explicitly deletes retained RDS, S3, DynamoDB, KMS, ECR, Secrets Manager, CloudWatch Logs, or bootstrap resources. At completion it prints a retained manifest. The Compute audit pseudonym salt is one of those retained secrets; a later `npm run deploy` detects and imports the orphaned fixed-name salt instead of recreating it, preserving stable pseudonyms across protected teardown and redeploy.

Inventory the target first; dry run requires no confirmation and performs no mutating command:

<details>
<summary>macOS/Linux</summary>

```bash
WREN_DRY_RUN=true npm run undeploy
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$env:WREN_DRY_RUN = "true"
npm run undeploy
Remove-Item Env:WREN_DRY_RUN
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
set WREN_DRY_RUN=true
npm run undeploy
set WREN_DRY_RUN=
```

</details>

For the real protected teardown, set the exact confirmation string printed by the dry run: `{account}/{region}/{stackPrefix}`. If Amplify exists, also provide its GitHub owner/repository so CDK can synthesize that stack for deletion.

<details>
<summary>macOS/Linux</summary>

```bash
export WREN_EXPECTED_ACCOUNT_ID=123456789012
export WREN_GITHUB_OWNER=YourOrgOrUser
export WREN_GITHUB_REPO=WREN
export WREN_UNDEPLOY_CONFIRM=123456789012/ca-central-1/wren-dev
npm run undeploy
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$env:WREN_EXPECTED_ACCOUNT_ID = "123456789012"
$env:WREN_GITHUB_OWNER = "YourOrgOrUser"
$env:WREN_GITHUB_REPO = "WREN"
$env:WREN_UNDEPLOY_CONFIRM = "123456789012/ca-central-1/wren-dev"
npm run undeploy
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
set WREN_EXPECTED_ACCOUNT_ID=123456789012
set WREN_GITHUB_OWNER=YourOrgOrUser
set WREN_GITHUB_REPO=WREN
set WREN_UNDEPLOY_CONFIRM=123456789012/ca-central-1/wren-dev
npm run undeploy
```

</details>

If the command stops, resolve the reported CloudFormation/ownership issue and rerun with the same target. Live AWS discovery remains authoritative; the undeploy checkpoint only records progress.

> **Cost warning:** protected teardown does not stop all spend. In particular, retained RDS/RDS Proxy, NAT/VPC, interface endpoints, storage, backups, secrets, and ECR can continue incurring charges. Review the retained manifest and AWS Cost Explorer.

### Full data destruction is a separate manual operation

A complete purge is deliberately not automated by this repository. It is irreversible and may conflict with retention, legal, backup, or incident-response requirements. Use an approved runbook with independent account/prefix verification, backups or final snapshots where required, explicit authorization to disable RDS deletion protection, controlled emptying of retained buckets/repositories, and post-deletion cost/inventory checks. Never run `cdk destroy --all` as a substitute: protected and retained resources can remain while dependent deletions fail, leaving an ambiguous partial teardown.

---

## Quick Reference - First-Time Commands

After AWS CLI/SSO login, Docker startup, and Bedrock model access:

<details>
<summary>macOS/Linux</summary>

```bash
git clone <YOUR_REPO_URL> WREN
cd WREN
export WREN_EXPECTED_ACCOUNT_ID=123456789012
export WREN_GITHUB_OWNER=YourOrgOrUser
export WREN_GITHUB_REPO=WREN
export WREN_GITHUB_TOKEN='YOUR_GITHUB_PAT'
export WREN_ADMIN_EMAIL=admin@example.com
npm run deploy
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
git clone <YOUR_REPO_URL> WREN
Set-Location WREN
$env:WREN_EXPECTED_ACCOUNT_ID = "123456789012"
$env:WREN_GITHUB_OWNER = "YourOrgOrUser"
$env:WREN_GITHUB_REPO = "WREN"
$env:WREN_GITHUB_TOKEN = "YOUR_GITHUB_PAT"
$env:WREN_ADMIN_EMAIL = "admin@example.com"
npm run deploy
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
git clone <YOUR_REPO_URL> WREN
cd WREN
set WREN_EXPECTED_ACCOUNT_ID=123456789012
set WREN_GITHUB_OWNER=YourOrgOrUser
set WREN_GITHUB_REPO=WREN
set WREN_GITHUB_TOKEN=YOUR_GITHUB_PAT
set WREN_ADMIN_EMAIL=admin@example.com
npm run deploy
```

</details>

Follow each exit-code-3 instruction and rerun. After the intended administrator has signed in once, export a fresh `WREN_SMOKE_ACCESS_TOKEN` and rerun to complete authenticated admin verification, remove the temporary bootstrap subject, execute smoke checks, and (when enabled) finalize CodePipeline.
