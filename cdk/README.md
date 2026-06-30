# LEON Writing Coach - Infrastructure (`cdk/`)

AWS CDK v2 (TypeScript) infrastructure for the LEON Writing Coach platform.
One stack per concern, named `${StackPrefix}-<Concern>`.

## Purpose

This package defines all infrastructure-as-code. It is deployable by a
sponsor's own technical team with no source edits beyond documented
configuration values (REQ-NFR-OSS-01).

## Prerequisites

- Node.js 22.x or newer
- AWS CDK v2 CLI (bundled as a dev dependency; run via `npm run cdk`)
- AWS credentials configured for the target account/region

## Install

```bash
npm install
```

## Configuration

Naming and environment are driven by configuration, never source edits. The
application name defaults to `leon`; override it (e.g. to `wren`) via context:

| Context key       | Default                        | Purpose                                   |
| ----------------- | ------------------------------ | ----------------------------------------- |
| `appName`         | `leon`                         | Configurable application name             |
| `environmentName` | `dev`                          | Deployment environment                    |
| `stackPrefix`     | `${appName}-${environmentName}`| Drives `${StackPrefix}-<Concern>` naming  |

Account/region come from the standard CDK environment variables
(`CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`); region falls back to
`ca-central-1` for data residency.

Every stack is tagged for cost allocation (`Project = ${StackPrefix}`,
`Application`, `Environment`, `ManagedBy`).

## Commands

```bash
npm run build       # tsc compile
npm run typecheck   # tsc --noEmit
npm run synth       # cdk synth (uses cdk.json context defaults)
npm run cdk -- ...  # invoke the CDK CLI

# Override configuration at synth/deploy time:
npm run cdk -- synth -c appName=wren -c environmentName=prod
```

## Layout

```
cdk/
├── bin/leon.ts          # CDK app entry point
├── lib/
│   ├── config.ts        # StackPrefix / environmentName / env resolution
│   ├── tags.ts          # Cost-allocation tagging helper
│   ├── stacks/          # Concern stacks (added in task 2.1+)
│   └── constructs/      # Reusable custom constructs
├── lambda/              # Lambda function source (Node 22 + Python 3.12)
├── layers/              # Shared Lambda layers
└── test/                # Fine-grained + snapshot tests (tooling in task 1.3)
```
