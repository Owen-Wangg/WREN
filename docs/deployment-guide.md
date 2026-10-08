# WREN — AWS Deployment Guide

This guide deploys the WREN writing coach into an AWS account.

## Table of Contents

- [WREN — AWS Deployment Guide](#wren--aws-deployment-guide)
  - [Table of Contents](#table-of-contents)
  - [What You'll Have When You're Done](#what-youll-have-when-youre-done)
  - [Architecture at a Glance](#architecture-at-a-glance)
  - [Requirements](#requirements)
    - [Access Tokens](#access-tokens)
    - [Enable and Verify Bedrock Model Access](#enable-and-verify-bedrock-model-access)
  - [AWS credentials](#aws-credentials)
  - [First Deployment — Step by Step](#first-deployment--step-by-step)
    - [Step 1 — Prerequisites (one-time setup)](#step-1--prerequisites-one-time-setup)
    - [Step 2 — Start the deploy (run #1)](#step-2--start-the-deploy-run-1)
    - [Step 3 — Create the admin account, then rerun (run #2)](#step-3--create-the-admin-account-then-rerun-run-2)
    - [Step 4 — Sign in to become Technical Admin](#step-4--sign-in-to-become-technical-admin)
    - [Step 5 — Disarm the bootstrap](#step-5--disarm-the-bootstrap)
    - [Deployment workflow implementation](#deployment-workflow-implementation)
    - [Variables for the standard deployment](#variables-for-the-standard-deployment)
    - [Advanced deployment configuration](#advanced-deployment-configuration)
      - [AWS target and application identity](#aws-target-and-application-identity)
      - [Hosting, CI/CD, images, and ECR ownership](#hosting-cicd-images-and-ecr-ownership)
        - [External ECR safety requirement](#external-ecr-safety-requirement)
      - [Serving the frontend on a custom domain](#serving-the-frontend-on-a-custom-domain)
      - [Restricting signup to email domains](#restricting-signup-to-email-domains)
      - [Recovery and automation controls](#recovery-and-automation-controls)
      - [Preview and protected teardown](#preview-and-protected-teardown)
  - [Monitoring and Operational Ownership](#monitoring-and-operational-ownership)
  - [Troubleshooting](#troubleshooting)
    - [Common Issues](#common-issues)
  - [Custom Domain Support](#custom-domain-support)
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

Default naming uses project `wren` and environment `dev`, so stacks are named `wren-dev-<Concern>` (e.g. `wren-dev-Vpc`). The **data-plane Region** is CDK context `region` (examples in this guide use `ca-central-1`; override with `-c region=...`).

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

---

## Requirements

Before you deploy, you must have the following installed on your device:

- [git](https://git-scm.com/downloads)
- An [AWS Account](https://aws.amazon.com/account/) with permission to create IAM, VPC, RDS, Lambda, API Gateway, Cognito, CloudFront, WAF, Amplify, Bedrock, KMS, ECR, and CodeBuild resources (ECR + CodeBuild back the Feedback Engine image build)
- A [GitHub Account](https://github.com/) — required for the default hosted frontend and CI/CD; set its details in the [standard deployment variables](#variables-for-the-standard-deployment)
- [AWS CLI](https://aws.amazon.com/cli/) _(v2.0.0+ required)_
- [Node.js](https://nodejs.org/en/learn/getting-started/how-to-install-nodejs) _(v22.x+ required)_
- [npm](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) _(comes with Node)_

### Access Tokens

You also need a GitHub repository this account can read (a fork of WREN), a one-time authorization of the **AWS Amplify GitHub App** on that repo, and a GitHub personal access token (PAT). The GitHub App authorization, exact PAT scopes, and where to create them are covered in [First Deployment → Step 1](#step-1--prerequisites-one-time-setup).

### Enable and Verify Bedrock Model Access

Enable the target Bedrock model in your Region **before** deploying.

---

## AWS credentials

For the workflow, prefer AWS IAM Identity Center/SSO or another standard AWS credential-chain method; the workflow uses those credentials.

Configure and sign in with SSO, then point the deploy at that profile:

```bash
aws configure sso
aws sso login --profile <your-profile>
export AWS_PROFILE=<your-profile>          # PowerShell: $env:AWS_PROFILE = "<your-profile>"
```

Confirm the account before any deployment:

```bash
aws sts get-caller-identity                # honors AWS_PROFILE
```

---

## First Deployment — Step by Step

This is the recommended path for a first-time deployment. Follow the steps in order. Each step says what to do and what you should see before moving on. The [Deployment](#deployment) and [Advanced deployment configuration](#advanced-deployment-configuration) sections below are reference material for the same workflow.

### Step 1 — Prerequisites (one-time setup)

1. Install the tools in [Requirements](#requirements) (git, AWS CLI v2, Node.js 22+).
2. Sign in to AWS and select your profile: `aws sso login --profile <your-profile>`, then `export AWS_PROFILE=<your-profile>` (PowerShell: `$env:AWS_PROFILE = "<your-profile>"`). 
3. **Enable the Bedrock model.** In the AWS Console, open **Amazon Bedrock → Model access** in your target Region and enable the default model (`us.anthropic.claude-sonnet-4-6`) or the one you set in `WREN_BEDROCK_MODEL_ID`. Without this, the app deploys but feedback generation fails.
4. **Authorize the AWS Amplify GitHub App on your repository (required).** Amplify connects to GitHub through its GitHub App, so the app must be installed and authorized on the GitHub account/org that owns your repo **before** you deploy. If you skip this, the Amplify build fails at provisioning with the misleading error `!!! Unable to assume specified IAM Role` — Amplify can't reach the repo, so the build never even clones it.
   - In a browser, open the Region-specific installation URL, replacing `<region>` with your deploy Region (for example `ca-central-1`):

     `https://github.com/apps/aws-amplify-<region>/installations/new`
   - Choose the GitHub account or organization that owns your WREN repo.
   - Select **Only select repositories** and pick your WREN repo (or **All repositories**), then choose **Install & Authorize**.
   - Confirm it worked under **GitHub → Settings → Applications → Installed GitHub Apps** (for an organization: **Organization → Settings → GitHub Apps**) — you should see **AWS Amplify (`<region>`)** listed with access to the repo.

5. **Create a GitHub personal access token (PAT).** Amplify uses it to authorize the connection **through the GitHub App you installed above**. Create the token at **GitHub → Settings → Developer settings → Personal access tokens**:
   - Fine-grained token: grant the target repository **Metadata: read-only** (mandatory) and **Webhooks: read and write**.

6. Ensure a **clean git working tree** at the commit you want to deploy (`git status` shows nothing to commit). The image is built from a snapshot of the committed revision, so uncommitted changes are not included.

### Step 2 — Start the deploy (run #1)

Set the variables and run the command from the repository root. Replace the placeholder values. Pick the block for your shell:

<details open>
<summary>macOS/Linux (bash)</summary>

```bash
export AWS_PROFILE=your-profile                  # selects the account (like `--profile`); no account ID needed
export WREN_GITHUB_OWNER=YourOrgOrUser
export WREN_GITHUB_REPO=WREN
export WREN_GITHUB_BRANCH=main
export WREN_GITHUB_TOKEN='YOUR_GITHUB_PAT'       # the PAT from Step 1
export WREN_ALLOWED_EMAIL_DOMAINS=example.com    # Required: exact email domains allowed for signup; separate multiple domains with commas (,)
export WREN_ADMIN_EMAIL=admin@example.com        # who will be the first admin (must use a listed domain)
export WREN_REQUIRE_APPROVAL=never               # skips the interactive IAM prompt
npm run deploy
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$env:AWS_PROFILE = "your-profile"        # selects the account (like --profile); no account ID needed
$env:WREN_GITHUB_OWNER = "YourOrgOrUser"
$env:WREN_GITHUB_REPO = "WREN"
$env:WREN_GITHUB_BRANCH = "main"
$env:WREN_GITHUB_TOKEN = "YOUR_GITHUB_PAT"
$env:WREN_ALLOWED_EMAIL_DOMAINS = "example.com"   # required: exact domains allowed to sign up
$env:WREN_ADMIN_EMAIL = "admin@example.com"
$env:WREN_REQUIRE_APPROVAL = "never"     # skips the interactive IAM prompt
npm run deploy
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
set AWS_PROFILE=your-profile
set WREN_GITHUB_OWNER=YourOrgOrUser
set WREN_GITHUB_REPO=WREN
set WREN_GITHUB_BRANCH=main
set WREN_GITHUB_TOKEN=YOUR_GITHUB_PAT
set WREN_ALLOWED_EMAIL_DOMAINS=example.com
set WREN_ADMIN_EMAIL=admin@example.com
set WREN_REQUIRE_APPROVAL=never
npm run deploy
```

</details>

> 

**What you should see:** the workflow verifies AWS/Bedrock, bootstraps, builds the image in CodeBuild, deploys the stacks, and then **pauses with exit code 3**, printing an Amplify sign-up URL and asking you to create the first-admin account. Do not close the terminal Keep the same terminal open.

### Step 3 — Create the admin account, then rerun (run #2)

1. Open the **Amplify sign-up URL** the deploy printed.
2. Sign up using the exact address in `WREN_ADMIN_EMAIL`, and confirm the email.
3. You can stop after confirming the email. Signing in before this rerun is fine, but promotion happens only **after** run #2 has armed the bootstrap.
4. Run `npm run deploy` again. This is your first rerun, so you can skip the dependency reinstall to save time — Step 2 already ran `npm ci` for the root and `cdk/` directories:

   ```bash
   export WREN_SKIP_INSTALL=true   # PowerShell: $env:WREN_SKIP_INSTALL = "true"
   npm run deploy
   ```


No further `npm run deploy` is required. The account is not `TechnicalAdmin` yet — go to Step 4 and sign in.

### Step 4 — Sign in to become Technical Admin

1. Open the hosted application URL the deploy printed (Amplify default, or your custom domain if it is already live).
2. Sign in as `WREN_ADMIN_EMAIL` with the password you set at sign-up.
3. That authenticated request grants `TechnicalAdmin`. You can then assign roles to other users from within the app.

The grant happens **once per armed subject**: the authorizer records it in the `technical_admin_bootstrap` marker table and writes a `role.assigned` entry to the append-only `activity_event` audit log, in the same transaction as the role insert. Because the marker is independent of the role itself, a later `DELETE /v1/roles` on this account sticks — the bootstrap does not re-grant on the next request.

### Step 5 — Disarm the bootstrap

Once the admin account holds `TechnicalAdmin`, remove the arming so the one-time setup input does not remain standing privilege:

```bash
npm run disarm
```

This deletes the armed-subject SSM parameter (`/${stackPrefix}/auth/technical-admin-bootstrap-subject`) and redeploys the Compute stack without it, so the authorizer environment no longer carries `TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT` and the CI/CD pipeline cannot re-arm the gate on a later synth. The command is idempotent and keeps the Feedback Engine pinned to its current image. After disarm, further `TechnicalAdmin` grants go through the normal in-app role assignment (`POST /v1/roles`).

If a deploy run stops with exit code 3 or an error, read the printed instruction, complete that one action, and rerun `npm run deploy`. See [Troubleshooting](#troubleshooting) for specific messages.

---

First-admin setup takes two runs — create/confirm the account, then claim the `SystemAdmin` role

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

### Variables for the standard deployment

For the default hosted deployment, set only the following variables before the first `npm run deploy`.

| Variable | Default | Standard deployment use |
| --- | --- | --- |
| `AWS_PROFILE` | AWS CLI default credential chain | The named AWS CLI/SSO profile that selects the target account — the environment-variable equivalent of `--profile <name>`. This is how you choose which account WREN deploys into; set it and you do not need to supply the account ID. |
| `WREN_EXPECTED_ACCOUNT_ID` | unset | Optional safety guard: your expected 12-digit AWS account ID. When set, the deploy aborts if the active profile resolves to a different account. Optional for interactive deploys (the profile already selects the account); **required** for production or non-interactive deployments. |
| `WREN_GITHUB_OWNER` / `WREN_GITHUB_REPO` | unset | GitHub owner and repository for the default Amplify-hosted frontend. |
| `WREN_GITHUB_BRANCH` | `main` | GitHub branch deployed by Amplify. |
| `WREN_GITHUB_TOKEN` | unset | GitHub personal access token used to create the Amplify and CI/CD secrets. **Required on first setup** because CI/CD is built by default; it can be omitted on later runs once both secrets already exist. |
| `WREN_ENABLE_CICD` | `true` | Builds the CodePipeline CI/CD pipeline by default. Leave it at `true` for the standard path; set `false` only to skip the pipeline. |
| `WREN_REQUIRE_APPROVAL` | `broadening` interactively; otherwise `never` | Set to `never` for the standard `npm run deploy`. The deploy runs CDK without an attached terminal, so the default `broadening` prompt for IAM changes cannot be answered and aborts with `terminal (TTY) is not attached`. `never` applies those changes without prompting; for production, review the change first with `WREN_DRY_RUN=true`. |
| `WREN_ADMIN_EMAIL` | unset | Email address for the intended first administrator. The guided first-admin flow uses this value to pick who becomes admin. After run #2 completes, that user signs in to the application to receive `TechnicalAdmin`. |

All target customization, API-only hosting, CI/CD, ECR ownership, image, recovery, automation, preview, and teardown variables are in [Advanced deployment configuration](#advanced-deployment-configuration). Leave them unset for the standard path.

Secrets are redacted from command errors/output. GitHub secret values are passed to AWS through temporary mode-`0600` files that are removed immediately after use.

### Advanced deployment configuration

This section documents environment variables for non-default deployment, recovery, automation, and teardown scenarios. For the normal hosted deployment, use only the short list in [Variables for the standard deployment](#variables-for-the-standard-deployment) and leave the variables below unset unless a scenario explicitly requires them.

Do not commit GitHub personal access tokens to source control. The deployment workflow redacts secrets from its output and removes its temporary secret files after use.

#### AWS target and application identity

| Variable | Default | Use only when |
| --- | --- | --- |
| `AWS_PROFILE` | AWS CLI default credential chain | Selecting a named AWS CLI profile or SSO session. This is the standard, recommended way to pick the target account (see [Variables for the standard deployment](#variables-for-the-standard-deployment)); it is listed here only for completeness. Standard AWS credential environment variables also work. |
| `WREN_REGION` | `ca-central-1` | Deploying the data plane outside the default Region. The CloudFront WAF stack and its second CDK bootstrap remain in `us-east-1`. |
| `WREN_APP_NAME` | `LEON` | Changing the user-facing display name in the UI and email. The default is `LEON` for backward compatibility with existing deployments; new deployments should set this to the intended display name (for example `WREN`). Should be done at the start of the deployment only |
| `WREN_BEDROCK_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` | You only need this if your account/Region cannot access the default or you want to start on another model. A Technical Admin can change the model in-app afterward, and that choice overrides this deploy-time value.
| `WREN_PROJECT_NAME` | `wren` | Changing the lowercase resource-name prefix component. |
| `WREN_ENVIRONMENT` | `dev` | Deploying a distinct environment, such as `staging` or `prod`. Production deployments require `WREN_EXPECTED_ACCOUNT_ID`. |
| `WREN_STACK_PREFIX` | `{project}-{environment}` | Supplying the derived stack prefix explicitly. Its value must exactly equal `WREN_PROJECT_NAME-WREN_ENVIRONMENT`. |

**Changing the stack prefix.** The stack prefix (default `wren-dev`, producing stacks like `wren-dev-Vpc`) is always derived as `{WREN_PROJECT_NAME}-{WREN_ENVIRONMENT}`. To change it, set those two variables — for example `WREN_PROJECT_NAME=myproject` and `WREN_ENVIRONMENT=staging` yields the prefix `myproject-staging`. Both must start with a lowercase letter and contain only lowercase letters, digits, or hyphens. `WREN_STACK_PREFIX` does **not** override the prefix freely; if set, it must exactly equal the derived value, so it only serves to assert the prefix you expect (the deploy fails otherwise).

#### Hosting, CI/CD, images, and ECR ownership

| Variable | Default | Use only when |
| --- | --- | --- |
| `WREN_ENABLE_AMPLIFY` | `true` | Running an API-only deployment with `false`. GitHub owner/repository variables become optional only when both Amplify and CI/CD are disabled. |
| `WREN_CUSTOM_DOMAIN` | unset | Serving the frontend on your own domain instead of only the Amplify default. Set a bare hostname such as `example.com`; the production branch is mapped to the root and `www`. When unset, the frontend is reachable only via the Amplify default `*.amplifyapp.com` domain. No domain is hard-coded. See [Serving the frontend on a custom domain](#serving-the-frontend-on-a-custom-domain). |
| `WREN_ALLOWED_EMAIL_DOMAINS` | **required** | Exact email hostnames allowed to create **new** accounts (for example `example.ca`). `npm run deploy` fails when this is unset or empty; an empty list denies every sign-up. Existing accounts can always sign in. See [Restricting signup to email domains](#restricting-signup-to-email-domains). |
| `WREN_ALARM_EMAIL` | unset | Delivering CloudWatch security and operational alarms. Set the email address subscribed to the `${stackPrefix}-alarms` SNS topics (metric-filter, CloudTrail, DLQ, error/throttle, latency). When unset, the topics have no subscriber and alarms reach nobody. This is an operations recipient (a shared mailbox or distribution list is fine) and is **not** restricted to `WREN_ALLOWED_EMAIL_DOMAINS`. Persist it so later deploys do not drop the subscription. See [Monitoring and Operational Ownership](#monitoring-and-operational-ownership). |
| `WREN_CORS_ALLOWED_ORIGINS` | unset | Pinning the browser origins allowed by API Gateway, Lambda responses, and the documents (PII) S3 bucket. Comma-separated exact origins (`scheme://host[:port]`, no wildcard or path). Setting at least one exact origin drops the broad `https://*.amplifyapp.com` S3 fallback. See [Pinning CORS origins](#pinning-cors-origins). |
| `WREN_ENABLE_CICD` | `true` | Skipping the CodePipeline CI/CD pipeline with `false`. Enabled by default, so the standard path builds it and needs `WREN_GITHUB_TOKEN` on first setup; the `Cicd` prerequisite stack is created regardless. |
| `WREN_ECR_OWNERSHIP` | `managed` | Reusing a verified pre-existing repository by setting `external`. New deployments should keep `managed`; ownership is never silently adopted. |
| `WREN_ENGINE_IMAGE_TAG` | commit-scoped `src-<shortsha>` | Forcing a specific ECR image tag instead of the commit-derived one. By default the workflow builds the image under `src-<first 12 of the commit sha>` and pins the deployed Lambda to the resulting immutable **digest**; leave this unset for that commit-safe behavior. Setting it bypasses commit-scoping, so safe reuse then relies on the checkpoint's recorded source commit matching the revision being deployed. See [How the Feedback Engine image is built](#how-the-feedback-engine-image-is-built). |

##### External ECR safety requirement

Use `WREN_ECR_OWNERSHIP=external` only when the expected `{prefix}-feedback-engine` repository already exists outside CloudFormation. Its repository policy must allow the `lambda.amazonaws.com` service principal to call `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, and `ecr:BatchCheckLayerAvailability`. The workflow stops before deployment if this policy is absent or incomplete.

#### Serving the frontend on a custom domain

By default the frontend is reachable only at the Amplify default domain (`https://<branch>.<app-id>.amplifyapp.com`). To serve it on your own domain instead, set `WREN_CUSTOM_DOMAIN` to a bare hostname before deploying:

```bash
export WREN_CUSTOM_DOMAIN=example.com
```

This is entirely optional and no domain is baked into the project — omit the variable and deployment behaves exactly as before. When set, WREN maps the Amplify production branch to both the domain root (`https://example.com`) and its `www` subdomain (`https://www.example.com`), and prints a `CustomDomainUrl` stack output. WREN does not create or modify any Route 53 or ACM resources itself, so the feature works regardless of where your DNS is hosted; Amplify manages the TLS certificate.

There are two DNS paths, and WREN supports both because it only creates the Amplify domain association:

- **Hosted zone in the same AWS account (automatic).** If the domain's Route 53 hosted zone lives in the account you deploy into, Amplify provisions the certificate and creates the required DNS records automatically. No manual steps.
- **DNS elsewhere (manual verification).** If the zone is in a different AWS account or with an external provider (Cloudflare, GoDaddy, etc.), Amplify surfaces certificate-validation and CNAME records that you add by hand in that provider. Open **AWS Console → Amplify → your app → Domain management** to copy the exact records.

In both cases the certificate and domain association can take several minutes (occasionally longer) to become live. Until then the Amplify default domain keeps working, and the deploy workflow automatically falls back to it if the custom domain is not yet reachable.

#### Pinning CORS origins

The documents (PII) S3 bucket, API Gateway, and Lambda responses share a frontend-origin allowlist. `localhost` and any `WREN_CUSTOM_DOMAIN` (plus `www`) are always included. S3 cannot evaluate the Amplify default-host pattern that API Gateway uses, so when no exact production origin is known at synth time the bucket falls back to the broad `https://*.amplifyapp.com` wildcard.

A deployment that relies on the Amplify default host (`https://<branch>.<app-id>.amplifyapp.com`) without a custom domain should pin that exact host so the bucket drops the wildcard:

```bash
export WREN_CORS_ALLOWED_ORIGINS=https://main.d123abc.amplifyapp.com   # PowerShell: $env:WREN_CORS_ALLOWED_ORIGINS = "https://main.d123abc.amplifyapp.com"
npm run deploy
```

The host is generated at deploy time, so run the first deploy, read the Amplify default domain from the stack output, then set `WREN_CORS_ALLOWED_ORIGINS` and redeploy to pin it. Provide comma-separated exact origins (`scheme://host[:port]`); wildcards and paths are rejected before any AWS call. Setting a `WREN_CUSTOM_DOMAIN` also drops the wildcard, so this knob is mainly for the Amplify-default-host case. A direct `cdk deploy` accepts the same value via `-c corsAllowedOrigins=…`.

#### Restricting signup to email domains

Signup is closed by default: only listed hostnames can create **new** accounts, and `npm run deploy` refuses to run until `WREN_ALLOWED_EMAIL_DOMAINS` is set:

```bash
export WREN_ALLOWED_EMAIL_DOMAINS=ubc.ca
```

Matching is exact and case-insensitive. `example.ca` allows `user@example.ca` and `user@EXAMPLE.CA`. It does **not** allow `user@department.example.ca` — list every hostname you need, comma-separated (`example.ca,department.example.ca`).

Wildcards such as `*.example.ca` are rejected. This applies only to new Cognito self-signups. Sign-in, password reset, and accounts that already exist are unchanged.

An empty list denies every sign-up. How each command affects the **deployed** list:

| Command | List set? | Effect on the deployed list |
| --- | --- | --- |
| `npm run deploy` | `WREN_ALLOWED_EMAIL_DOMAINS` set | Replaced with exactly that value (not merged). To add a domain, pass the full list. |
| `npm run deploy` | unset or empty | Refuses to run before touching AWS. The deployed list is unchanged. |
| `cdk deploy` including the Cognito stack (or `--all`) | `-c allowedEmailDomains=…` | Replaced with exactly that value. |
| `cdk deploy` including the Cognito stack (or `--all`) | no `-c` value | **Cleared**: the PreSignUp Lambda gets an empty list and blocks all new sign-ups until you redeploy with the list. |
| `cdk synth` / `cdk diff` | either | No change; these never modify deployed resources. |

Plain `cdk` commands do not read `WREN_ALLOWED_EMAIL_DOMAINS`; they only see CDK context. To avoid retyping the list:

- **For `npm run deploy`:** save it as a user environment variable so every new terminal has it.

  ```powershell
  [Environment]::SetEnvironmentVariable("WREN_ALLOWED_EMAIL_DOMAINS", "ubc.ca,student.ubc.ca", "User")   # open a new terminal afterwards
  ```

  On macOS/Linux, add `export WREN_ALLOWED_EMAIL_DOMAINS=ubc.ca,student.ubc.ca` to your shell profile.

- **For direct `cdk deploy`:** put it in your user-level CDK config, `~/.cdk.json` (Windows: `%USERPROFILE%\.cdk.json`). CDK reads it on every command, it stays out of the repository, and a `-c` value on the command line still overrides it.

  ```json
  {
    "context": {
      "allowedEmailDomains": "ubc.ca,student.ubc.ca"
    }
  }
  ```

In PowerShell, `-c allowedEmailDomains=ubc.ca,student.ubc.ca` is passed as a single argument; quoting the value (`allowedEmailDomains="ubc.ca,student.ubc.ca"`) also works.

`npm run redrive:dlq` shares the deploy configuration parser, so it also requires `WREN_ALLOWED_EMAIL_DOMAINS` to be set, even though it never touches Cognito.

If you also set `WREN_ADMIN_EMAIL`, that address must use one of the listed domains; otherwise the first-admin signup cannot complete.

The Cognito PreSignUp trigger is the authoritative gate. The Amplify frontend receives the same list so the sign-up form can show a clear error before Cognito.

#### Recovery and automation controls

| Variable | Default | Use only when |
| --- | --- | --- |
| `WREN_ADMIN_ALREADY_CONFIGURED` | `false` | Recovering a legacy environment that already has an administrator but cannot complete the guided first-admin sign-in flow. |
| `WREN_BOOTSTRAP_MISSING` | `true` interactively; otherwise `false` | Allowing the workflow to create missing CDK bootstrap stacks. Existing bootstraps are always discovered and reused. |
| `WREN_REQUIRE_APPROVAL` | `broadening` interactively; otherwise `never` | Choosing the CDK approval mode: `broadening` or `never`. |
| `WREN_NON_INTERACTIVE` | `CI=true` | Enforcing non-interactive safety behavior. It requires `WREN_EXPECTED_ACCOUNT_ID` and defaults CDK approval to `never`. |
| `WREN_SKIP_INSTALL` | `false` | Skipping both `npm ci` operations only when the root and `cdk/` `node_modules` directories already exist and are known-good. |

#### Preview and protected teardown

| Variable | Default | Use only when |
| --- | --- | --- |
| `WREN_DRY_RUN` | `false` | Discovering and synthesizing deployment or teardown state without mutating AWS resources. |
| `WREN_UNDEPLOY_CONFIRM` | unset | Authorizing `npm run undeploy`. It is ignored by `npm run deploy`. |

`npm run undeploy` is deliberately protected and retains application data and foundational resources. Before it makes changes, the command prints the exact confirmation value required for `WREN_UNDEPLOY_CONFIRM`; it has the form `<account-id>/<region>/<stack-prefix>`. Set that complete value exactly, then rerun the command. See [Cleanup](#cleanup) for retained-resource behavior. Implementation details are in the [deployment workflow modules](#deployment-workflow-implementation).

## Monitoring and Operational Ownership

The `Observability` stack creates CloudWatch alarms and publishes every alarm to the SNS topic `${stackPrefix}-alarms`. By default, that topic has no recipient. AWS sends a confirmation link to the subscribed address; alarms are not delivered until the recipient accepts it.

For the guided workflow (`npm run deploy`), set `WREN_ALARM_EMAIL` so the orchestrator passes the subscriber on every deploy:

```bash
export WREN_ALARM_EMAIL=oncall@example.com    # PowerShell: $env:WREN_ALARM_EMAIL = "oncall@example.com"
npm run deploy
```

Persist it as a user environment variable so every orchestrated deploy keeps the subscription. If a later deploy omits the value, CloudFormation removes the managed email subscription and alarms silently stop reaching anyone. Because it is an alerting recipient rather than a signup identity, `WREN_ALARM_EMAIL` is not constrained to `WREN_ALLOWED_EMAIL_DOMAINS` — a shared ops mailbox or distribution list on any domain is valid.

A direct `cdk deploy` of just the `Observability` stack is also supported via the `alarmEmail` context. This setup is portable to another AWS account. Replace the profile, stack prefix, Region, and email below with values for that deployment. Do not copy the `wren-dev` identifiers unless that is actually the new environment.

```powershell
$Profile = "my-aws-profile"
$StackPrefix = "myproject-dev"
$Region = "ca-central-1"
$AlarmEmail = "oncall@example.com"

cd cdk
npx cdk deploy "$StackPrefix-Observability" `
  --profile $Profile `
  -c stackPrefix=$StackPrefix `
  -c region=$Region `
  -c alarmEmail=$AlarmEmail
```

Keep `alarmEmail` in the deployment pipeline or pass it on every future `Observability` deployment (via `WREN_ALARM_EMAIL` for `npm run deploy`, or `-c alarmEmail=…` for a direct `cdk deploy`). If a later synth omits the value, CloudFormation will remove the managed email subscription.

The configured alarms are:

| Signal | Alarm condition | What it can indicate |
| --- | --- | --- |
| Lambda errors | More than 5 errors in one 5-minute period, per monitored function | Broken dependencies, permissions, networking, or application failures |
| Lambda throttles | More than 1 throttle in each of two 5-minute periods | Insufficient concurrency or a traffic spike |
| Feedback queue depth | More than 50 visible messages for two 5-minute periods | Feedback processing is falling behind |
| Feedback dead-letter queue | At least 1 visible message | A feedback job exhausted its retries and needs investigation |
| API Gateway latency | p99 latency above 10 seconds for three 5-minute periods | Slow API integrations or downstream services |

The stack sets Lambda log retention to 30 days for non-production environments and 90 days when `environmentName=prod`. Separately, the VPC stack records accepted and rejected traffic in VPC Flow Logs for 30 days. Flow Logs support investigation but do not currently send an alarm by themselves.

After deploying, open the SNS confirmation email and accept it. Then verify that AWS no longer reports the subscription as `PendingConfirmation`:

```powershell
$Account = aws sts get-caller-identity --profile $Profile --query Account --output text
$TopicArn = "arn:aws:sns:$Region:$Account:$StackPrefix-alarms"
aws sns list-subscriptions-by-topic `
  --profile $Profile `
  --region $Region `
  --topic-arn $TopicArn `
  --query "Subscriptions[].{Protocol:Protocol,Endpoint:Endpoint,Status:SubscriptionArn}" `
  --output table
```

After confirmation, send a harmless delivery test and verify that the recipient receives it:

```powershell
aws sns publish `
  --profile $Profile `
  --region $Region `
  --topic-arn $TopicArn `
  --subject "Monitoring delivery test" `
  --message "SNS alarm delivery is configured for $StackPrefix."
```

Monitoring is a detection and notification control, not an automatic rollback system. During an infrastructure change, an operator must still review API Gateway 4XX/5XX metrics, RDS Proxy connection errors in application logs, VPC Flow Log rejects, and NAT gateway bytes/errors. If health regresses, follow the affected feature's rollback procedure. The repository does not configure endpoint-specific alarms or Route 53 Resolver query logging. CloudTrail may be provided centrally by AWS Organizations or Control Tower, so each new account owner must verify its event selectors, retention, and access with their platform team.

## Troubleshooting

### Common Issues

For a failed standard deployment, first complete the action printed by `npm run deploy` and rerun that same command. The direct CDK, bootstrap, ECR, and individual-stack commands in the entries below apply only when you deliberately drive CDK by hand (advanced recovery) instead of `npm run deploy`.

**Issue: `Your session has expired. Please reauthenticate` (AWS CLI exits 255)**

- Solution: your SSO session lapsed. Refresh it for your profile and rerun: `aws sso login --profile <your-profile>`, then `npm run deploy`. The deploy calls the AWS CLI directly, so there is no `--profile` flag to pass to `npm run deploy`; set `AWS_PROFILE` in the same terminal instead (see below).

**Issue: the deploy uses the wrong account, or ignores the profile you expected**

- Solution: the workflow selects the account from `AWS_PROFILE`, not from a `--profile` argument. Set it in the same shell before deploying — `export AWS_PROFILE=<your-profile>` (PowerShell: `$env:AWS_PROFILE = "<your-profile>"`) — and confirm with `aws sts get-caller-identity`. If you set `WREN_EXPECTED_ACCOUNT_ID` and see `AWS identity account ... does not match`, the profile resolves to a different account than the guard expects; point `AWS_PROFILE` at the intended account or clear `WREN_EXPECTED_ACCOUNT_ID` for an interactive deploy.

**Issue: `Stack includes security-sensitive updates, but terminal (TTY) is not attached` (CDK exits 1)**

- Solution: `npm run deploy` runs the CDK CLI as a piped subprocess, so CDK's default `broadening` approval mode has no terminal to prompt on and aborts. Set `WREN_REQUIRE_APPROVAL=never` in the same shell and rerun — `export WREN_REQUIRE_APPROVAL=never` (PowerShell: `$env:WREN_REQUIRE_APPROVAL = "never"`). This auto-approves the IAM-broadening changes; on production, first review them with `WREN_DRY_RUN=true`.

**Issue: `npm run deploy` exits with code 3**

- Solution: this is an intentional action-required pause, not a rollback. Complete the exact printed Bedrock, Cognito sign-up/confirmation, ownership, or CloudFormation recovery action and rerun the same command. Live AWS state is rediscovered.

**Issue: checkpoint configuration does not match**

- Solution: use the same account, Region, project/environment prefix, branch, and ownership mode as the original operation. If you intentionally changed the target configuration, archive the matching non-secret file under `.wren-deploy/` and start a new operation only after confirming no deploy/undeploy is active. Never copy checkpoints between accounts.

**Issue: ECR exists outside the Cicd stack**

- Solution: verify that `{prefix}-feedback-engine` is the intended repository, then set `WREN_ECR_OWNERSHIP=external`. Do not delete or import it merely to bypass the ownership gate.

**Issue: an existing pipeline is detected while CI/CD is disabled**

- Solution: this happens only when you explicitly set `WREN_ENABLE_CICD=false` against an environment that already has a pipeline. Normal deployment will not implicitly remove it. Unset the flag (or set `WREN_ENABLE_CICD=true`) and rerun to keep it. Protected undeploy explicitly disables it before destroying Compute.

**Issue: `Source image …:bootstrap does not exist`**

- Solution: for the standard workflow, do not create or push the image manually—rerun `npm run deploy` after correcting its reported ECR/ownership or CodeBuild failure. The `feedback-image` stage builds and pushes the image in CodeBuild (see [How the Feedback Engine image is built](#how-the-feedback-engine-image-is-built)); if the build itself failed, open the reported `${prefix}-bootstrap-image` build in CloudWatch Logs. A hand-run `docker build` + ECR push is an emergency escape hatch only (see [docs/dependency-management.md](./dependency-management.md#feedback-engine-the-heavy-python-runtime)).

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

**Issue: Amplify build fails immediately with `!!! Unable to assume specified IAM Role`**

- Cause: the AWS Amplify GitHub App is not authorized on the repository, so Amplify cannot access the code and the build dies at provisioning before cloning. This is not actually an IAM role problem.
- Solution: install and authorize the Amplify GitHub App on the repo's GitHub account/org (see [Step 1](#step-1--prerequisites-one-time-setup), "Authorize the AWS Amplify GitHub App"), at `https://github.com/apps/aws-amplify-<region>/installations/new`. Then rerun `npm run deploy` (or trigger a new Amplify build). Note the PAT does **not** need the `Administration`/deploy-key permission — the GitHub App provides repository access.

**Issue: Pipeline error `[GitHub] No Branch [main]`**

- Solution: Confirm the branch name, PAT scopes, and org SSO authorization.

**Issue: Amplify build fails on `npm ci`**

- Solution: Check the lockfile and Node version — Amplify sets `NODE_VERSION=22`; keep lockfiles committed.

**Issue: Feedback jobs stay in the queue**

- Solution: The engine image may be a stub, Bedrock access may be denied, or there's a VPC/DNS issue. Check `wren-dev-feedback-engine` logs, confirm Bedrock access, and confirm the image contains `handler.handler`.

**Issue: Sign-up email never arrives**

- Solution: Check junk/spam — Cognito's default email has limited volume. For higher volume, attach an SES identity.

**Issue: User is not Technical Admin**

- Solution: Deploy completing is expected — `TechnicalAdmin` is granted on the first application sign-in **after** run #2, not by `npm run deploy` itself. Sign in as `WREN_ADMIN_EMAIL`. Two operator-controlled gates must both hold on that login: the exact armed `technicalAdminBootstrapSubject` and (for a brand-new `app_user` row) `SystemAdmin` group membership. The candidate does **not** need to be a brand-new account — if they signed in once before the gate was armed (and so already have a `Student` row), signing in after deploy completes elevates them in place, and they keep `Student` while also gaining `TechnicalAdmin`. If setup still fails, confirm the signed-in user's Cognito `sub` matches the armed subject and that they are in the `SystemAdmin` group, then sign in again. Assign the role through the application once a Technical Admin exists, or follow your controlled database recovery procedure.

**Issue: `cdk deploy` puts resources in the wrong region**

- Solution: Region is **CDK context**, defaulting to `ca-central-1` — it doesn't follow `CDK_DEFAULT_REGION`. Override with `-c region=...` only if you intend to leave the residency default.

**Issue: CloudFront stack fails in `us-east-1`**

- Solution: for a standard deployment, rerun `npm run deploy` after resolving the reported bootstrap permission/account issue; it bootstraps both Regions. Run `npx cdk bootstrap aws://ACCOUNT/us-east-1` only for direct-CDK recovery.

**Issue: `Fn::Sub` / OpenAPI errors on the `Api` stack**

- Solution: Stale local change to spec injection — deploy the current `ApiStack` `resolveSpec()` code and don't reintroduce string-injection of `Fn::Sub`.

_The issues listed above represent the most common historical deploy bugs encountered in this repo, all of which have been resolved._

---

## Custom Domain Support

WREN can serve the frontend on your own domain instead of only the default Amplify URL (`https://<branch>.<app-id>.amplifyapp.com`). The feature is entirely optional.

To enable it, set a bare hostname before deploying:

```bash
export WREN_CUSTOM_DOMAIN=example.com     # PowerShell: $env:WREN_CUSTOM_DOMAIN = "example.com"
npm run deploy
```

When set, WREN maps the Amplify production branch to both the domain root (`https://example.com`) and its `www` subdomain (`https://www.example.com`), and prints a `CustomDomainUrl` stack output. WREN only creates the Amplify domain association — Amplify manages the TLS certificate.

There are two DNS paths:

- **Hosted zone in the same AWS account (automatic).** If the domain's Route 53 hosted zone is in the account you deploy into, Amplify provisions the certificate and creates the DNS records automatically. No manual steps.
- **DNS elsewhere (manual verification).** If the zone is in a different AWS account or with an external provider (Cloudflare, GoDaddy, etc.), open **AWS Console → Amplify → your app → Domain management** and add the certificate-validation and CNAME records it surfaces to your provider by hand.

In both cases the certificate and domain association can take several minutes to become live. Until then the Amplify default domain keeps working, and the deploy workflow falls back to it for the post-deploy if the custom domain is not yet reachable.

For the full reference, see [Serving the frontend on a custom domain](#serving-the-frontend-on-a-custom-domain) and the `WREN_CUSTOM_DOMAIN` row in [Hosting, CI/CD, images, and ECR ownership](#hosting-cicd-images-and-ecr-ownership).

---

## Cleanup

### Protected application teardown (recommended)

`npm run undeploy` validates the current AWS account, inventories both Regions, and pauses an existing WREN CodePipeline before removing it.

```text
Amplify → CloudFrontWaf → Observability → Api → Compute
```

It does **not** destroy `Cicd` prerequisites, `Database`, `Cognito`, `Storage`, `Vpc`, `Config`, or either `CDKToolkit` stack. It never disables RDS deletion protection and never explicitly deletes retained RDS, S3, DynamoDB, KMS, ECR, Secrets Manager, CloudWatch Logs, or bootstrap resources.
<details>
<summary>macOS/Linux</summary>

```bash
export AWS_PROFILE=your-profile                  # selects the account (like `--profile`)
export WREN_GITHUB_OWNER=YourOrgOrUser
export WREN_GITHUB_REPO=WREN
export WREN_UNDEPLOY_CONFIRM=YourAccountId/DeploymentRegion/StackPrefix
npm run undeploy
```

</details>

<details>
<summary>PowerShell</summary>

```powershell
$env:AWS_PROFILE = "your-profile"        # selects the account (like --profile)
$env:WREN_GITHUB_OWNER = "YourOrgOrUser"
$env:WREN_GITHUB_REPO = "WREN"
$env:WREN_UNDEPLOY_CONFIRM = "YourAccountId/DeploymentRegion/StackPrefix"
npm run undeploy
```

</details>

<details>
<summary>Windows CMD</summary>

```cmd
set AWS_PROFILE=your-profile
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



