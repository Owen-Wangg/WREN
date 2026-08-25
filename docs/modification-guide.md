# LEON — Project Modification Guide

This guide covers practical modifications developers commonly need: theming, branding, authentication, API extensions, frontend, LLM configuration, migrations, document ingest, the Feedback Engine, usage limits, encryption, and deployment.

Related docs:

- [REST API](./api-guide.md)
- [Security overview](./security-overview.md)
- [Deployment guide](./deployment-guide.md)
- [Dependency management](./dependency-management.md)
- [AWS managed keys](./aws-managed-keys.md)
- [Feedback engine](../backend/engine/python/README.md)
- [Database migrations](../backend/database/migrations/README.md)
- [CDK package](../cdk/README.md)

The product display name is **LEON**. AWS resources and this repository use the prefix **WREN**.

---

## Table of Contents

- [Modifying Colors and Styles](#modifying-colors-and-styles)
- [Display Name and Branding](#display-name-and-branding)
- [Authentication and Authorization](#authentication-and-authorization)
- [Using External Identity Providers (Enterprise SSO)](#using-external-identity-providers-enterprise-sso)
- [Extending the API](#extending-the-api)
- [Modifying Frontend Components](#modifying-frontend-components)
- [Legal Copy, Disclaimer, and License](#legal-copy-disclaimer-and-license)
- [Configuring LLM Models](#configuring-llm-models)
- [Database Schema Changes (Migrations)](#database-schema-changes-migrations)
- [Usage Limit Management](#usage-limit-management)
- [Document Ingest and OCR](#document-ingest-and-ocr)
- [Modifying the Feedback Engine](#modifying-the-feedback-engine)
- [Shared Types (`@wren/types`)](#shared-types-wrentypes)
- [Deployment and Testing](#deployment-and-testing)
- [Encryption and KMS Keys](#encryption-and-kms-keys)
- [Troubleshooting and Best Practices](#troubleshooting-and-best-practices)

---

## Modifying Colors and Styles

The SPA uses **Tailwind CSS 4** and a **token-first** theme. Raw hex colors and raw `px` font sizes are forbidden in component `.tsx` files. ESLint rule `wren/no-raw-design-values` fails lint on violations.

**Single source of truth**

1. Edit TypeScript tokens in `frontend/src/styles/tokens/` (`colors.ts`, `typography.ts`, `spacing.ts`, `radii.ts`, `shadows.ts`).
2. Mirror the same values in the Tailwind `@theme` block in `frontend/src/styles/theme.css`.

**Example** (change the primary button fill):

```ts
// frontend/src/styles/tokens/colors.ts
export const palette = {
  // ...
  figmaTextSecondary: '#1a365d', // was #2c2c2c
};
```

```css
/* frontend/src/styles/theme.css — keep in sync with tokens */
@theme {
  --color-accent-primary: #1a365d;
  --color-text-secondary: #1a365d;
}
```

In components, use named utilities only, for example `bg-accent-primary`, `text-text-primary`, `text-body`, `p-lg`, `rounded-md`.

Global imports live in `frontend/src/styles/index.css`. Fonts: **Inter** (UI) and **Source Serif 4** (document body).

---

## Display Name and Branding

Do **not** hardcode `LEON` or `WREN` as a product string in UI or Lambda responses. The display name is configuration.

| Layer | How to change |
| --- | --- |
| Frontend | `VITE_APP_NAME` (see `frontend/.env.example`). Read only via `appConfig.appName` in `frontend/src/config/env.ts`. |
| Amplify | CDK injects `VITE_APP_NAME` from context `appName` (`cdk/lib/stacks/AmplifyStack.ts`). |
| Cognito emails | Use `config.appName` in `cdk/lib/stacks/CognitoStack.ts` (already parameterized). |
| CDK synth | `npx cdk deploy -c appName="My Coach"` — updates SSM `/{stackPrefix}/config/app-name`. |

`scripts/check-app-name.mjs` fails the build if the display-name token appears as a whole quoted string outside `cdk/lib/config.ts`. Resource names stay `wren-*` (`projectName`); only the UI/email label changes.

Document title, landing heading, nav, and “Ask {name}” all use `appConfig.appName`.

---

## Authentication and Authorization

Users sign in with **Amazon Cognito** (email + password, optional MFA). There is no anonymous REST API (except CORS `OPTIONS`). First login provisions an `app_user` with the **Student** role.

**Roles** (database, not Cognito groups on every request):

| Role | Typical access |
| --- | --- |
| `Student` | Own documents, debriefs, Ask LEON, notifications |
| `DepartmentAdmin` | Catalog/config for administered departments |
| `TechnicalAdmin` | Platform config, usage policy, model id, user search, roles |

Bootstrap a Technical Admin by adding the Cognito user to the **`SystemAdmin`** group **before first login**. After that, Postgres is the source of truth. See the [deployment guide](./deployment-guide.md).

Key files:

- `cdk/lib/stacks/CognitoStack.ts` — user pool, SPA client, password policy, `SystemAdmin` group
- `backend/auth/src/authorizer.ts` — JWT verify + identity mapping
- `backend/auth/src/capabilityMatrix.ts` — per-operation allow/deny
- `frontend/src/features/auth/` — Cognito session, token provider
- `frontend/src/App.tsx` — `ProtectedRoute` with `allow={['TechnicalAdmin']}` etc.
- `frontend/src/services/apiClient.ts` — `Authorization: Bearer` on every call

Local UI: `VITE_USE_LIVE_API=false` (default) uses an in-memory mock and **does not** enforce login. Set `true` plus Cognito IDs to hit a deployed API.

---

## Using External Identity Providers (Enterprise SSO)

The pool is currently **native Cognito** (email/password). To add Microsoft Entra ID, Okta, or another OIDC/SAML IdP:

1. In `cdk/lib/stacks/CognitoStack.ts`, add a `CfnUserPoolIdentityProvider` (OIDC or SAML) with issuer, client id/secret, and attribute mapping (`email`, `sub`).
2. Attach the provider to the SPA client (`supportedIdentityProviders`).
3. Register callback URLs on the IdP: Amplify app URL + Cognito hosted-UI / SPA callback.
4. Update `frontend/src/features/auth/cognitoAuthService.ts` to start the federated flow (hosted UI or `signInWithRedirect`) using the provider name you registered.
5. Keep authorization in **Postgres**. Do not grant `TechnicalAdmin` from IdP groups on every request. Optionally map a single bootstrap group the same way `SystemAdmin` is used today (`backend/auth/src/provisionUser.ts`).
6. Redeploy Cognito (and Amplify if callback URLs change).

AWS docs:

- OIDC: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-oidc-idp.html
- SAML: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-saml-idp.html

---

## Extending the API

This API is **spec-first**. Routes are declared in `cdk/lib/openapi.yaml` and deployed by `SpecRestApi` in `cdk/lib/stacks/ApiStack.ts`. Most features attach to an existing Lambda (Document, Feedback, Admin, Audit, Notification).

### Add a route on an existing Lambda

1. Implement the branch in the service handler, for example `backend/admin/src/lambda-handler.ts` (`resource` + `httpMethod`).
2. If the operation is privileged, add a `Capability` in `types/src/authorization.ts` and map it in `backend/auth/src/capabilityMatrix.ts`. Call `requireCapability` before any mutation.
3. Add request/response Zod schemas in `types/` if the payload is a domain DTO. Never add a `replacementProse` field.
4. Add the path/method to `cdk/lib/openapi.yaml` with `x-amazon-apigateway-integration` pointing at the same `Fn::Sub` ARN as sibling routes (`AdminFunctionArn`, `DocumentFunctionArn`, …).
5. Call the API from the SPA only through `frontend/src/services` (`ApiClient`), validating the response with Zod.
6. Redeploy: `npx cdk deploy wren-dev-Api` (and `wren-dev-Compute` if handler code changed).

Example OpenAPI stub:

```yaml
  /v1/my-feature:
    post:
      summary: Example privileged action
      tags: [Admin]
      operationId: myFeature
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name:
                  type: string
      responses:
        "200":
          description: OK
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
      x-amazon-apigateway-integration:
        type: aws_proxy
        httpMethod: POST
        uri:
          Fn::Sub: "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${AdminFunctionArn}/invocations"
```

`ApiStack` injects CORS `OPTIONS` on every path. Keep `security` unset on methods that should use `CognitoAuthorizer` (applied automatically except `OPTIONS`).

### Add a new Lambda

1. Create `backend/<service>/src/lambda-handler.ts`.
2. Register a `NodejsFunction` in `cdk/lib/stacks/ComputeStack.ts` (VPC private subnets, per-role DB secret, timeout/memory). Add a Postgres role in `cdk/lib/appDbRoles.ts` + a migration if the role is new.
3. Pass the function ARN into `ApiStack` and add a substitution in `ApiStack.ts` (`MyFunctionArn`).
4. Reference that placeholder from OpenAPI.
5. Grant `apigateway.amazonaws.com` invoke permission (follow existing `fromFunctionAttributes` pattern in `ApiStack.ts`).

Entry points Compute already bundles:

| Lambda | Source |
| --- | --- |
| Authorizer | `backend/auth/src/authorizer.ts` |
| Document | `backend/document/src/lambda-handler.ts` |
| Admin | `backend/admin/src/lambda-handler.ts` |
| Audit | `backend/admin/src/lambda-audit.ts` |
| Feedback orchestrator | `backend/feedback/src/lambda-handler.ts` |
| Notification | `backend/notification/src/lambda-handler.ts` |
| Feedback Engine | Python container from ECR `{prefix}-feedback-engine:bootstrap` |

---

## Modifying Frontend Components

Layout (`frontend/src/`):

| Path | Role |
| --- | --- |
| `pages/` | Route screens (student, department admin, system admin) |
| `features/` | Feature UI (auth, dashboard, editor, debrief, ask-wren, notifications, …) |
| `components/ui/` | shadcn/Radix primitives |
| `services/` | Shared API client (do not `fetch` around it) |
| `app/` | Providers |
| `config/env.ts` | `VITE_*` config |

### Adding a page

1. Create a page under `frontend/src/pages/…` and export it from `frontend/src/pages/index.ts` (or the existing barrel).
2. Register the route in `frontend/src/App.tsx`. Wrap with `ProtectedRoute` and the right layout.

```tsx
// frontend/src/App.tsx
<Route element={<ProtectedRoute allow={['TechnicalAdmin']} />}>
  <Route element={<SystemAdminLayout />}>
    <Route path="/system-admin/new-feature" element={<NewFeaturePage />} />
  </Route>
</Route>
```

Student chrome: `StudentLayout`. Department: `DepartmentAdminLayout`. Technical Admin: `SystemAdminLayout`. The document editor is a full-viewport route (`/dashboard/document/:documentId`) without the student shell.

### Local vs live API

```bash
cd frontend
cp .env.example .env.local
# VITE_USE_LIVE_API=false  → mock, no login
npm run dev
```

---

## Legal Copy, Disclaimer, and License

There is no shared marketing `Footer.tsx`. Landing copy is `frontend/src/pages/users/LandingPage.tsx`.

**AI disclaimer** must stay in one component: `frontend/src/components/ui/AiDisclaimerNotice.tsx` (`AI_DISCLAIMER_DEFAULT_MESSAGE`). Pass `message=` only for a shorter variant (for example Ask LEON). Do not duplicate the legal paragraph on the dashboard or debrief modal.

**Repository license** is MIT (`license` in the root `package.json` and the README License section). Update those files if the distribution terms change.

---

## Configuring LLM Models

Debrief and Ask LEON call **Amazon Bedrock**. The model id is configuration, not a hardcoded string in orchestration logic.

| Mechanism | Path / API |
| --- | --- |
| CDK default | `DEFAULT_BEDROCK_MODEL_ID` in `cdk/lib/config.ts` (`us.anthropic.claude-sonnet-4-6`) |
| Synth override | `npx cdk deploy … -c bedrockModelId=us.anthropic.claude-…` |
| Runtime SSM | `/{stackPrefix}/config/bedrock-model-id` |
| Admin UI / API | `GET`/`PUT /v1/admin/config/model` (Technical Admin). `modelId` must be on the allowed inference-profile list. |

CLI:

```bash
aws ssm put-parameter \
  --name "/wren-dev/config/bedrock-model-id" \
  --value "us.anthropic.claude-sonnet-4-6" \
  --type String \
  --overwrite \
  --region ca-central-1
```

**Rules when updating:**

- Prefer `us.` cross-region inference profile ids (CRIS). Account Bedrock access must include that model in `ca-central-1` (and related CRIS regions).
- Compute IAM already allows `bedrock:InvokeModel` on `inference-profile/us.anthropic.*`, `us.meta.*`, and corresponding foundation-model ARNs (`crisBedrockInvokeResources` in `ComputeStack.ts`). A new **family** (for example Amazon Titan) needs an IAM update there.
- Feedback Engine also receives `BEDROCK_MODEL_ID` at deploy time; runtime code should prefer SSM / DB (`platform_usage_policy.bedrock_model_id`). After a model change, confirm the engine logs the id you expect.
- Admin prompt fields use a separate Bedrock **Guardrail** (`PROMPT_ATTACK`) from the Config stack. Details: [bedrock-guardrails.md](./bedrock-guardrails.md).

Push a new Feedback Engine image if Python invocation code changes; SSM-only model swaps do not require a new image if the engine reads SSM at runtime.

---

## Database Schema Changes (Migrations)

Migrations are **forward-only numbered `.sql` files** in `backend/database/migrations/`. They are bundled into the Database stack’s migration Lambda and applied on deploy (tracked in `schema_migrations`).

**Do not edit an already-applied file.** Add the next number, for example `0033_my_feature.sql`.

```sql
-- backend/database/migrations/0033_my_feature.sql
CREATE TABLE IF NOT EXISTS my_feature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Invariants (enforced in SQL and `backend/database/schema.test.ts`):

- Drafts are **immutable** (no `UPDATE`; new version = new row).
- No `replacement_prose` column on feedback.
- `activity_event` has **no FK** to documents (survives document delete).

Apply by redeploying Database (`MigrationRunner` copies `backend/database/migrations` into the Lambda). For a one-off against RDS Proxy: `psql` with `sslmode=require` (see migrations README).

If you add a **new app DB role**, update `cdk/lib/appDbRoles.ts`, grant in SQL, and let the password-sync custom resource run.

---

## Usage Limit Management

Lifetime caps are stored in Postgres (`platform_usage_policy`) and enforced in the Admin/Document/Feedback paths. Changing them does **not** require a code deploy.

| Limit | Typical meaning |
| --- | --- |
| `messageLimit` | Ask LEON / user messages |
| `debriefGenerationLimit` | AI Debrief jobs |
| `documentUploadLimit` | Uploads |
| `draftsPerDocumentLimit` | Draft versions per document |

- **Technical Admin UI:** `SystemUsageLimitsForm` (`frontend/src/features/system-admin/components/SystemUsageLimitsForm.tsx`)
- **API:** `GET`/`PUT /v1/admin/config/usage-limits`
- **Overrides:** `POST /v1/overrides` (extra actions for one student + document type, with expiry)

`429` with `USAGE_LIMIT_REACHED` means a cap was hit. See the [API guide](./api-guide.md).

---

## Document Ingest and OCR

There is **no SharePoint Glue crawler**. Writers upload `.docx` / `.pdf` or paste in the editor.

Flow:

1. `POST /v1/uploads/presign` → browser POST to S3 (15-minute URL, KMS fields, content-type lock).
2. `POST /v1/documents` or `POST /v1/documents/{id}/drafts` with `source.kind: file` and `key`.
3. Document Lambda extracts Word or queues PDF work; **Amazon Textract** runs for PDFs that need OCR.
4. Poll `GET /v1/documents/{id}/ingest/status` (`queued` / `processing` / `completed` / `failed`).

Key files:

- `backend/document/src/lambda-handler.ts` — HTTP + presign
- `backend/document/src/ingestWorker.ts` — async ingest
- `backend/document/src/textractOcr.ts` / `pdfToTipTap.ts` — extraction
- S3 lifecycle: tagged orphan uploads expire after 1 day (`StorageResources.ts`)

To support another file type: extend content-type allow-lists in the Document Lambda **and** the presign conditions; add tests. Keep size limits aligned with usage policy.

---

## Modifying the Feedback Engine

Coaching is **Socratic debrief**, not RAG over a knowledge base. Do not add a re-ranker against `document_vectors` unless you are building a new retrieval product; this repo diffs drafts and asks questions.

To change coaching behavior:

| Concern | Where |
| --- | --- |
| System + type prompts | Department Admin type config (`typePromptText`); save-time no-ghostwriting + Bedrock prompt-attack |
| Prompt assembly / untrusted student block | `backend/engine/python/wren_engine/prompt_assembly.py` |
| Output allow-list (no rewrites) | `backend/engine/python/wren_engine/output_guardrail.py` |
| Diff / anchors / progress | `backend/engine/python/` (see engine README) |
| Job enqueue / REST | `backend/feedback/src/lambda-handler.ts` |
| Queue / timeout | `ComputeStack.ts` — engine timeout **15 minutes**, SQS visibility **16 minutes**, `batchSize: 1` |

After Python engine changes:

1. Build and push the image to ECR `{stackPrefix}-feedback-engine` tag `bootstrap` (deployment guide).
2. Update the Lambda (pipeline or `update-function-code`).
3. Confirm Bedrock model access and CloudWatch `/aws/lambda/wren-dev-feedback-engine`.

Realtime completion: AppSync `onDebriefReady`; UI falls back to `GET .../feedback/status` if `VITE_APPSYNC_URL` is unset.

---

## Shared Types (`@wren/types`)

Domain DTOs live in `types/`. Frontend and Lambdas must import from `@wren/types` instead of duplicating shapes.

When you add an entity:

1. Add a **strict** Zod schema in `types/src/`.
2. Export it from `types/src/index.ts`.
3. The compile-time `LacksReplacementProse` guards in `index.ts` must include the new type.
4. Run `npm run -w @wren/types typecheck` and `npx jest types/src`.

---

## Deployment and Testing

**Repo root (workspaces):**

```bash
npm ci
```

**CDK** (from `cdk/` after root `npm ci`):

```bash
npm ci
npx cdk synth
npx cdk deploy wren-dev-Compute wren-dev-Api
# or: npx cdk deploy --all   # ECR bootstrap image must exist first
```

Full first-time order, Bedrock, ECR, Amplify, and first admin: [deployment-guide.md](./deployment-guide.md). Context keys: [cdk/README.md](../cdk/README.md).

**Frontend:**

```bash
cd frontend
npm ci
npm run dev      # Vite
npm run build    # tsc -b && vite build
npm run lint
npm test         # vitest
```

**Python engine (local tests):** see `backend/engine/python/README.md`.

**CI/CD:** CodePipeline + Amplify require GitHub context (`githubOwner` / `githubRepo`). Without those, deploy stacks manually.

---

## Encryption and KMS Keys

| Store | Today | Typical CMK change |
| --- | --- | --- |
| S3 documents + reference | Customer-managed key, rotation on (`StorageResources.ts`) | Already CMK; tighten key policy / aliases if required |
| DynamoDB conversations | Same CMK | Same |
| RDS PostgreSQL | `storageEncrypted: true` (AWS RDS-managed key) | Pass `storageEncryptionKey` on `DatabaseInstance` in `DatabaseResources.ts` (new `Key` or shared storage key), grant the instance role decrypt |
| Secrets Manager | AWS-managed secret encryption unless you set `encryptionKey` | Optional CMK on each `Secret` |
| Presigned uploads | Include `x-amz-server-side-encryption` + key id when `DOCUMENTS_KMS_KEY_ARN` is set | Keep in sync with the bucket key |

Step-by-step CDK property names and IAM grants: [AWS Managed Keys](./aws-managed-keys.md).

Do not turn off `enforceSSL` or `BlockPublicAccess.BLOCK_ALL` on the buckets.

CORS on the **API** is currently `Access-Control-Allow-Origin: *` in `ApiStack.ts`. For production, set `allowedOrigins` to the Amplify domain.

---

## Troubleshooting and Best Practices

- **Lambda timeout:** Document ingest 3 minutes; Feedback Engine 15 minutes; authorizer 20s. Raise `timeout` / `memorySize` in `ComputeStack.ts`. SQS visibility must stay **greater** than the consumer timeout.
- **VPC / DB:** Lambdas use RDS Proxy (`DB_PROXY_HOST`) and per-role secrets (`wren_document`, `wren_admin`, …). Check Secrets Manager `{prefix}/database/...` and security groups (proxy allows VPC CIDR:5432).
- **401:** Expired Cognito token or missing `Authorization`. Refresh the session. Authorizer log group: `/aws/lambda/wren-dev-authorizer`.
- **403:** Role/capability/department scope. Inspect `GET /v1/auth/me`.
- **Debrief never finishes:** Feedback Engine + Bedrock model access; DLQ alarm; queue depth. Poll `/feedback/status` if AppSync is unset.
- **CORS in the browser:** Gateway 401/403 include CORS headers; raw API URL is not behind WAF — use CloudFront for edge rules.
- **Theme lint failures:** Move hex/`px` into `frontend/src/styles/tokens/` and `theme.css`.
- **Display-name CI:** Don’t put `"LEON"` as a quoted product string in new source; use `appConfig` / CDK `appName`.
- **Logging:** CloudWatch is the primary debug surface. Do not log JWTs or full draft bodies.

**API Gateway throttling:** 100 req/s, 200 burst. WAF rate limit (CloudFront): 2000 req / 5 min / IP.
