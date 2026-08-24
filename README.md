# WREN: Socratic Writing Coach

WREN is an AI-powered writing feedback platform built on AWS. Writers submit drafts through a rich-text editor, and the system generates Socratic feedback: probing questions anchored to specific passages, never corrections or rewrites. Admins configure writing types and review aggregated analytics, while writers track their progress across iterative draft revisions. The AI debrief evaluates writing against configurable rubric definitions and surfaces both strengths and areas for improvement. Writers also have access to a chatbot feature to ask clarifying questions about how to act on specific feedback from the AI debrief.

## Documentation

| Document | Description |
|----------|-------------|
| [Debrief Architecture Deep Dive](docs/DEBRIEF_ARCHITECTURE_DEEP_DIVE.md) | Feedback pipeline, diff engine, anchor service, resolution tracking, and data model |
| [Architecture Diagram](docs/WREN_ARCHITECTURE_DIAGRAM.drawio.png) | System architecture diagram |
| [Feedback Pipeline Diagram](docs/WREN_FEEDBACK_PIPELINE_DIAGRAM.png) | End-to-end feedback generation flow |
| [Deployment Guide](docs/deployment-guide.md) | End-to-end AWS deploy (Bedrock, ECR, stack order, Amplify, first admin) |
| [Deployment Fixes](docs/deployment-fixes.md) | Issues found on the first CDK rollout and how they were resolved |
| [User Guide](docs/user-guide.md) | Students and department admins |
| [CDK README](cdk/README.md) | Stacks, context keys, and synth/deploy commands |
| [OpenAPI Spec](cdk/lib/openapi.yaml) | REST API definition used by API Gateway |
| [Database Migrations](backend/database/migrations/README.md) | Forward-only SQL migrations and schema invariants |
| [Shared Types](types/README.md) | Domain DTOs and the no-ghostwriting contract |
| [Frontend](frontend/README.md) | SPA scripts, tokens, and feature layout |
| [Feedback Engine](backend/engine/python/README.md) | Diff, anchors, prompt assembly, Bedrock invocation |

## High-Level Architecture

![Architecture Diagram](docs/WREN_ARCHITECTURE_DIAGRAM.drawio.png)

For a detailed breakdown of each component, data flows, and the full database schema, see the [Architecture Deep Dive](docs/DEBRIEF_ARCHITECTURE_DEEP_DIVE.md).

## Directories

```
├── backend/                # Backend microservices (Node.js 22 + Python 3.12)
│   ├── admin/              # Organization & Writing Type management service
│   ├── auth/               # Cognito JWT verification + DB identity mapping
│   ├── database/           # Migrations, schema, and shared DB access layer
│   ├── document/           # Draft ingestion, extraction, and segmentation
│   ├── engine/python/      # AI Feedback Engine (Docker Lambda)
│   ├── feedback/           # Feedback orchestration and quote resolution
│   └── notification/       # In-app notification processing and delivery
├── cdk/                    # AWS CDK infrastructure + Lambda handlers
│   ├── bin/                # CDK app entry point
│   ├── lambda/             # Lambda function bundles (esbuild targets)
│   ├── lambda-handlers/    # Lambda handler entry points (TypeScript)
│   ├── layers/             # Lambda layers (shared dependencies)
│   └── lib/stacks/         # CDK stack definitions
├── frontend/               # React SPA (Vite + Tailwind + TipTap)
│   └── src/
│       ├── features/       # Feature modules (editor, debrief, ask-wren, progress)
│       ├── pages/          # Route-level page components (by role)
│       ├── components/     # Shared UI components
│       ├── services/       # API service layer
│       └── hooks/          # Custom React hooks
├── types/                  # Shared TypeScript types (@wren/types)
├── docs/                   # Architecture and specification documents
├── scripts/                # Utility scripts
└── testing/                # Integration and E2E test infrastructure
```

| Directory | Description |
|-----------|-------------|
| `/backend/admin` | Organization groupings and configurable Writing Type catalog (CRUD, access-state control) |
| `/backend/auth` | Cognito JWT verification plus app-database identity mapping for API Gateway authorizer |
| `/backend/database` | PostgreSQL migrations, schema definitions, and shared Node.js data-access layer |
| `/backend/document` | Draft ingestion (.docx/.pdf upload + pasted text), extraction, and paragraph segmentation |
| `/backend/engine/python` | AI Feedback Engine — prompt assembly, Bedrock invocation, feedback parsing, diff engine, carry-forward, and resolution judge |
| `/backend/feedback` | Feedback orchestration service — quote resolution, sentence expansion, section applicability |
| `/backend/notification` | In-app notification processing — recipient resolution, deduplication, template rendering, AppSync publishing |
| `/cdk` | AWS CDK v2 infrastructure code (TypeScript) — all stack definitions and Lambda handlers |
| `/frontend` | React 19 frontend — TipTap rich-text editor, AI Debrief sidebar, Ask LEON chat, progress tracking |
| `/types` | Shared TypeScript package (`@wren/types`) — schemas, TipTap helpers, segment utilities |
| `/docs` | Architecture documents and feature specifications |

## Technology Stack

### Frontend

- **React 19** with TypeScript (strict)
- **Vite 7** for build tooling
- **Tailwind CSS 4** with centralized design tokens
- **shadcn/ui** (Radix UI) for UI components
- **TipTap** for the document editor
- **TanStack Query** for server state
- **React Hook Form + Zod** at the API boundary
- **React Router** for client-side routing
- **AWS Amplify** for hosting; **Amazon Cognito** for sign-in

### Backend

- **AWS Lambda** (Node.js 22 and Python 3.12) for serverless compute
- **Amazon Bedrock** for LLM inference (default Claude Sonnet 4.6 inference profile)
- **Amazon Textract** for scanned / digital PDF extraction
- **Amazon SQS** for async feedback jobs (plus a DLQ)
- **Amazon RDS PostgreSQL 16** with **pgvector**, reached through **RDS Proxy** (TLS)
- **Amazon S3** for document and reference-material bytes
- **Amazon DynamoDB** for Ask LEON conversation state
- **API Gateway** (REST) from the OpenAPI spec
- **AWS AppSync** for realtime debrief notifications
- **Amazon Cognito** for authentication and the `SystemAdmin` bootstrap group

### Infrastructure

- **AWS CDK** (TypeScript) for infrastructure as code
- **Amazon VPC** (public / private / isolated), NAT Gateway, VPC endpoints
- **Amazon CloudFront + AWS WAF** in `us-east-1` in front of the API
- **Amazon CloudWatch** dashboards and alarms
- Data plane region: **`ca-central-1`**

## Credits

This application was architected and developed by [Jovan Kalirai](https://www.linkedin.com/in/jovank99/) and [Rajrupa Sanyal](https://www.linkedin.com/in/rajrupasanyal/) with project assistance by [Raza Sidhu](https://www.linkedin.com/in/raza-sidhu-b65253301/). Thanks to the UBC Cloud Innovation Centre Technical and Project Management teams for their guidance and support.

## License

This project is licensed under the [MIT License](LICENSE).

Licenses of libraries and tools used by the system are listed below:

[PostgreSQL License](https://www.postgresql.org/about/licence/) : For PostgreSQL, a liberal open source license similar to BSD or MIT.

[Anthropic Acceptable Use Policy](https://www.anthropic.com/legal/aup) : For Claude Sonnet 4.6, accessed via Amazon Bedrock for feedback generation and resolution judging.

[TipTap License](https://tiptap.dev/docs/license) : For the TipTap rich-text editor framework (MIT-licensed core).
