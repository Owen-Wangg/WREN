# WREN — AWS Deployment Guide

This guide deploys the WREN writing coach (repository and AWS prefix **WREN**) into an AWS account. AWS resource names use the `wren` project prefix; **LEON** is the user-facing display name shown in the UI and emails.

## Table of Contents

- [WREN — AWS Deployment Guide](#wren--aws-deployment-guide)
  - [Table of Contents](#table-of-contents)
  - [What You'll Have When You're Done](#what-youll-have-when-youre-done)
  - [Architecture at a Glance](#architecture-at-a-glance)
  - [Requirements](#requirements)
    - [Access Tokens](#access-tokens)
    - [Enable and Verify Bedrock Model Access](#enable-and-verify-bedrock-model-access)
  - [AWS credentials](#aws-credentials)
  - [Deployment](#deployment)
    - [Deployment workflow implementation](#deployment-workflow-implementation)
    - [Variables for the standard deployment](#variables-for-the-standard-deployment)
  - [Troubleshooting](#troubleshooting)
    - [Common Issues](#common-issues)
  - [Cleanup](#cleanup)
    - [Protected application teardown (recommended)](#protected-application-teardown-recommended)
    - [Full data destruction is a separate manual operation](#full-data-destruction-is-a-separate-manual-operation)

---

## What You'll Have When You're Done

- A React frontend on **AWS Amplify** (optional until GitHub is connected)
- REST APIs on **API Gateway**, fronted by **CloudFront + WAF**
- Node.js and Python **Lambda** backends running in a VPC
- **Amazon RDS PostgreSQL 16** (private), behind **RDS Proxy**
- **Cognito** sign-up / sign-in
- **Amazon Bedrock** for writing feedback
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
| `Cicd` | Data-plane Region | Always-present ECR repo/import + Compute permissions boundary; CodePipeline built by default (opt out with `WREN_ENABLE_CICD=false`) |
| `Compute` | Data-plane Region | Named Lambdas (Document, Admin, Audit, Feedback Orchestrator, Feedback Engine, Notification, authorizers), SQS, AppSync |
| `Api` | Data-plane Region | REST API Gateway from `cdk/lib/openapi.yaml` |
| `Observability` | Data-plane Region | CloudWatch log retention and alarms |
| `CloudFrontWaf` | `us-east-1` (WAF control plane for CloudFront scope) | CloudFront distribution + CloudFront-scoped WAF |
| `Amplify` | Data-plane Region | Frontend hosting (only if GitHub owner/repo are set) |

> **Use `npm run deploy` for normal deployments.**
>
> `Amplify` and the CI/CD pipeline are both enabled by default, so the standard path builds them and requires GitHub owner/repo variables plus a `WREN_GITHUB_TOKEN` on first setup. Opt out of the pipeline with `WREN_ENABLE_CICD=false`; the `Cicd` prerequisite stack remains present either way.

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

### Access Tokens

You also need a GitHub repository this account can read (fork or the original) and a GitHub personal access token (PAT);

### Enable and Verify Bedrock Model Access

Without model access, the app deploys but **feedback generation fails at runtime**.

---

## AWS credentials

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
---

## Deployment

Before running the command, complete these prerequisites:

1. Configure or sign in to AWS using the standard credential chain (for example, `aws configure sso` and your SSO login) and confirm the intended account with `aws sts get-caller-identity`.
2. Enable access to the configured Bedrock model/inference profile in the target Region.
3. Start Docker Desktop and confirm its daemon is running.

For the default hosted deployment, set the target, GitHub source, PAT, and intended first administrator before running the command. `WREN_EXPECTED_ACCOUNT_ID` is strongly recommended everywhere and required for production or non-interactive runs. **Choose exactly one of the following command blocks for your terminal, replace the placeholder values, and run it from the repository root.**

<details>
<summary>macOS/Linux</summary>

```bash
export WREN_EXPECTED_ACCOUNT_ID=YourAccountId
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
$env:WREN_EXPECTED_ACCOUNT_ID = "YourAccountId"
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
set WREN_EXPECTED_ACCOUNT_ID=YourAccountID
set WREN_GITHUB_OWNER=YourOrgOrUser
set WREN_GITHUB_REPO=WREN
set WREN_GITHUB_BRANCH=main
set WREN_GITHUB_TOKEN=YOUR_GITHUB_PAT
set WREN_ADMIN_EMAIL=admin@example.com
npm run deploy
```

</details>

The first run normally pauses with exit code **3** when human action is required. Setting up the first administrator takes three `npm run deploy` runs, because the workflow will not grant admin rights from a config value alone — it makes the intended user sign in and prove their identity first.

1. **Create the account.** Follow the printed Amplify sign-up URL, sign up using the address in `WREN_ADMIN_EMAIL`, and confirm the email. Do not use the app yet.
2. **Claim the admin role.** Rerun `npm run deploy`. The workflow finds the confirmed user, adds them to Cognito `SystemAdmin`, and temporarily flags their account for admin verification. It then pauses and asks for a `WREN_SMOKE_ACCESS_TOKEN`.
3. **Prove the identity.** Sign in to the app once as that user and copy their login token (see "How to get the token" below). Set it as `WREN_SMOKE_ACCESS_TOKEN` and rerun `npm run deploy`.
4. The workflow confirms the signed-in user is really an admin, removes the temporary verification flag, and runs its final checks. You're done. Don't save the token or commit it — it expires on its own and is only needed for this one run.

**What `WREN_SMOKE_ACCESS_TOKEN` is:** a temporary login token for the first admin, created when they sign in. You don't invent it — you copy it from a real sign-in. The deploy uses it to confirm the person named in `WREN_ADMIN_EMAIL` really is an admin before finishing. It stops working after about an hour, so get it right before you rerun.

**How to get the token** — pick either way:

**Option 1 — from the browser.** Sign in to the app, open your browser's developer tools (F12), go to Application → Local Storage, and copy the value whose name ends in `.accessToken`.

**Option 2 — from the command line (no browser).** Run the snippet below with the admin's email and password. It looks up the account details for you; you only need to set `prefix` to match your deployment (it's `wren-dev` unless you changed it).

<details>
<summary>PowerShell — set the token in one step</summary>

```powershell
$prefix = "wren-dev"                 # change if your deployment uses a different prefix
$email  = "admin@example.com"        # the first admin's email
$password = Read-Host "Admin password"   # you'll be prompted; nothing is saved

$clientId = aws ssm get-parameter --name "/$prefix/auth/client-id" --query Parameter.Value --output text

$env:WREN_SMOKE_ACCESS_TOKEN = aws cognito-idp initiate-auth `
  --auth-flow USER_PASSWORD_AUTH `
  --client-id $clientId `
  --auth-parameters "USERNAME=$email,PASSWORD=$password" `
  --query "AuthenticationResult.AccessToken" --output text
npm run deploy
```

</details>

<details>
<summary>macOS/Linux (bash) — set the token in one step</summary>

```bash
PREFIX="wren-dev"                 # change if your deployment uses a different prefix
EMAIL="admin@example.com"         # the first admin's email
read -rsp "Admin password: " PASSWORD; echo   # you'll be prompted; nothing is saved

CLIENT_ID=$(aws ssm get-parameter --name "/$PREFIX/auth/client-id" --query Parameter.Value --output text)

export WREN_SMOKE_ACCESS_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=$EMAIL,PASSWORD=$PASSWORD" \
  --query "AuthenticationResult.AccessToken" --output text)
npm run deploy
```

</details>

If the command prints an empty token instead of a long string, the account probably needs a first sign-in in the browser (for example to set a permanent password or complete two-factor sign-in). Do that once, then run the snippet again.

Whichever way you use, get the token right before you rerun — it stops working after about an hour.

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
| `WREN_GITHUB_TOKEN` | unset | GitHub personal access token used to create the Amplify and CI/CD secrets. **Required on first setup** because CI/CD is built by default; it can be omitted on later runs once both secrets already exist. |
| `WREN_ENABLE_CICD` | `true` | Builds the CodePipeline CI/CD pipeline by default. Leave it at `true` for the standard path; set `false` only to skip the pipeline (the `Cicd` prerequisite stack is still created). |
| `WREN_ADMIN_EMAIL` | unset | Email address for the intended first administrator. The guided first-admin flow uses this value to pick who becomes admin. |
| `WREN_SMOKE_ACCESS_TOKEN` | unset | The first administrator's fresh Cognito **access token**, set only for the final first-admin run (step 3 above). It proves that user authenticates as an admin so the temporary elevation can be removed, and completes the authenticated smoke checks. Copy it from the signed-in session; never commit or persist it. |

All target customization, API-only hosting, CI/CD, ECR ownership, image, recovery, automation, preview, and teardown variables are in [Advanced deployment configuration](./modification-guide.md#advanced-deployment-configuration). Leave them unset for the standard path.

Secrets are redacted from command errors/output. GitHub secret values are passed to AWS through temporary mode-`0600` files that are removed immediately after use.

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

- Solution: this happens only when you explicitly set `WREN_ENABLE_CICD=false` against an environment that already has a pipeline. Normal deployment will not implicitly remove it. Unset the flag (or set `WREN_ENABLE_CICD=true`) and rerun to keep it. Protected undeploy explicitly disables it before destroying Compute.

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
export WREN_EXPECTED_ACCOUNT_ID=YourAccountId
export WREN_GITHUB_OWNER=YourOrgOrUser
export WREN_GITHUB_REPO=WREN
export WREN_UNDEPLOY_CONFIRM=YourAccountId/DeploymentRegion/StackPrefix
npm run undeploy
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$env:WREN_EXPECTED_ACCOUNT_ID = "YourAccountId"
$env:WREN_GITHUB_OWNER = "YourOrgOrUser"
$env:WREN_GITHUB_REPO = "WREN"
$env:WREN_UNDEPLOY_CONFIRM = "YourAccountId/DeploymentRegion/StackPrefix"
npm run undeploy
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
set WREN_EXPECTED_ACCOUNT_ID=YourAccountId
set WREN_GITHUB_OWNER=YourOrgOrUser
set WREN_GITHUB_REPO=WREN
set WREN_UNDEPLOY_CONFIRM=YourAccountId/DeploymentRegion/StackPrefix
npm run undeploy
```

</details>

If the command stops, resolve the reported CloudFormation/ownership issue and rerun with the same target. Live AWS discovery remains authoritative; the undeploy checkpoint only records progress.

> **Cost warning:** protected teardown does not stop all spend. In particular, retained RDS/RDS Proxy, NAT/VPC, interface endpoints, storage, backups, secrets, and ECR can continue incurring charges. Review the retained manifest and AWS Cost Explorer.

### Full data destruction is a separate manual operation

A complete purge is deliberately not automated by this repository. It is irreversible and may conflict with retention, legal, backup, or incident-response requirements. Use an approved runbook with independent account/prefix verification, backups or final snapshots where required, explicit authorization to disable RDS deletion protection, controlled emptying of retained buckets/repositories, and post-deletion cost/inventory checks. Never run `cdk destroy --all` as a substitute: protected and retained resources can remain while dependent deletions fail, leaving an ambiguous partial teardown.

---



