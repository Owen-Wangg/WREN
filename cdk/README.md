# WREN / LEON — Infrastructure (`cdk/`)

AWS CDK v2 (TypeScript) for the LEON writing coach platform (internal project name **WREN**).

Stacks are named `${stackPrefix}-<Concern>` (default `wren-dev-Vpc`, `wren-dev-Compute`, …). Persistent resources stay in **`ca-central-1`**. CloudFront + WAF always deploy to **`us-east-1`**.

**Full first-time AWS rollout** (Bedrock access, ECR `bootstrap` image, stack order, Amplify, first admin): **[docs/deployment-guide.md](../docs/deployment-guide.md)**.

This package is meant to be deployable with **configuration only** — no source edits for display name, environment, or GitHub repo (REQ-NFR-OSS-01).

## Prerequisites

- Node.js **22.x** or newer
- AWS credentials for the target account (`aws sts get-caller-identity`)
- Docker (Feedback Engine image + some CDK bundling)
- CDK CLI via this package (`npx cdk` / `npm run cdk`) — no global install required

Also install **workspace packages at the repo root** (`npm ci` in `/`), not only here. Compute bundling resolves `@wren/*` from the monorepo `node_modules`.

```bash
# from repository root
npm ci
cd cdk
npm ci
```

Bootstrap **after** `npm ci` in `cdk/`, in **both** regions:

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
| `{prefix}-Config` | `ca-central-1` | SSM (app name, model id) + Bedrock Guardrail |
| `{prefix}-Vpc` | `ca-central-1` | Three-tier VPC, NAT, VPC endpoints, flow logs |
| `{prefix}-Storage` | `ca-central-1` | S3 + DynamoDB conversation table |
| `{prefix}-Cognito` | `ca-central-1` | User pool, SPA client, `SystemAdmin` group |
| `{prefix}-Database` | `ca-central-1` | RDS PostgreSQL 16.13, RDS Proxy, migrations |
| `{prefix}-Compute` | `ca-central-1` | Lambdas, SQS, AppSync |
| `{prefix}-Api` | `ca-central-1` | REST API from `lib/openapi.yaml` |
| `{prefix}-Observability` | `ca-central-1` | CloudWatch dashboards / alarms |
| `{prefix}-CloudFrontWaf` | **`us-east-1`** | CloudFront + CLOUDFRONT WAF |
| `{prefix}-Cicd` | `ca-central-1` | ECR + CodePipeline (**skipped** without GitHub owner/repo) |
| `{prefix}-Amplify` | `ca-central-1` | Frontend hosting (**skipped** without GitHub owner/repo) |

**Deploy order:** Config → Vpc → Storage → Cognito → Database → (ECR image) → Compute → Api → Observability → CloudFrontWaf → Amplify / Cicd.

`Compute` looks up ECR `{stackPrefix}-feedback-engine` tag **`bootstrap`**. That repo and tag must exist before Compute deploys. See the [deployment guide](../docs/deployment-guide.md).

## Commands

Run from `cdk/`:

```bash
npm run build       # tsc compile
npm run typecheck   # tsc --noEmit
npm test            # Jest
npm run synth       # cdk synth (cdk.json context defaults)
npm run cdk -- ...  # CDK CLI

npx cdk deploy wren-dev-Config
npx cdk deploy --all          # includes Compute; ECR bootstrap image must exist
npx cdk destroy wren-dev-Amplify
```

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
