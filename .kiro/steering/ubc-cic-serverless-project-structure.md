---
title: Serverless Project Structure
inclusion: auto
name: serverless-project-structure
description: Standard directory layout for a CDK serverless application with frontend, backend, deployment scripts, and documentation.
---

# Serverless Project Structure (CDK)

Use this layout when scaffolding a new CDK-based serverless application. It separates
infrastructure, backend application code, and frontend application code, and ships with
deployment scripts, documentation folders, and sensible defaults for READMEs and
`.gitignore` files.

## Top-Level Layout

```
my-serverless-app/
├── .github/
│   └── workflows/              # CI/CD pipelines (lint, test, deploy)
│       ├── deploy.yml
│       └── test.yml
├── cdk/                        # Infrastructure as code (AWS CDK)
│   ├── bin/
│   │   └── app.ts              # CDK app entry point (per-env stacks/stages)
│   ├── src/
│   │   ├── stacks/             # Stacks import resources & instantiate constructs
│   │   ├── constructs/         # Reusable custom constructs
│   │   └── stages/             # Multi-stack deployment stages
│   ├── test/                   # Fine-grained + snapshot tests
│   ├── cdk.json
│   ├── package.json
│   ├── tsconfig.json
│   ├── .gitignore              # CDK/Node specific ignores
│   └── README.md               # How to synth/deploy/destroy
├── backend/                    # Application/business logic (Lambda handlers, services)
│   ├── src/
│   │   ├── handlers/           # Lambda entry points
│   │   ├── services/           # Domain/business logic
│   │   ├── models/             # Data models & schemas
│   │   └── utils/              # Shared helpers
│   ├── tests/                  # Unit & integration tests
│   ├── requirements.txt        # (Python) or package.json (Node)
│   ├── .gitignore              # Language/runtime specific ignores
│   └── README.md               # Local dev, testing, env vars
├── frontend/                   # Client application (React/Vue/etc.)
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   ├── services/           # API clients
│   │   └── assets/
│   ├── tests/
│   ├── package.json
│   ├── .gitignore              # Node/build artifact ignores
│   └── README.md               # Build, run, configure API endpoints
├── scripts/                    # Deployment & operational scripts
│   ├── deploy.sh               # Build + deploy all stacks
│   ├── destroy.sh              # Tear down environment
│   ├── bootstrap.sh            # One-time CDK bootstrap per account/region
│   └── seed-data.sh            # Optional: seed dev data
├── docs/                       # Project documentation
│   ├── architecture/           # Diagrams, ADRs, design notes
│   ├── api/                    # API reference / OpenAPI specs
│   ├── deployment/             # Environment setup & runbooks
│   └── README.md               # Docs index
├── .gitignore                  # Root-level ignores (OS, IDE, secrets)
├── .editorconfig
├── LICENSE
└── README.md                   # Project overview, quick start, links to docs
```

## Directory Responsibilities

- **`cdk/`** — All infrastructure. Stacks import existing resources (`Vpc.fromLookup()`,
  `Bucket.fromBucketName()`) and instantiate constructs. Constructs hold reusable
  resource definitions and never import resources directly. Apps wire up distinct
  stack/stage instances per environment with explicit account/region values.
- **`backend/`** — Runtime application code deployed as Lambda functions. Keep handlers
  thin and delegate to `services/`. No CDK or deployment concerns here.
- **`frontend/`** — Single-page or static frontend. API endpoints come from build-time
  config or runtime environment, never hardcoded.
- **`scripts/`** — Thin wrappers around CDK and AWS CLI for repeatable operations.
  Scripts must be idempotent where possible and never embed secrets.
- **`docs/`** — Living documentation. Architecture decisions, API specs, and deployment
  runbooks live here so they stay close to the code.

## Default README Contents

Every package (`cdk/`, `backend/`, `frontend/`) and the root must include a `README.md`.
Each README should cover, at minimum:

- Purpose of the package
- Prerequisites (runtime versions, AWS account/CLI setup)
- Install steps
- Local development / run commands
- Test commands
- Deploy / build commands (where applicable)
- Environment variables and configuration

The root `README.md` provides the project overview, a quick-start, and links into
`docs/` and each package README.

## Default .gitignore Files

Place a `.gitignore` at the root and in each package. Common entries:

**Root `.gitignore`**
```
# OS / IDE
.DS_Store
.idea/
.vscode/
*.swp

# Secrets / local env
.env
.env.*
*.pem
aws-exports.js

# Logs
*.log
```

**`cdk/.gitignore`**
```
node_modules/
cdk.out/
*.js
*.d.ts
.cdk.staging/
coverage/
```

**`backend/.gitignore`** (Python example)
```
__pycache__/
*.pyc
.venv/
.pytest_cache/
dist/
build/
*.egg-info/
```

**`frontend/.gitignore`**
```
node_modules/
dist/
build/
.cache/
coverage/
.env.local
```

## Deployment Scripts

Keep deployment logic in `scripts/` so it is consistent across environments and CI.

- **`bootstrap.sh`** — Run `cdk bootstrap` for the target account/region (one-time).
- **`deploy.sh`** — Build backend artifacts and frontend bundle, then `cdk deploy` the
  target stage. Accept the environment as an argument (e.g. `./deploy.sh dev`).
- **`destroy.sh`** — `cdk destroy` for non-production environments. Require an explicit
  environment argument and confirm before tearing down anything that looks like
  production.
- **`seed-data.sh`** — Optional helper to populate development data stores.

Scripts must read configuration from environment variables or argument flags, never
hardcode account IDs, regions, or secrets.

## Conventions

- One project, three deployable concerns: infrastructure (`cdk/`), backend, frontend.
- Tests live alongside the code they cover (`cdk/test/`, `backend/tests/`,
  `frontend/tests/`).
- Documentation is version-controlled in `docs/` and kept current with code changes.
- No secrets in source control; rely on AWS Secrets Manager / SSM Parameter Store and
  local `.env` files that are git-ignored.
