# WREN / LEON — Infrastructure (`cdk/`)

AWS CDK v2 (TypeScript) for the LEON writing coach platform (internal project name **WREN**).

Stacks are named `${stackPrefix}-<Concern>` (default `wren-dev-Vpc`, `wren-dev-Compute`, …). Persistent resources stay in the **CDK `region`** (default `ca-central-1` in examples; override with `-c region=...`). CloudFront is a global CDN. The `CloudFrontWaf` stack is created in **`us-east-1`** because AWS manages CloudFront-scoped WAF there — not because student data is stored in that Region.

**Full first-time AWS rollout:** use `npm run deploy` from the repository root. It installs locked dependencies, verifies AWS/Bedrock, bootstraps both Regions, builds and publishes the Feedback Engine image in AWS CodeBuild (from a snapshot of the committed revision — no local Docker), deploys stacks in order, guides first-admin setup, and runs smoke checks. Configuration and recovery details are in **[docs/deployment-guide.md](../docs/deployment-guide.md)**. Direct `npx cdk` commands in this README are advanced development/recovery operations.

This package is meant to be deployable with **configuration only** — no source edits for display name, environment, or GitHub repo (REQ-NFR-OSS-01).

## Prerequisites

- Node.js **22.x** or newer
- AWS credentials for the target account (`aws sts get-caller-identity`)
- A clean Git working tree at the revision you deploy (the Feedback Engine image is built in AWS CodeBuild from a snapshot of that commit — no local Docker daemon required)
- CDK CLI via this package (`npx cdk` / `npm run cdk`) — no global install required

Also install **workspace packages at the repo root** (`npm ci` in `/`), not only here. Compute bundling resolves `@wren/*` from the monorepo `node_modules`.

```bash
# from repository root
npm ci
cd cdk
npm ci
```

Bootstrap **after** `npm ci` in `cdk/`, in the **data-plane Region** and in **`us-east-1`** (CloudFront-scoped WAF control plane):

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap "aws://$ACCOUNT/ca-central-1"
npx cdk bootstrap "aws://$ACCOUNT/us-east-1"
```

## Configuration

All naming and display settings come from **CDK context** (or env vars for GitHub). Do not edit source to rebrand.

| Context key | Env var (GitHub only) | Default | Purpose |
| --- | --- | --- | --- |
| `appName` | — | `LEON` | UI / email display name (SSM only — not resource names) |
| `projectName` | — | `wren` | Resource naming |
| `environmentName` | — | `dev` (also in `cdk.json`) | `dev` / `staging` / `prod` |
| `stackPrefix` | — | `${projectName}-${environmentName}` | e.g. `wren-dev` |
| `bedrockModelId` | — | `us.anthropic.claude-sonnet-4-6` | Bedrock inference profile |
| `region` | — | `ca-central-1` | Data-plane region |
| `githubOwner` | `GITHUB_OWNER` | unset | Enables Amplify + CICD stacks |
| `githubRepo` | `GITHUB_REPO` | unset | GitHub repository name |
| `githubBranch` | `GITHUB_BRANCH` | `main` | Pipeline / Amplify source branch |

**Region is not taken from `CDK_DEFAULT_REGION`.** It is pinned to `ca-central-1` unless you pass `-c region=...`. Account still comes from `CDK_DEFAULT_ACCOUNT` (your AWS CLI identity).

```bash
npx cdk synth -c appName="My Coach" -c environmentName=prod
npx cdk synth -c bedrockModelId=anthropic.claude-3-5-haiku-20241022-v1:0
npx cdk deploy wren-dev-Amplify -c githubOwner=MyOrg -c githubRepo=WREN
```

Stacks are tagged: `Project` = stack prefix, `Application` = display name, `Environment`, `ManagedBy` = `cdk`.

## Stacks

| Stack id | Region | What it creates |
| --- | --- | --- |
| `{prefix}-Config` | Data-plane Region | SSM Parameter Store (app name, model id) + Bedrock Guardrail |
| `{prefix}-Vpc` | Data-plane Region | Three-tier VPC, NAT, VPC endpoints, flow logs |
| `{prefix}-Storage` | Data-plane Region | S3 + DynamoDB conversation table |
| `{prefix}-Cognito` | Data-plane Region | User pool, app client, `SystemAdmin` group |
| `{prefix}-Database` | Data-plane Region | RDS PostgreSQL 16.13, RDS Proxy, migrations |
| `{prefix}-Compute` | Data-plane Region | Document, Admin, Audit, Feedback Orchestrator, Feedback Engine, Notification, authorizers; SQS; AppSync |
| `{prefix}-Api` | Data-plane Region | REST API from `lib/openapi.yaml` |
| `{prefix}-Observability` | Data-plane Region | CloudWatch dashboards / alarms |
| `{prefix}-CloudFrontWaf` | `us-east-1` (WAF scope constraint) | CloudFront + CloudFront-scoped WAF |
| `{prefix}-Cicd` | Data-plane Region | ECR repo/import + Compute permissions boundary; CodePipeline built by default (opt out with `WREN_ENABLE_CICD=false`) |
| `{prefix}-Amplify` | Data-plane Region | Frontend hosting (**skipped** without GitHub owner/repo) |

**Orchestrated deploy order:** Cicd prerequisites → image publish → Config → Vpc → Storage → Cognito → Database → Compute → Api → Observability → CloudFrontWaf → Amplify → CodePipeline (default; skipped only with `WREN_ENABLE_CICD=false`).

The orchestrator uses an immutable Feedback Engine image tag and also refreshes the compatibility `bootstrap` tag. Managed ECR expires only untagged images older than 30 days, preserving every tagged release needed for deployment or rollback. An external repository must already grant `lambda.amazonaws.com` the `ecr:GetDownloadUrlForLayer`, `ecr:BatchGetImage`, and `ecr:BatchCheckLayerAvailability` actions; the orchestrator validates that repository policy before deploying. For direct CDK deployment, the ECR repository and referenced image tag must already exist.

The Compute audit pseudonym salt is retained. After a protected teardown, `npm run deploy` discovers the orphaned fixed-name secret and imports it instead of attempting to recreate it, preserving stable audit pseudonyms across redeployments. See the [deployment guide](../docs/deployment-guide.md).

## Commands

Use the repository-root orchestrators for complete environments:

```bash
npm run deploy
npm run undeploy  # protected teardown; requires exact confirmation for mutations
```

Run direct infrastructure-development commands from `cdk/`:

```bash
npm run build       # tsc compile
npm run typecheck   # tsc --noEmit
npm test            # Jest
npm run synth       # cdk synth (cdk.json context defaults)
npm run cdk -- ...  # CDK CLI

npx cdk deploy wren-dev-Config
npx cdk deploy --all -c allowedEmailDomains=ubc.ca   # includes Compute; ECR bootstrap image must exist
npx cdk destroy wren-dev-Amplify
```

**Signup allowlist:** any `cdk deploy` that includes `{prefix}-Cognito` deploys the `allowedEmailDomains` context value as the sign-up allowlist. Without it the list is empty, which blocks every new sign-up. Pass `-c allowedEmailDomains=…` or set it once in `~/.cdk.json`. `cdk synth` / `cdk diff` are unaffected. See [Restricting signup to email domains](../docs/deployment-guide.md#restricting-signup-to-email-domains).

RDS uses deletion protection and `RemovalPolicy.RETAIN`. `cdk destroy --all` will not fully stop spend — see Cleanup in the deployment guide.

## Layout

```
cdk/
├── bin/wren.ts              # App entry (stack wiring)
├── lib/
│   ├── config.ts            # Context defaults (app name, prefix, region, model)
│   ├── tags.ts              # Cost-allocation tags
│   ├── appDbRoles.ts        # Per-Lambda Postgres roles
│   ├── openapi.yaml         # API Gateway spec
│   ├── stacks/              # One stack per concern
│   └── constructs/          # VPC, RDS, storage, migrations, AppSync, …
├── lambda/                  # Handlers bundled or copied into Lambdas
├── lambda-handlers/         # Node entrypoints used by Compute bundling
├── layers/                  # Placeholder for shared layers
└── test/                    # Unit / residency tests
```

## Secrets (Amplify / pipeline)

Created **before** those stacks (names use `{stackPrefix}`):

| Secret | Used by |
| --- | --- |
| `{prefix}/github/token` | Amplify GitHub source |
| `{prefix}/cicd/github-pat` | CodePipeline GitHub source |

Classic GitHub PAT (`repo`, `admin:repo_hook`). Details in the deployment guide.
