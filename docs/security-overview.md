# Security Overview

**Project:** LEON (WREN Writing Coach)
**Document Type:** Public Security Architecture Overview
**Last Updated:** August 2026

The product display name is **LEON**. AWS resources and this repository use the project prefix **WREN**.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Security Architecture](#2-security-architecture)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [API Security](#4-api-security)
5. [Network Security](#5-network-security)
6. [Data Protection](#6-data-protection)
7. [GenAI Security](#7-genai-security)
8. [Monitoring & Compliance](#8-monitoring--compliance)
9. [Security Contact](#9-security-contact)

---

## 1. Introduction

LEON is an AI writing coach that gives **Socratic feedback** (questions, never rewrites) on student drafts. Writers compose or upload documents, request an AI Debrief, and revise across drafts. Department admins configure document types, evaluation criteria, and prompts. This document summarizes the security measures used to protect user data, enforce least-privilege access, and keep the coaching service available.

### 1.1 Security Principles

| Principle | Description |
|-----------|-------------|
| **Defense in Depth** | Edge (CloudFront + WAF), API Gateway, Lambda authorizer, and per-service capability checks |
| **Least Privilege** | Per-Lambda Postgres roles; no implicit admin hierarchy; IdP groups are not the ongoing authorization source |
| **Encryption Everywhere** | TLS in transit; encryption at rest on RDS, S3, and DynamoDB |
| **Zero Trust** | Every API call is authenticated; privileged operations are re-checked in the handler |
| **No Ghostwriting** | Prompts, model output, and API DTOs are forbidden from carrying replacement prose |
| **Data Residency** | Persistent application data stays in the AWS Region you deploy; no cross-region replicas by default |

---

## 2. Security Architecture

### 2.1 High-Level Architecture

```
╔═════════════════════════════════════════════════════════════════╗
║                          INTERNET                               ║
╚══════════════════════════════╤══════════════════════════════════╝
                               │
                               ▼
╔═════════════════════════════════════════════════════════════════╗
║                      EDGE SECURITY LAYER                        ║
║                                                                 ║
║   ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐   ║
║   │   CloudFront    │  │    AWS WAF      │  │ Shield Std.   │   ║
║   │   CDN + TLS     │  │  (on CloudFront)│  │ (with CF)     │   ║
║   └─────────────────┘  └─────────────────┘  └───────────────┘   ║
║   Amplify hosts the React web app (Cognito sign-in)             ║
╚══════════════════════════════╤══════════════════════════════════╝
                               │
                               ▼
╔═════════════════════════════════════════════════════════════════╗
║                      APPLICATION LAYER                          ║
║                                                                 ║
║   ┌─────────────────────────────────────────────────────────┐   ║
║   │              API Gateway  (REST, OpenAPI)               │   ║
║   │   Request validators · Throttling · ERROR logs · X-Ray  │   ║
║   └───────────────────────────┬─────────────────────────────┘   ║
║                               │                                 ║
║   ┌─────────────────────────────────────────────────────────┐   ║
║   │               Cognito Lambda Authorizer                 │   ║
║   │   JWT verify · App-user mapping · Coarse Allow (30s)    │   ║
║   └───────────────────────────┬─────────────────────────────┘   ║
║                               │                                 ║
║   ┌─────────────────────────────────────────────────────────┐   ║
║   │          Lambdas in private subnets (VPC)               │   ║
║   │   Capability matrix · Ownership checks · Zod/OpenAPI    │   ║
║   └─────────────────────────────────────────────────────────┘   ║
║   AppSync (realtime debrief / notifications, Lambda auth)       ║
╚══════════════════════════════╤══════════════════════════════════╝
                               │
                               ▼
╔═════════════════════════════════════════════════════════════════╗
║                         DATA LAYER                              ║
║                                                                 ║
║   ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐   ║
║   │   RDS Proxy     │  │  PostgreSQL 16  │  │  S3 + DynamoDB║   ║
║   │   TLS required  │  │  Isolated + SSL │  │  CMK (KMS)    │   ║
║   └─────────────────┘  └─────────────────┘  └───────────────┘   ║
║   Secrets Manager (DB credentials) · SSM (config, model id)     ║
╚══════════════════════════════╤══════════════════════════════════╝
                               │
                               ▼
╔═════════════════════════════════════════════════════════════════╗
║                         AI LAYER                                ║
║                                                                 ║
║   ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐   ║
║   │    Bedrock      │  │  Guardrail      │  │   Textract    │   ║
║   │  Claude (SSM)   │  │  prompt attack  │  │   (PDF OCR)   │   ║
║   └─────────────────┘  └─────────────────┘  └───────────────┘   ║
║   SQS feedback jobs · Python engine output guardrail            ║
╚═════════════════════════════════════════════════════════════════╝
```

### 2.2 Security Layers Summary

| Layer | Components | Security Controls |
|-------|------------|-------------------|
| **Edge** | CloudFront, WAF, Shield Standard | TLS redirect, managed WAF rules, per-IP rate limit, security headers |
| **Application** | Amplify React web app, API Gateway, Cognito, Lambdas, AppSync | JWT auth, dual authorization, schema validation, ownership checks |
| **Data** | RDS, RDS Proxy, S3, DynamoDB, Secrets Manager, SSM | Encryption, isolated subnets, per-service DB roles, block public access |
| **AI/ML** | Bedrock, Textract, Feedback Engine | Delimited untrusted student text, no-ghostwriting guards, prompt-attack scan on admin prompts |

---

## 3. Authentication & Authorization

### 3.1 Authentication Model

All users authenticate with **Amazon Cognito** (email alias, SRP and password flows). There is no anonymous REST access except CORS `OPTIONS` preflight. Self-signup is enabled; email verification uses a one-time code. Account recovery is **email only**. MFA is **optional**.

Cognito tokens: access and ID tokens are valid for **1 hour**; refresh tokens for **30 days**. The React web app sends `Authorization: Bearer {accessToken}` on REST calls. AppSync realtime subscriptions use the **ID** token.

```
╔═════════════════════════════════════════════════════════════════╗
║                     AUTHENTICATION FLOW                         ║
╠═════════════════════════════════════════════════════════════════╣
║                                                                 ║
║   ┌──────────────────────┐                                      ║
║   │   Amazon Cognito     │                                      ║
║   │   User Pool          │                                      ║
║   │                      │                                      ║
║   │  · Email + password  │                                      ║
║   │  · Optional MFA      │                                      ║
║   │  · SystemAdmin group │  (first-login bootstrap only)        ║
║   └──────────┬───────────┘                                      ║
║              │  JWT                                             ║
║              ▼                                                  ║
║   ┌──────────────────────┐                                      ║
║   │  Lambda Authorizer   │                                      ║
║   │  aws-jwt-verify      │                                      ║
║   │  Map sub → app_user  │                                      ║
║   │  Attach roles/grants │                                      ║
║   └──────────┬───────────┘                                      ║
║              │                                                  ║
║              ▼                                                  ║
║   ┌──────────────────────┐                                      ║
║   │  Service Lambda      │                                      ║
║   │  Capability matrix   │                                      ║
║   │  + resource owner    │                                      ║
║   └──────────────────────┘                                      ║
╚═════════════════════════════════════════════════════════════════╝
```

The IdP proves identity only. After first login, **PostgreSQL is the authorization source of truth**. Membership in the Cognito `SystemAdmin` group seeds a **TechnicalAdmin** role on first provision; groups are not re-read on later requests.

### 3.2 Authorization Controls

| Control | Implementation |
|---------|----------------|
| **Dual enforcement** | Authorizer issues a cacheable stage-wide Allow (TTL **30s**). Each Lambda re-checks the operation against `authorizeCapability`. |
| **Roles** | `Student`, `DepartmentAdmin`, `TechnicalAdmin`. No implicit hierarchy — Technical Admin is not a superuser for department educational content. |
| **Department scope** | Department Admin operations require the target department in `administeredDepartmentIds`. |
| **Resource ownership** | Students can only read/mutate documents they own (Document / Feedback Lambdas). |
| **Access grants** | `LOCKED` document types require an active grant before submission. |
| **Token expiration** | 1-hour access/ID tokens; authorizer rejects expired or invalid JWTs with 401. |

### 3.3 Password Policy

Configured on the Cognito user pool:

- Minimum **8** characters
- Requires uppercase, lowercase, and digits
- Symbols **not** required
- Account recovery via verified email only
- MFA optional (user-configurable)

---

## 4. API Security

### 4.1 Request Security Pipeline

```
  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │   WAF    │───▶ │  Rate    │────▶│  Schema  │────▶│ Author-  │
  │  (CF)    │     │  Limit   │     │  Valid.  │     │  izer    │
  └──────────┘     └──────────┘     └──────────┘     └──────────┘
       │                │                │                │
       ▼                ▼                ▼                ▼
  ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
  │  Block   │     │ Throttle │     │  Reject  │     │   401    │
  │ Attacks  │     │  Excess  │     │ Invalid  │     │ / 403    │
  └──────────┘     └──────────┘     └──────────┘     └──────────┘
                         │
                         ▼
                   Handler capability + ownership
```

WAF is associated with the **CloudFront** distribution. Clients that call the **API Gateway URL directly** are authenticated but are **not** behind this WAF. Prefer `DistributionDomainName` (or restrict the API origin) for edge protection. There is no Lambda@Edge.

### 4.2 WAF Rules

| Rule | Protection |
|------|------------|
| **AWSManagedRulesCommonRuleSet** | Common web exploits (including SQLi / XSS classes) |
| **AWSManagedRulesKnownBadInputsRuleSet** | Known malicious payloads |
| **AWSManagedRulesAmazonIpReputationList** | Amazon IP reputation |
| **RateLimitPerIP** | Block at **2000 requests / 5 minutes / IP** |

CloudFront also applies a response headers policy: HSTS (1 year, includeSubDomains), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, XSS filter, referrer policy, and a Content-Security-Policy that disallows `javascript:` URIs and framing.

### 4.3 Request Validation

| Control | Detail |
|---------|--------|
| **OpenAPI** | Spec-first API Gateway (`cdk/lib/openapi.yaml`); validators `body-only` / `params-only` / `full` on selected routes |
| **Throttling** | Stage limits: **100** req/s sustained, **200** burst |
| **Application schemas** | Zod at the shared `@wren/types` boundary and in handlers |
| **Parameterized queries** | Postgres access via bound parameters (`$1`, …) — no string-concatenated SQL |
| **Uploads** | Presigned POST: `.docx` / `.pdf` only, content-type and size conditions, **15-minute** expiry |
| **API Gateway cache** | Method caching **off** (encrypted cache cluster present for Control Tower). Feedback GET must not skip ownership checks. |

### 4.4 CORS Configuration

API Gateway and Lambda responses currently send `Access-Control-Allow-Origin: *` with methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`. Gateway-generated 401/403/5xx responses include the same CORS headers so browsers surface the real status instead of a false CORS failure.

This is intentionally wide for development. **Tighten origins to the Amplify / application domain before treating the deployment as production-hardened.**

REST API details: [`docs/api-guide.md`](./api-guide.md).

---

## 5. Network Security

### 5.1 VPC Architecture

Three-tier VPC (`10.0.0.0/16`, two AZs) in the data-plane Region:

```
╔═════════════════════════════════════════════════════════════════╗
║                       VPC ARCHITECTURE                          ║
╠═════════════════════════════════════════════════════════════════╣
║                                                                 ║
║   ┌─────────────────────────────────────────────────────────┐   ║
║   │                    PUBLIC SUBNETS                       │   ║
║   │   · NAT Gateway  (Lambda egress)                        │   ║
║   │   · Internet Gateway                                    │   ║
║   └───────────────────────────┬─────────────────────────────┘   ║
║                               │                                 ║
║                               ▼                                 ║
║   ┌─────────────────────────────────────────────────────────┐   ║
║   │                   PRIVATE SUBNETS                       │   ║
║   │   · All application Lambdas                             │   ║
║   │   · Interface VPC endpoints                             │   ║
║   │   · Outbound via NAT when a private API is not used     │   ║
║   └───────────────────────────┬─────────────────────────────┘   ║
║                               │                                 ║
║                               ▼                                 ║
║   ┌─────────────────────────────────────────────────────────┐   ║
║   │                   ISOLATED SUBNETS                      │   ║
║   │   · RDS PostgreSQL  (no internet route)                 │   ║
║   │   · RDS Proxy  (TLS required)                           │   ║
║   └─────────────────────────────────────────────────────────┘   ║
╚═════════════════════════════════════════════════════════════════╝
```

### 5.2 Network Controls

| Control | Implementation |
|---------|----------------|
| **Subnet isolation** | Database in isolated subnets; instance SG allows Postgres only from the proxy SG |
| **Proxy ingress** | RDS Proxy allows TCP 5432 from the VPC CIDR (in-VPC Lambdas) |
| **VPC endpoints** | Gateway: S3, DynamoDB. Interface: Secrets Manager, SSM, RDS, API Gateway, Bedrock Runtime |
| **VPC Flow Logs** | All traffic → CloudWatch; retention **1 month** |
| **NAT** | Single NAT gateway (non-prod default) |

### 5.3 Encryption in Transit

| Connection | Protocol |
|------------|----------|
| CloudFront → viewers | HTTPS; HTTP redirected |
| CloudFront → API Gateway | HTTPS only |
| API Gateway | HTTPS / TLS (HTTP not accepted) |
| AppSync realtime | WSS (`appsync-realtime-api`) |
| RDS Proxy → PostgreSQL | TLS required; `rds.force_ssl = 1` |
| Lambda → AWS APIs | TLS; prefer VPC endpoints |
| Browser → S3 upload | HTTPS presigned POST (`enforceSSL` on buckets) |

---

## 6. Data Protection

### 6.1 Data Classification

| Data Type | Classification | Protection |
|-----------|----------------|------------|
| Cognito credentials | Sensitive | Managed by Cognito; never stored in the app database |
| User profile (email, name, roles) | Private | RDS; role changes audited |
| Drafts and documents | Private | Owner-scoped in RDS; bytes in S3 (KMS); Textract may read document objects |
| AI Debrief items | Private | Owner-scoped; Socratic questions only (no replacement prose) |
| Ask LEON transcripts | Private | DynamoDB conversation table (CMK + TTL) |
| Helpfulness / applicability votes | Internal aggregate | Stored **without** `user_id` for admin analytics |
| Activity / audit log | Internal | Append-only; actor IDs **pseudonymized** (salted one-way id); survives document deletion |
| Admin prompts & taxonomy | Internal | Department-scoped; save-time ghostwriting + Bedrock prompt-attack checks |
| Reference material | Internal | Separate S3 bucket, KMS, not public |

Persistent stores are provisioned in the **data-plane Region** chosen at deploy time. CloudFront is a global CDN (WAF is associated with the distribution). That is not a replica of student content. Stack tests forbid S3 CRR, DynamoDB global tables, and RDS cross-region replicas.

### 6.2 Encryption at Rest

```
╔═════════════════════════════════════════════════════════════════╗
║                      ENCRYPTION AT REST                         ║
╠═════════════════════════════════════════════════════════════════╣
║                                                                 ║
║   ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐   ║
║   │  RDS PostgreSQL │  │   S3 buckets    │  │   DynamoDB    │   ║
║   │ storageEncrypted│  │   SSE-KMS CMK   │  │   CMK         │   ║
║   │ (AWS RDS key)   │  │   + bucket keys │  │   + PITR      │   ║
║   └─────────────────┘  └─────────────────┘  └───────────────┘   ║
║                                                                 ║
║   Storage CMK: customer-managed, annual key rotation enabled    ║
║                                                                 ║
╠═════════════════════════════════════════════════════════════════╣
║                      ENCRYPTION IN TRANSIT                      ║
╠═════════════════════════════════════════════════════════════════╣
║                                                                 ║
║   ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐   ║
║   │ CloudFront / API│  │   RDS Proxy     │  │   Bedrock     │   ║
║   │    TLS 1.2+     │  │  TLS required   │  │     TLS       │   ║
║   └─────────────────┘  └─────────────────┘  └───────────────┘   ║
║                                                                 ║
╚═════════════════════════════════════════════════════════════════╝
```

RDS uses **storage encryption** (`storageEncrypted: true`) with the default RDS-managed key. S3 (documents + reference) and the Ask LEON DynamoDB table use a **customer-managed KMS key** with rotation. Stateful RDS/S3/DynamoDB use `RemovalPolicy.RETAIN` and RDS `deletionProtection`. A full inventory of AWS-managed keys (Secrets Manager, SQS, SNS, ECR, logs, CodePipeline artifacts) and CMK cutover steps is in [AWS Managed Keys](./aws-managed-keys.md).

### 6.3 Credential Management

| Credential | Storage | Rotation |
|------------|---------|----------|
| RDS admin (`dbadmin`) | Secrets Manager (generated) | Manual / operator-driven (no CDK rotation schedule today) |
| Per-Lambda DB roles | Secrets Manager + RDS Proxy | Generated secrets; proxy IAM auth to secrets; sync via custom resource |
| Cognito pool / client IDs | SSM Parameter Store | Static identifiers |
| Bedrock model id, guardrail id | SSM | Updated by Technical Admin / deploy |
| Activity-log pseudonym salt | Lambda environment (`WREN_ACTIVITY_PSEUDONYM_SALT`) | Treat as a secret; changing it breaks historical grouping |

Least-privilege Postgres roles (examples): `wren_authorizer`, `wren_document`, `wren_admin`, `wren_audit`, `wren_feedback_orch`, `wren_feedback_engine`, `wren_notification`, `wren_appsync_auth`. Passwords are never committed to git or migration SQL.

### 6.4 S3 Bucket Security

| Control | Detail |
|---------|--------|
| **Block Public Access** | `BLOCK_ALL` on documents and reference buckets |
| **SSL required** | `enforceSSL: true` |
| **KMS** | SSE-KMS with bucket keys; presigned POST includes KMS fields when configured |
| **Versioning + lifecycle** | Abort incomplete MPU (7d); expire tagged orphan uploads (1d); noncurrent IA then expire |
| **Presigned POST** | 15 minutes; size range; exact `Content-Type`; `.docx` / `.pdf` only |
| **Textract** | Bucket policy allows Textract to `GetObject` on the documents bucket |

---

## 7. GenAI Security

LEON is **not** a retrieval chatbot over an organizational knowledge base. The model coaches a **specific student draft**. The primary GenAI risks are prompt injection from student text/admin prompts, and **ghostwriting** (the model rewriting the essay).

### 7.1 AI Security Pipeline

```
  STUDENT DRAFT / ADMIN PROMPT
      │
      ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  1 · INPUT VALIDATION                                       │
  │      · Authz, size limits, file type, usage caps            │
  │      · Admin typePromptText: no-ghostwriting phrase scan    │
  │      · Admin text: Bedrock Guardrail PROMPT_ATTACK (MEDIUM) │
  │     ✗  Rejected → 400, no persistence / no LLM call         │
  └───────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  2 · PROMPT ASSEMBLY                                        │
  │      · System scaffolding + document-type config            │
  │      · Student text, footnotes, reference material in a     │
  │        delimited UNTRUSTED DATA block (random boundary)     │
  │      · Instruct the model: data is not instructions         │
  └───────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  3 · LLM GENERATION (Amazon Bedrock)                        │
  │      · Configurable model id (SSM / admin API)              │
  │      · Socratic questions only — never replacement prose    │
  └───────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  4 · OUTPUT GUARDRAIL                                       │
  │      · Allow-list fields (category, question, optional      │
  │        anchor / citation / positive_note)                   │
  │      · Strip rewrite-shaped fields; reject rewrite-in-      │
  │        question content                                     │
  │      · Audit violations for Technical Admin review          │
  └───────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  5 · API CONTRACT                                           │
  │      · @wren/types: no DTO may carry replacementProse       │
  │      · Strict Zod parse at boundaries                       │
  └───────────────────────────┬─────────────────────────────────┘
                              │
                              ▼
  SOCRATIC DEBRIEF TO STUDENT
```

Ask LEON follows the same coaching posture (Socratic replies, draft-anchored session in DynamoDB), not free-form essay generation.

### 7.2 Prompt Security

| Control | Description |
|---------|-------------|
| **Untrusted data delimiters** | Student content is wrapped in `BEGIN/END UNTRUSTED DATA [{token}]`; the token is chosen so the student cannot close the block early |
| **Save-time prompt scan** | Department Type prompts that instruct rewrites are rejected before DB write (`PromptGuardrailError`) |
| **Bedrock prompt attack** | Admin-submitted prompt fields are scanned with a dedicated Guardrail (`PROMPT_ATTACK`, input MEDIUM) |
| **Injection audit** | Guardrail outcomes recorded (`guardrail.passed`, `guardrail.violation_rejected`, `guardrail.injection_mitigated`) |

This Guardrail is **prompt-attack detection on admin configuration**, not a general PII redaction filter on student essays.

### 7.3 Output Validation (No Ghostwriting)

| Control | Description |
|---------|-------------|
| **Field allow-list** | Extra model fields (rewrite, replacement, “correct version”, …) are stripped |
| **Question content scan** | Items whose `question` is itself a rewrite are rejected |
| **Compile-time DTO check** | `@wren/types` fails the build if a type gains `replacementProse` |
| **Runtime parse** | Strict schemas reject unknown keys at the API boundary |

### 7.4 Related Controls

| Control | Description |
|---------|-------------|
| **Usage limits** | Lifetime caps on messages, debriefs, uploads, drafts; `429 USAGE_LIMIT_REACHED`; temporary overrides |
| **Anonymous ratings** | Helpfulness comments are not stored with student identity |
| **PDF ingest** | Textract in-account; no third-party OCR SaaS |

---

## 8. Monitoring & Compliance

### 8.1 Logging Architecture

```
  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
  │   API Gateway   │   │     Lambda      │   │   VPC Flow      │
  │   ERROR logs    │   │   CloudWatch    │   │     Logs        │
  │   + X-Ray       │   │                 │   │                 │
  └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
           │                     │                     │
           └─────────────────────┼─────────────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │  CloudWatch Logs      │
                     │  Metrics · Alarms     |
                     └───────────┬───────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │  CloudWatch Alarms    │
                     │  → SNS alarm topic    │
                     └───────────────────────┘
```

### 8.2 Security Logging

| Log Type | Content | Retention |
|----------|---------|-----------|
| **Lambda logs** | Execution and errors (do not log JWTs or raw student PII in new code) | **30 days** (non-prod) / **90 days** (`prod` environment) |
| **API Gateway** | ERROR-level execution logs; stage metrics; X-Ray tracing enabled | Follows API/log group settings |
| **VPC Flow Logs** | Network metadata (ALL traffic) | **1 month** |
| **WAF** | CloudWatch metrics + sampled requests on the WebACL | WAF/CloudWatch defaults |
| **Activity log (app DB)** | Privileged actions, prompt edits, guardrail outcomes; pseudonymous actor | Application retention (independent of document delete) |
| **RDS** | Enhanced Monitoring (60s) | RDS monitoring |

Useful log groups (example prefix `wren-dev-`): `/aws/lambda/wren-dev-authorizer`, `wren-dev-document`, `wren-dev-feedback-orchestrator`, `wren-dev-feedback-engine`, `wren-dev-admin`.

### 8.3 Alerting

SNS topic `{stackPrefix}-alarms`. Alarms include:

| Alert | Trigger | Purpose |
|-------|---------|---------|
| **Lambda errors** | Errors > 5 in 5 minutes (per function) | Detect handler failures |
| **Lambda throttles** | Throttles on a function | Capacity / reserved concurrency |
| **Feedback queue depth** | Queue depth > 50 | Debrief backlog / degradation |
| **Feedback DLQ** | Any messages on the DLQ | Poison jobs |
| **API p99 latency** | p99 > 10 seconds | Slow API / debrief path |

WAF block rate is visible in WAF CloudWatch metrics; there is no dedicated “WAF block” alarm in the Observability stack today.

### 8.4 Compliance Summary

| Control Area | Status | Notes |
|--------------|--------|-------|
| **Encryption at Rest** | Enabled | RDS storage encryption; S3/DynamoDB customer-managed KMS with rotation |
| **Encryption in Transit** | Enabled | HTTPS/WSS; RDS `force_ssl` + proxy `requireTLS` |
| **Access Control** | Enabled | Cognito JWT + DB roles + capability matrix + document ownership |
| **Audit Logging** | Enabled | Activity events (pseudonymous), CloudWatch, VPC flow logs |
| **Credential Management** | Enabled | Secrets Manager for DB users; SSM for non-secret config |
| **Input Validation** | Enabled | OpenAPI + Zod + upload constraints |
| **Rate Limiting** | Enabled | WAF (CloudFront) + API Gateway throttling |
| **GenAI / ghostwriting** | Enabled | Delimited untrusted input, save-time + output guardrails, DTO ban |
| **Prompt injection (admin)** | Enabled | Bedrock `PROMPT_ATTACK` on admin prompt fields |
| **Data residency** | Enabled | Persistent data in the deployed Region; no cross-region replicas |
| **PII redaction in Bedrock** | Not a product control | No KBA-style PII anonymization filter on student text |
| **CORS lock-down** | Partial | Currently `*`; tighten for production |
| **WAF on raw API URL** | Partial | WAF protects CloudFront, not the execute-api hostname |
| **Secret auto-rotation** | Not scheduled in CDK | Credentials are generated into Secrets Manager; add rotation if required |
| **MFA** | Optional | Cognito MFA is not required |

---

## 9. Security Contact

For security concerns or to report vulnerabilities, contact the project maintainers through the repository’s security policy (or the UBC CIC project owner if no `SECURITY.md` is published).

Related documents:

- [REST API Documentation](./api-guide.md)
- [Deployment Guide](./deployment-guide.md)
- [Architecture Deep Dive](./architecture-deep-dive.md)
- [Debrief / Diff / Anchor Pipeline](./DEBRIEF_ARCHITECTURE_DEEP_DIVE.md)
- [Bedrock Guardrails](./bedrock-guardrails.md)
- OpenAPI: `cdk/lib/openapi.yaml`

---

*This document provides a high-level overview of security controls as implemented in this repository. It does not replace a formal threat model or compliance attestation.*
