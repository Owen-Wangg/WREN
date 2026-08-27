# WREN — AWS Deployment Guide

This guide deploys the WREN writing coach (repository and AWS prefix **WREN**) into an AWS account using the CDK app in `cdk/`. AWS resource names use the `wren` project prefix; **LEON** is the user-facing display name shown in the UI and emails. Follow the numbered steps in order — commands are given for **bash (macOS/Linux)**, **PowerShell**, and **Windows CMD** where the syntax differs.

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
  - [Pre-Deployment](#pre-deployment)
    - [Step 0: Configure AWS Credentials](#step-0-configure-aws-credentials)
  - [Deployment](#deployment)
    - [Step 1: Clone the Repository and Install Dependencies](#step-1-clone-the-repository-and-install-dependencies)
    - [Step 2: Bootstrap CDK (Two Regions)](#step-2-bootstrap-cdk-two-regions)
    - [Step 3: Choose Configuration](#step-3-choose-configuration)
    - [Step 4: Build and Push the Feedback Engine Image](#step-4-build-and-push-the-feedback-engine-image)
    - [Step 5: CDK Deployment](#step-5-cdk-deployment)
  - [Post-Deployment](#post-deployment)
    - [Step 6: Connect GitHub, Amplify, and CI/CD](#step-6-connect-github-amplify-and-cicd)
    - [Step 7: Configure the First Administrator](#step-7-configure-the-first-administrator)
    - [Step 8: Open the Web App](#step-8-open-the-web-app)
    - [Step 9: Confirm the Application Is Running](#step-9-confirm-the-application-is-running)
  - [Day-2 Operations](#day-2-operations)
  - [Troubleshooting](#troubleshooting)
    - [Common Issues](#common-issues)
  - [Cleanup](#cleanup)
    - [Taking Down the Deployed Stack](#taking-down-the-deployed-stack)
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
| `Cicd` | Data-plane Region | ECR repo + CodePipeline (only if GitHub owner/repo are set) |
| `Compute` | Data-plane Region | Named Lambdas (Document, Admin, Audit, Feedback Orchestrator, Feedback Engine, Notification, authorizers), SQS, AppSync |
| `Api` | Data-plane Region | REST API Gateway from `cdk/lib/openapi.yaml` |
| `Observability` | Data-plane Region | CloudWatch log retention and alarms |
| `CloudFrontWaf` | `us-east-1` (WAF control plane for CloudFront scope) | CloudFront distribution + CloudFront-scoped WAF |
| `Amplify` | Data-plane Region | Frontend hosting (only if GitHub owner/repo are set) |

> **Deploy order matters.** `Compute` looks up an existing ECR repository named `{stackPrefix}-feedback-engine` and an image tagged `bootstrap`. Create that repo and push that tag **before** deploying `Compute` — see [Step 4: Build and Push the Feedback Engine Image](#step-4-build-and-push-the-feedback-engine-image).
>
> `Amplify` and `Cicd` are **skipped** unless GitHub owner and repo context are set. You can deploy the API and data plane first, then add hosting afterward.

---

## Requirements

Before you deploy, you must have the following installed on your device:

- [git](https://git-scm.com/downloads)
- An [AWS Account](https://aws.amazon.com/account/) with permission to create IAM, VPC, RDS, Lambda, API Gateway, Cognito, CloudFront, WAF, Amplify, Bedrock, and KMS resources
- A [GitHub Account](https://github.com/) — only required for hosted frontend / CI-CD (see [Step 6: Connect GitHub, Amplify, and CI/CD](#step-6-connect-github-amplify-and-cicd))
- [AWS CLI](https://aws.amazon.com/cli/) _(v2.0.0+ required)_
- [Node.js](https://nodejs.org/en/learn/getting-started/how-to-install-nodejs) _(v22.x+ required)_
- [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) _(comes with Node)_
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the daemon running — required to build the Feedback Engine image and for CDK asset bundling

> The AWS CDK CLI (`aws-cdk`) is a **dev dependency** of `cdk/` — you do not need a global `cdk` install. All commands below use `npx cdk`. The pinned version is **`2.1138.0`** (see `cdk/package.json`); Node.js v22+ is required by the project's `engines` field and by Amplify's build environment.

### People and Access

For a hosted frontend or CI/CD pipeline you'll also need a GitHub repository this account can read (fork or the original), plus a GitHub personal access token (PAT) — covered in [Step 6: Connect GitHub, Amplify, and CI/CD](#step-6-connect-github-amplify-and-cicd).

### Cost and Time Expectations

This is not a free-tier stack. Typical always-on costs include:

- NAT Gateway (**one** NAT in a two-AZ VPC — private subnets in both AZs send egress through that single NAT)
- RDS `db.t3.medium` + RDS Proxy
- Several **VPC interface endpoints** (Secrets Manager, SSM, RDS, API Gateway, Bedrock), billed per AZ
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

## Pre-Deployment

### Step 0: Configure AWS Credentials

Create or choose an IAM principal with broad deploy rights for the first rollout (`AdministratorAccess`, or a dedicated CDK deploy role).

```bash
aws configure
```

Set:

- Access key / secret (or use SSO: `aws configure sso`)
- Default region `ca-central-1` (the app still pins residency via CDK context)
- Output `json`

Confirm the account you will deploy into:

```bash
aws sts get-caller-identity
```

> Note the `Account` value — CDK uses `CDK_DEFAULT_ACCOUNT` from this identity when you run `npx cdk` from `cdk/`.

Bootstrap CDK **after** you clone the repo and install dependencies ([Deployment Step 2](#step-2-bootstrap-cdk-two-regions)). `npx cdk` must run from `cdk/` with that package's `node_modules` present.

---

## Deployment

### Step 1: Clone the Repository and Install Dependencies

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

### Step 2: Bootstrap CDK (Two Regions)

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

### Step 3: Choose Configuration

All naming and display settings are **CDK context** (or environment variables) — you do not edit source to rebrand.

| Context key | Default | Meaning |
| --- | --- | --- |
| `appName` | `LEON` | UI / email display name (SSM `/wren-dev/config/app-name`) |
| `projectName` | `wren` | Resource naming |
| `environmentName` | `dev` (also in `cdk/cdk.json`) | `dev` / `staging` / `prod` |
| `stackPrefix` | `{projectName}-{environmentName}` | e.g. `wren-dev` |
| `bedrockModelId` | `us.anthropic.claude-sonnet-4-6` | Bedrock model |
| `technicalAdminBootstrapSubject` | unset (**disabled**) | Temporary exact Cognito `sub` allowlist for the first TechnicalAdmin; remove immediately after verified bootstrap |
| `region` | `ca-central-1` | Data-plane region (not taken from your AWS CLI default region) |
| `githubOwner` | unset | GitHub org or user (enables Amplify + CI/CD) |
| `githubRepo` | unset | Repository name |
| `githubBranch` | `main` | Pipeline source branch |

Set the GitHub values now if you're ready for hosting; otherwise leave them unset for the core deploy.

> **GitHub context note:** Setting `GITHUB_OWNER`/`GITHUB_REPO` tells CDK to include the `Amplify` and `Cicd` stacks, but those stacks also require Secrets Manager entries (`wren-dev/github/token` and `wren-dev/cicd/github-pat`) that aren't created until [Step 6](#step-6-connect-github-amplify-and-cicd). If you set these variables now and run `npx cdk deploy --all` before creating those secrets, the Amplify/CICD deploys will fail. The safest path: leave GitHub unset for the core deploy, then return to Step 3 and set these variables before running [Step 6](#step-6-connect-github-amplify-and-cicd).

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

### Step 4: Build and Push the Feedback Engine Image

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

> **Choosing an ECR ownership path.** If you later deploy the `Cicd` stack, it creates this same repository — do not deploy `Cicd` first and also create a conflicting repo with different settings. The reliable first-time path used in this guide is: **manual ECR create → push `bootstrap` → deploy `Compute`**. Add `Cicd` afterward only if you want the pipeline; if `Cicd` fails because the repo name is taken, keep the manual repo and skip `Cicd`, or remove the CDK-managed repo resource and keep using manual pushes. Many teams run CDK CLI deploys and skip `Cicd` entirely.

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

### Step 5: CDK Deployment

From `cdk/`, synth once to catch errors early:

```bash
cd cdk
npx cdk synth
```

You should see a warning that Amplify and CI/CD are skipped if GitHub context is not set — that's expected.

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

#### Stacks Deployed

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
| `wren-dev-Cicd` | ECR repo + CodePipeline (GitHub context only) |
| `wren-dev-Amplify` | Frontend hosting (GitHub context only) |

#### Capture Important Outputs

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

## Post-Deployment

### Step 6: Connect GitHub, Amplify, and CI/CD

Skip this step if you'll only run the UI locally (see [Step 8: Open the Web App](#step-8-open-the-web-app)). For a public URL, complete it.

**6.1 Create a GitHub personal access token**

Create a **classic** PAT with:

- `repo` (private repo access if the repo is private)
- `admin:repo_hook` (webhooks for Amplify / CodePipeline)

See GitHub's [guide to creating a classic personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-personal-access-token-classic) for step-by-step instructions. Fine-grained tokens are not supported by Amplify or the CodePipeline GitHub source action used in this project.

**Once you create a token, note down its value** — you'll store it in Secrets Manager, not in git.

**6.2 Store secrets in AWS**

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

**6.3 Deploy Amplify (required for hosted UI)**

From `cdk/`:

```bash
npx cdk deploy wren-dev-Amplify \
  -c githubOwner=YourOrgOrUser \
  -c githubRepo=WREN \
  -c githubBranch=main
```

Or set `GITHUB_OWNER` / `GITHUB_REPO` in the environment (see [Step 3: Choose Configuration](#step-3-choose-configuration)) and run `npx cdk deploy wren-dev-Amplify`.

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

> Amplify tracks branches **`main`** and **`develop`**. If your default branch is not `main`, pass `-c githubBranch=...` for the pipeline and add/rename the Amplify branch in the console or in `cdk/lib/stacks/AmplifyStack.ts`.

**6.4 Deploy CI/CD (optional)**

The pipeline builds the Python engine image, pushes it to ECR, and updates the `Compute` Lambda.

```bash
npx cdk deploy wren-dev-Cicd \
  -c githubOwner=YourOrgOrUser \
  -c githubRepo=WREN \
  -c githubBranch=main
```

Requirements:

- Secret `wren-dev/cicd/github-pat` exists
- The PAT can read the repo and create webhooks
- Source branch exists (`main` by default)

_Note: If the repo name `wren-dev-feedback-engine` already exists, this stack may fail on ECR create. Prefer skipping `Cicd` and pushing images with the docker commands in [Step 4: Build and Push the Feedback Engine Image](#step-4-build-and-push-the-feedback-engine-image), then updating the Lambda directly:_

```bash
aws lambda update-function-code \
  --function-name wren-dev-feedback-engine \
  --image-uri ACCOUNT.dkr.ecr.ca-central-1.amazonaws.com/wren-dev-feedback-engine:bootstrap \
  --region ca-central-1
```

### Step 7: Configure the First Administrator

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

### Step 8: Open the Web App

Navigate to the Amplify URL (found in the Amplify console, or via `AmplifyDefaultDomain` above) to see the application running.

**Default URL format:** `https://main.<app-id>.amplifyapp.com`

#### Run the Frontend Locally (without Amplify)

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

### Step 9: Confirm the Application Is Running

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

**Redeploy infrastructure after a code change** — from `cdk/`:

```bash
npx cdk deploy --all
```

Include GitHub context if you need Amplify/CI-CD in the synth.

**Change display name or Bedrock model:**

```bash
npx cdk deploy wren-dev-Config -c appName="My Coach" -c bedrockModelId="YOUR_MODEL_ID"
```

Redeploy `Compute` if Lambdas bake `BEDROCK_MODEL_ID` from synth-time config. Runtime SSM is `/wren-dev/config/bedrock-model-id`. `VITE_APP_NAME` updates on the next Amplify stack deploy + frontend rebuild.

**Update only the Feedback Engine image:** build, push a new tag (or overwrite `bootstrap`), then run `lambda update-function-code` as shown in [Step 6.4](#step-6-connect-github-amplify-and-cicd), or let the CI/CD pipeline run on push to `main`.

**Database migrations:** SQL files live in `backend/database/migrations/`. The `Database` stack's migration Lambda runs them on deploy when the custom resource updates — new files must be included in the Lambda bundle (already copied by `MigrationRunner`). After adding a migration, redeploy `wren-dev-Database`.

---

## Troubleshooting

### Common Issues

**Issue: `Source image …:bootstrap does not exist`**

- Solution: ECR repo or tag is missing — complete [Step 4: Build and Push the Feedback Engine Image](#step-4-build-and-push-the-feedback-engine-image).

**Issue: `Cannot find module '@aws-cdk/aws-amplify-alpha'`**

- Solution: CDK deps aren't installed — run `npm ci` in `cdk/`.

**Issue: `Cannot find module '@wren/…'` in a Lambda**

- Solution: Bundling skipped workspace packages — install root `npm ci` and do not restore `externalModules` for those packages.

**Issue: `npx canceled due to missing packages: esbuild`**

- Solution: esbuild isn't at the repo root — run `npm ci` at the repository root.

**Issue: Database migrate fails with `ECONNRESET`**

- Solution: The proxy target wasn't ready. This is already wired around in `DatabaseStack` — retry the `Database` deploy.

**Issue: `Cannot find version … for postgres`**

- Solution: The engine version isn't available in this region. The stack uses `VER_16_13` — don't pin an unavailable minor version.

**Issue: Amplify stack fails on the GitHub token**

- Solution: The secret is missing or misnamed — create `wren-dev/github/token` in `ca-central-1`.

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

- Solution: That region isn't bootstrapped — run `npx cdk bootstrap aws://ACCOUNT/us-east-1`.

**Issue: `Fn::Sub` / OpenAPI errors on the `Api` stack**

- Solution: Stale local change to spec injection — deploy the current `ApiStack` `resolveSpec()` code and don't reintroduce string-injection of `Fn::Sub`.

_The issues listed above represent the most common historical deploy bugs encountered in this repo, all of which have been resolved._

---

## Cleanup

### Taking Down the Deployed Stack

Do **not** run `cdk destroy --all` expecting a clean bill — RDS is created with **deletion protection** and **RETAIN**, S3 buckets may retain objects, ECR images may remain, and Secrets Manager secrets may have a recovery window.

To actually stop spend:

1. **Empty S3 buckets.**
2. **Disable RDS deletion protection**, then delete the instance — this deletes student data. CDK does **not** set `instanceIdentifier`, so the DB name is CloudFormation-generated (not `wren-dev`).
   - Navigate to **Amazon RDS** → **Databases**. Open the instance created by stack `wren-dev-Database` (proxy name `wren-dev-db-proxy` is a reliable companion resource). You can also filter by the `Project` tag `wren-dev`.
   - Select that instance → **Modify**.
   - Scroll to **Deletion protection**, uncheck the box, then **Continue** → **Modify DB instance**.
   - Wait for the modification to complete before proceeding.
3. **Delete the NAT Gateway / VPC** (or destroy the `Vpc` stack after dependents are gone).
4. **Delete CloudFormation stacks in reverse dependency order:**

```text
Amplify → CloudFrontWaf → Observability → Api → Compute → Cicd → Database → Cognito → Storage → Vpc → Config
```

5. **Delete leftovers:** ECR repositories, Secrets Manager secrets, log groups, and the two `CDKToolkit` bootstrap stacks — only if you won't use CDK in those regions again.

_Note: Wait for each stack to finish deleting before starting the next one — some resources have dependencies that must be removed first._

**Cost Warning:** Ensure all resources are deleted to avoid ongoing charges. Pay special attention to RDS instances, NAT Gateways, and Elastic IPs.

---

## Quick Reference - First-Time Commands

From a clean machine, after AWS CLI login, Docker running, and Bedrock access enabled:

<details>
<summary>macOS/Linux</summary>

```bash
git clone <YOUR_REPO_URL> WREN
cd WREN
npm ci
cd cdk; npm ci; cd ..

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
cd cdk
npx cdk bootstrap "aws://$ACCOUNT/ca-central-1"
npx cdk bootstrap "aws://$ACCOUNT/us-east-1"
cd ..

aws ecr create-repository --repository-name wren-dev-feedback-engine --region ca-central-1
REPO="$ACCOUNT.dkr.ecr.ca-central-1.amazonaws.com/wren-dev-feedback-engine"
aws ecr get-login-password --region ca-central-1 | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.ca-central-1.amazonaws.com"
docker build -t "${REPO}:bootstrap" backend/engine/python/
docker push "${REPO}:bootstrap"

cd cdk
npx cdk deploy wren-dev-Config wren-dev-Vpc wren-dev-Storage wren-dev-Cognito wren-dev-Database
npx cdk deploy wren-dev-Compute wren-dev-Api wren-dev-Observability wren-dev-CloudFrontWaf
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
git clone <YOUR_REPO_URL> WREN
cd WREN
npm ci
cd cdk; npm ci; cd ..

$ACCOUNT = (aws sts get-caller-identity --query Account --output text)
cd cdk
npx cdk bootstrap "aws://$ACCOUNT/ca-central-1"
npx cdk bootstrap "aws://$ACCOUNT/us-east-1"
cd ..

aws ecr create-repository --repository-name wren-dev-feedback-engine --region ca-central-1
$REPO = "$ACCOUNT.dkr.ecr.ca-central-1.amazonaws.com/wren-dev-feedback-engine"
aws ecr get-login-password --region ca-central-1 | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.ca-central-1.amazonaws.com"
docker build -t "${REPO}:bootstrap" backend/engine/python/
docker push "${REPO}:bootstrap"

cd cdk
npx cdk deploy wren-dev-Config wren-dev-Vpc wren-dev-Storage wren-dev-Cognito wren-dev-Database
npx cdk deploy wren-dev-Compute wren-dev-Api wren-dev-Observability wren-dev-CloudFrontWaf
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
git clone <YOUR_REPO_URL> WREN
cd WREN
npm ci
cd cdk && npm ci && cd ..

for /f %%A in ('aws sts get-caller-identity --query Account --output text') do set ACCOUNT=%%A
cd cdk
npx cdk bootstrap "aws://%ACCOUNT%/ca-central-1"
npx cdk bootstrap "aws://%ACCOUNT%/us-east-1"
cd ..

aws ecr create-repository --repository-name wren-dev-feedback-engine --region ca-central-1
set REPO=%ACCOUNT%.dkr.ecr.ca-central-1.amazonaws.com/wren-dev-feedback-engine
aws ecr get-login-password --region ca-central-1 | docker login --username AWS --password-stdin %ACCOUNT%.dkr.ecr.ca-central-1.amazonaws.com
docker build -t %REPO%:bootstrap backend/engine/python/
docker push %REPO%:bootstrap

cd cdk
npx cdk deploy wren-dev-Config wren-dev-Vpc wren-dev-Storage wren-dev-Cognito wren-dev-Database
npx cdk deploy wren-dev-Compute wren-dev-Api wren-dev-Observability wren-dev-CloudFrontWaf
```

</details>

&nbsp;

<<<<<<< HEAD
Then create GitHub secrets, deploy `wren-dev-Amplify`, and follow the secure default-off exact-subject bootstrap procedure in [Step 7](#step-7-configure-the-first-administrator).
=======
Then create GitHub secrets, deploy `wren-dev-Amplify`, sign up, and add the user to Cognito group `SystemAdmin` before first login.
>>>>>>> 18bc76be7d2e76c951a43fd8db9bb1ee9461b9f4
