---
inclusion: always
---

# Tech Stack & AWS Infrastructure Preferences

This file describes a default technology stack and set of AWS infrastructure
patterns to use as a baseline reference.

**These are defaults, not mandates.** Treat the choices below as the starting
point for new work. If you observe that something here does not fit the current
project — different requirements, existing conventions, better-suited tooling,
or technical constraints — use a different approach. Prefer the project's actual
needs over this baseline whenever a deviation is justified, and apply the
project's existing patterns when they differ from what's described here.

## 1. Languages & Runtimes

- Prefer **TypeScript over JavaScript** for new infrastructure and frontend code. Compile with `strict: true`, `noImplicitAny`, `strictNullChecks`.
- Use **Python 3.12** for Lambda/container services and data/AI workloads (`public.ecr.aws/lambda/python:3.12` base image).
- Use **Node.js 22.x** for JS/TS Lambda functions; pin the CDK Lambda runtime to `NODEJS_22_X`.
- CDK TypeScript: target `ES2022`, `module`/`moduleResolution` `NodeNext`. Pin TypeScript with `~` (patch-only) ranges.

## 2. Frameworks & Libraries

- **Frontend:** React 19 + Vite 7 + Tailwind CSS 4 + shadcn/ui (Radix UI primitives). React Router for routing, Recharts for charts, Socket.IO client for realtime.
  - Sanitize HTML with `dompurify`; client PDF export via `jspdf` + `html2canvas`; icons via `lucide-react`.
  - Use the `@` path alias mapped to `./src`.
- **AI orchestration:** LangChain (`langchain-aws`, `langchain-core`, `langchain-postgres`, plus `community`/`experimental` as needed). Prefer `langchain-aws` for Bedrock integration.
- **Data access:** PostgreSQL via `psycopg[binary,pool]` (Python) and the `postgres` Node.js client, with `pgvector` for embedding storage. SQLAlchemy is used only where an ORM layer is warranted. `.docx` files are extracted using `mammoth` (BSD-2-Clause, MIT-compatible), while PDFs are parsed using Amazon Textract (LAYOUT + TABLES analysis), providing high-quality layout-aware extraction for scanned and digital PDFs. LlamaParse is intentionally not used, as it is a hosted third-party service and does not align with an AWS-only, data-resident architecture. LlamaIndex is used only for embedding generation and retrieval, with embeddings stored in a single `pgvector` table through a LlamaIndex `PGVectorStore`. It is not used for document ingestion or parsing.
- **Auth libs:** `aws-jwt-verify` (Cognito JWTs) and `jose` (provider-agnostic JWT), packaged as Lambda layers.
- Pin dependencies and commit lock files (`package-lock.json` for Node; `uv.lock` for Python via **uv**). Generate a pinned `requirements.txt` for Lambda/container bundling with `uv pip compile pyproject.toml -o requirements.txt`.

## 3. AWS Services & Infrastructure

- **Compute:** Lambda (Node 22 + Python 3.12; container images for heavy/AI workloads), ECS Fargate for long-lived/stateful realtime services.
- **Storage / Data:** RDS PostgreSQL 16 with **RDS Proxy** (TLS required) for relational + pgvector data; DynamoDB for session/conversation state; S3 for documents and file storage (block public access, `enforceSSL`, lifecycle rules).
- **Networking:** VPC with public / private-with-egress / isolated subnets; interface endpoints for Secrets Manager, SSM, RDS, API Gateway; gateway endpoint for DynamoDB; VPC flow logs enabled.
- **Security:** Cognito (user pool + identity pool), WAF (managed rule sets + rate limiting), Secrets Manager, SSM Parameter Store, Bedrock Guardrails.
- **AI/ML:** Amazon Bedrock — Claude (Sonnet/Haiku) for text generation, Cohere Embed for embeddings, Nova Sonic via Bedrock AgentCore for speech-to-speech voice.
- **Realtime / Voice:** Socket.IO on ECS Fargate for WebSocket communication; Bedrock AgentCore + Nova Sonic for voice; WebRTC with STUN/TURN where needed.
- **Observability:** CloudWatch Logs + metrics, RDS enhanced monitoring.
- **Delivery:** CloudFront, Amplify Hosting (frontend), SES (email).

## 4. Infrastructure as Code

- Use **AWS CDK v2 with TypeScript** (`aws-cdk-lib`, `constructs ^10`). Prefer it over SAM/Terraform/CloudFormation unless a project dictates otherwise.
- Conventions:
  - One stack per concern: `Vpc`, `Database`, `Api`, `EcsSocket`, `Amplify`, `CloudFrontWaf`, `CICD`, etc. Name stacks `${StackPrefix}-<Concern>`.
  - Drive naming from a `StackPrefix` context value; read repo/branch/domain from CDK context (`app.node.tryGetContext(...)`).
  - Set environment from `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`.
  - Tag every stack for cost allocation: `cdk.Tags.of(stack).add("Project", StackPrefix)`.
  - Use SSM parameters to share values between stacks instead of CloudFormation cross-stack exports where it avoids tight coupling; use `crossRegionReferences: true` for cross-region needs.
  - Set `RemovalPolicy.RETAIN` on stateful/production resources (RDS, ECR, S3 buckets holding data); `deletionProtection: true` and `storageEncrypted: true` on databases.
  - Enable IAM policy minimization (`@aws-cdk/aws-iam:minimizePolicies`).

## 5. API & Integration Patterns

- Primary API style is **REST via API Gateway**, defined from an **OpenAPI/Swagger spec** loaded with `SpecRestApi` (spec-first). Use a regional endpoint, enable metrics, set throttling limits, and log at ERROR level.
- Use **GraphQL (AppSync)** for realtime subscriptions/streaming.
- Use **event-driven** patterns (EventBridge, Lambda event sources) for async/scheduled work.
- **Auth:** Cognito user pool + identity pool. Verify JWTs with `aws-jwt-verify`; use a custom Lambda authorizer for API Gateway. Disable unauthenticated identities unless explicitly needed. Use federated IAM roles per Cognito auth state.
- For third-party integrations, store credentials in Secrets Manager and read at runtime — never inline.

## 6. Testing & Quality

- **CDK / TypeScript:** Jest + ts-jest. `fast-check` for property-based tests.
- **Python:** pytest + Hypothesis (property-based), with markers for `property`, `integration`, `slow`. Mock external dependencies for integration tests.
- **Linting:** ESLint flat config with `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` on the frontend.
- Run tests with minimal verbosity in automation (`npm test -- --silent`); use filters/markers when debugging specific tests. Aim for >80% coverage on public functions.
- Run the build/compile (`tsc`) before committing infra changes.

## 7. CI/CD & Deployment

- **Pipeline:** AWS CodePipeline + CodeBuild, defined in a dedicated CDK `CICD` stack.
  - Build Docker images per service, push to **ECR** (`imageScanOnPush: true`), and block promotion to `latest` on CRITICAL vulnerabilities.
  - Deploy Lambda container updates via `update-function-code`, publish a version, and shift a `live` alias (capture rollback command).
  - Use Docker layer caching; ARM build image for ARM/Graviton targets.
- **Frontend:** AWS Amplify Hosting with auto-build per branch; build spec installs Node 22 and runs `npm ci && npm run build` (Vite `dist` output).
- **Source:** GitHub via CodeStar/CodeConnections (preferred over embedding PATs in templates).
- Environment structure: parameterize via `StackPrefix` + `environmentName` (default `dev`); branches like `main` drive deployments.

## 8. Observability

- Use **CloudWatch Logs** for all Lambda/ECS output with deliberate, environment-appropriate log retention.
- Use the **AWS Lambda Powertools (Python)** layer for structured logging/metrics/tracing on Python Lambdas.
- Enable API Gateway metrics, WAF CloudWatch metrics + sampled requests, VPC flow logs, and RDS enhanced monitoring (`monitoringInterval`).
- ECS tasks log via the `awsLogs` driver with a stream prefix.
- Add distributed tracing (X-Ray / OpenTelemetry) for multi-service flows.

## 9. Developer Conventions

- **Project structure:** separate `cdk/` (infra + backend services) from `frontend/`. Within CDK: `bin/` (app entry), `lib/` (stacks), `lambda/` (function source), `layers/` (shared deps), plus per-service dirs. Frontend: `pages/`, `components/`, `services/`, `hooks/`, `lib/`.
- **Naming:** PascalCase for classes/interfaces/CDK constructs, camelCase for variables/functions, UPPER_SNAKE_CASE for constants. Prefix resource logical names/IDs with the stack id.
- **Secrets management:** never hardcode secrets. Use Secrets Manager for credentials/tokens and SSM Parameter Store for shared config and cross-stack values. Keep RDS credentials in Secrets Manager.
- **Environment variables:** frontend uses Vite `VITE_`-prefixed vars (commit a `.env.example`, never a real `.env`). Backend services receive config (secret names, endpoints, allowed origins) via Lambda/ECS environment variables, resolving actual secret values at runtime.
- **Containers:** multi-stage Dockerfiles — builder stage compiles C extensions, slim runtime stage copies only needed artifacts. Set `PYTHONUNBUFFERED=1`.
- **Networking/security defaults:** run data-plane compute in private/isolated subnets, require TLS to the database (`rds.force_ssl`), enforce SSL on S3, and prefer scoped IAM policies (least privilege) over `*` — split shared roles into per-function/per-service roles.
- **No backup/duplicate files** (`_fixed`, `_clean`, `_backup`); iterate on existing files. Keep a single comprehensive README plus focused `docs/`.
