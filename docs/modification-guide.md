# WREN — Project Modification Guide

This guide tells you what to change and where when you modify WREN: styling and branding, authentication, the API, frontend, application configuration, data and documents, the Feedback Engine, shared types, deployment, and troubleshooting.

It does not cover how to deploy or operate WREN in detail. For that, see the operational documentation linked at the end.

The product display name is **WREN**. AWS resources and this repository use the `wren` prefix.

Related docs:

- [REST API](./api-guide.md)
- [Security overview](./security-overview.md)
- [Deployment guide](./deployment-guide.md)
- [Dependency management](./dependency-management.md)
- [AWS managed keys](./aws-managed-keys.md)
- [Feedback engine](../backend/engine/python/README.md)
- [Database migrations](../backend/database/migrations/README.md)
- [CDK package](../cdk/README.md)

---

## Before You Modify WREN

Work through this before changing anything:

- Decide which layer owns the behavior: frontend, API, database, Feedback Engine, or infrastructure.
- Read the relevant guide linked above before changing deployment or security behavior.
- Prefer a configuration change over a code change when the behavior is already configurable (model id, usage limits, prompts).
- Reuse an existing service boundary instead of creating a duplicate implementation.
- Update shared types in `@wren/types` before changing the consumers.
- Add or update tests for behavior that changes.
- Run the relevant local checks before deploying.
- Do **not** edit an already-applied database migration.
- Do **not** introduce a `replacementProse` field into feedback DTOs or persistence.
- For infrastructure changes, run `npx cdk synth` before deploying.

## Where Should I Look?

| If you need to change… | Start here |
| --- | --- |
| UI styling | `frontend/src/styles/` |
| Product / display name | `frontend/src/config/env.ts`, CDK app config |
| Authentication | `backend/auth/`, `cdk/lib/stacks/CognitoStack.ts` |
| API endpoint (route) | `cdk/lib/openapi.yaml` |
| API business logic | the relevant `backend/<service>/` |
| UI page | `frontend/src/pages/` |
| UI feature | `frontend/src/features/` |
| Database schema | `backend/database/migrations/` |
| Document processing | `backend/document/` |
| Feedback generation | `backend/engine/python/` |
| Feedback API / orchestration | `backend/feedback/` |
| Shared DTOs | `types/` |
| AWS infrastructure | `cdk/lib/stacks/` |
| Model configuration | Admin config / SSM / `cdk/lib/config.ts` |
| Deployment | [deployment-guide.md](./deployment-guide.md) |

Not every change needs a deploy. Use this to avoid rebuilding the whole app for a configuration tweak:

| Change type | Requires a deploy? |
| --- | --- |
| Frontend component | Yes |
| Lambda (Node) code | Yes |
| Database migration | Yes |
| CDK infrastructure | Yes |
| Feedback Engine Python code | New image + Lambda update |
| SSM model setting | No code deploy |
| Usage limits | No code deploy |
| Admin prompt configuration | No code deploy |
| Display name | Depends on the path used (config vs deploy) |

---

## Table of Contents

- [WREN — Project Modification Guide](#wren--project-modification-guide)
  - [Before You Modify WREN](#before-you-modify-wren)
  - [Where Should I Look?](#where-should-i-look)
  - [Table of Contents](#table-of-contents)
  - [1. Styling and Branding](#1-styling-and-branding)
    - [1.1 Colors and styles](#11-colors-and-styles)
    - [1.2 Display name and branding](#12-display-name-and-branding)
  - [2. Authentication and Authorization](#2-authentication-and-authorization)
    - [Bootstrap admin](#bootstrap-admin)
    - [Enterprise SSO](#enterprise-sso)
  - [3. Extending the API](#3-extending-the-api)
    - [3.1 Add a route on an existing Lambda](#31-add-a-route-on-an-existing-lambda)
    - [3.2 Add a new Lambda](#32-add-a-new-lambda)
  - [4. Modifying Frontend Components](#4-modifying-frontend-components)
    - [4.1 Adding a page](#41-adding-a-page)
    - [4.2 Local vs live API](#42-local-vs-live-api)
  - [5. Application Configuration](#5-application-configuration)
    - [5.1 Legal copy, disclaimer, and license](#51-legal-copy-disclaimer-and-license)
    - [5.2 Configuring LLM models](#52-configuring-llm-models)
    - [5.3 Usage limits](#53-usage-limits)
  - [6. Data and Documents](#6-data-and-documents)
    - [6.1 Database schema changes (migrations)](#61-database-schema-changes-migrations)
    - [6.2 Document ingest and OCR](#62-document-ingest-and-ocr)
  - [7. Modifying the Feedback Engine](#7-modifying-the-feedback-engine)
  - [8. Shared Types (`@wren/types`)](#8-shared-types-wrentypes)
  - [9. Deployment and Testing](#9-deployment-and-testing)
  - [10. Encryption](#10-encryption)
  - [11. Troubleshooting](#11-troubleshooting)
  - [12. Related Operational Documentation](#12-related-operational-documentation)

---

## 1. Styling and Branding

### 1.1 Colors and styles

The React web app uses **Tailwind CSS 4** and a **token-first** theme. Raw hex colors and raw `px` font sizes are not allowed in component `.tsx` files; the ESLint rule `wren/no-raw-design-values` fails lint on violations.

The TypeScript token files are the **canonical source** for design values. The Tailwind `@theme` block mirrors those values and must be updated whenever the tokens change:

1. Edit the TypeScript tokens in `frontend/src/styles/tokens/` (`colors.ts`, `typography.ts`, `spacing.ts`, `radii.ts`, `shadows.ts`).
2. Mirror the same values in the Tailwind `@theme` block in `frontend/src/styles/theme.css`.

Example — change the primary button fill:

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

In components, use named utilities only, for example `bg-accent-primary`, `text-text-primary`, `text-body`, `p-lg`, `rounded-md`. Global imports live in `frontend/src/styles/index.css`. Fonts are **Inter** (UI) and **Source Serif 4** (document body).

### 1.2 Display name and branding

The display name is **configuration**, not a hardcoded string. Do **not** hardcode `LEON` or `WREN` as a product string in UI or Lambda responses.

Do not confuse these two values: `appName` controls what users see, while `projectName` controls AWS resource naming.

| Concept | Example | Used for |
| --- | --- | --- |
| Display name | `WREN` | UI text and email copy |
| Project name | `wren` | AWS resource naming (`wren-*`) |
| Environment | `dev` | Environment separation |
| Stack prefix | `wren-dev` | CDK stack and resource grouping |

To change the display name:

| Layer | How to change |
| --- | --- |
| Frontend | `VITE_APP_NAME` (see `frontend/.env.example`). Read only via `appConfig.appName` in `frontend/src/config/env.ts`. |
| Amplify | CDK injects `VITE_APP_NAME` from context `appName` (`cdk/lib/stacks/AmplifyStack.ts`). |
| Cognito emails | Use `config.appName` in `cdk/lib/stacks/CognitoStack.ts`, already parameterized. |
| CDK synth | `npx cdk deploy -c appName="My Coach"` updates SSM `/{stackPrefix}/config/app-name`. |

`scripts/check-app-name.mjs` fails the build if the display-name token appears as a whole quoted string outside `cdk/lib/config.ts`. Resource names stay `wren-*` from `projectName`; only the UI and email label changes. The document title, landing heading, nav, and the "Ask {name}" label all read `appConfig.appName`.

The deploy-time default for `WREN_APP_NAME` is `LEON`, kept for backward compatibility with existing deployments. New deployments should set it to the intended display name. See [Advanced deployment configuration](./deployment-guide.md#advanced-deployment-configuration).

---

## 2. Authentication and Authorization

Users sign in with **Amazon Cognito** (email and password, optional MFA). All REST API methods require Cognito authentication; `OPTIONS` requests are handled separately for CORS. First login provisions an `app_user` with the **Student** role.

Roles are stored in the **database**, not read from Cognito groups on every request.

| Role | Typical access |
| --- | --- |
| `Student` | Own documents, debriefs, Ask WREN, notifications |
| `DepartmentAdmin` | Catalog and config for administered departments |
| `TechnicalAdmin` | Platform config, usage policy, model id, user search, roles |

> **Terminology.** The application role is `TechnicalAdmin`. The frontend refers to this area as **System Admin** (`SystemAdminLayout`, routes under `/system-admin`). They are the same thing.

Key files:

- `cdk/lib/stacks/CognitoStack.ts` — user pool, app client, password policy, `SystemAdmin` group
- `backend/auth/src/authorizer.ts` — JWT verify and identity mapping
- `backend/auth/src/capabilityMatrix.ts` — per-operation allow/deny
- `frontend/src/features/auth/` — Cognito session and token provider
- `frontend/src/App.tsx` — `ProtectedRoute` with `allow={['TechnicalAdmin']}`, etc.
- `frontend/src/services/apiClient.ts` — attaches `Authorization: Bearer` on every call

Local UI uses `VITE_USE_LIVE_API=false` (the default), which runs an in-memory mock and **does not** enforce login. Set it to `true` plus Cognito IDs to hit a deployed API.

### Bootstrap admin

There is no Technical Admin until you create one. Add the intended Cognito user to the **`SystemAdmin`** group **before** their first login. After that first login, **Postgres** becomes the source of truth for roles. See the [deployment guide](./deployment-guide.md).

### Enterprise SSO

The pool is currently **native Cognito** (email and password). To add Microsoft Entra ID, Okta, or another OIDC/SAML IdP:

1. In `cdk/lib/stacks/CognitoStack.ts`, add a `CfnUserPoolIdentityProvider` (OIDC or SAML) with issuer, client id/secret, and attribute mapping for `email` and `sub`.
2. Attach the provider to the Cognito app client (`supportedIdentityProviders`).
3. Register callback URLs on the IdP: the Amplify app URL plus the Cognito hosted-UI or web-app callback.
4. Update `frontend/src/features/auth/cognitoAuthService.ts` to start the federated flow (hosted UI or `signInWithRedirect`) using the provider name you registered.
5. Keep authorization in **Postgres**. Do not grant `TechnicalAdmin` from IdP groups on every request. Optionally map a single bootstrap group the same way `SystemAdmin` is used today (`backend/auth/src/provisionUser.ts`).
6. Redeploy Cognito, and Amplify if callback URLs change.

AWS docs:

- OIDC: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-oidc-idp.html
- SAML: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-saml-idp.html

---

## 3. Extending the API

The API is **spec-first**. Routes are declared in `cdk/lib/openapi.yaml` and deployed by `SpecRestApi` in `cdk/lib/stacks/ApiStack.ts`. Most features attach to an existing Lambda (Document, Feedback, Admin, Audit, Notification).

**Which approach should I use?**

- Add a route to an **existing Lambda** when the operation belongs to an existing service boundary such as Document, Admin, Feedback, or Notification.
- Create a **new Lambda** when the operation introduces a distinct execution boundary, permissions model, runtime, scaling requirement, or failure domain.
- Do **not** create a new Lambda solely to avoid adding another route to an existing service.

> **Authentication default.** API methods are authenticated by default. `ApiStack` applies `CognitoAuthorizer` automatically to every method except `OPTIONS`; do not add a `security` block merely to enable Cognito auth. If a route must be unauthenticated, follow the existing `security: []` exception pattern in `ApiStack.ts` (the same one used for CORS `OPTIONS`) — removing `security` does not make a route public. Verify any new route's authorization behavior before deployment.

### 3.1 Add a route on an existing Lambda

1. Implement the branch in the service handler, for example `backend/admin/src/lambda-handler.ts`, matching on `resource` and `httpMethod`.
2. If the operation is privileged, add a `Capability` in `types/src/authorization.ts` and map it in `backend/auth/src/capabilityMatrix.ts`. Call `requireCapability` before any mutation.
3. Add request/response Zod schemas in `types/` if the payload is a domain DTO. **Never** add a `replacementProse` field.
4. Add the path and method to `cdk/lib/openapi.yaml` with `x-amazon-apigateway-integration` pointing at the same `Fn::Sub` ARN as sibling routes (`AdminFunctionArn`, `DocumentFunctionArn`, and so on).
5. Call the API from the React web app only through `frontend/src/services` (`ApiClient`), validating the response with Zod.
6. Redeploy: `npx cdk deploy wren-dev-Api`, and `wren-dev-Compute` if handler code changed.

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

`ApiStack` injects the CORS `OPTIONS` method on every path and applies `CognitoAuthorizer` to every other method (see the authentication-default note above).

**Change → Test → Deploy → Verify** for a new route:

- **Change:** handler branch, capability, types, OpenAPI path, frontend service method.
- **Test:** unit test the handler; validate the client response with Zod; add an authorization test if the route is privileged.
- **Deploy:** `wren-dev-Api`, plus `wren-dev-Compute` if handler code changed.
- **Verify:** an authenticated request succeeds, the expected `401`/`403` behavior holds, and the response shape matches the schema.

**Do not** in the API layer:

- Do not call `fetch` directly from feature components; go through the shared `ApiClient`.
- Do not duplicate DTO definitions; import from `@wren/types`.
- Do not bypass `requireCapability` for privileged mutations.

### 3.2 Add a new Lambda

1. Create `backend/<service>/src/lambda-handler.ts`.
2. Register a `NodejsFunction` in `cdk/lib/stacks/ComputeStack.ts` (VPC private subnets, per-role DB secret, timeout, memory). If the Lambda needs database access, add or reuse the appropriate Postgres role in `cdk/lib/appDbRoles.ts`; create a migration if the role or its grants are new.
3. Pass the function ARN into `ApiStack` and add a substitution in `ApiStack.ts` (`MyFunctionArn`).
4. Reference that placeholder from OpenAPI.
5. Grant `apigateway.amazonaws.com` invoke permission, following the existing `fromFunctionAttributes` pattern in `ApiStack.ts`.

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

## 4. Modifying Frontend Components

Layout under `frontend/src/`:

| Path | Role |
| --- | --- |
| `pages/` | Route screens for student, department admin, and system admin |
| `features/` | Feature UI: auth, dashboard, editor, debrief, ask-wren, notifications, and so on |
| `components/ui/` | shadcn/Radix primitives |
| `services/` | Shared API client; do **not** `fetch` around it |
| `app/` | Providers |
| `config/env.ts` | `VITE_*` config |

### 4.1 Adding a page

1. Create a page under `frontend/src/pages/` and export it from `frontend/src/pages/index.ts` or the existing barrel.
2. Register the route in `frontend/src/App.tsx`, wrapped with `ProtectedRoute` and the right layout.

```tsx
// frontend/src/App.tsx
<Route element={<ProtectedRoute allow={['TechnicalAdmin']} />}>
  <Route element={<SystemAdminLayout />}>
    <Route path="/system-admin/new-feature" element={<NewFeaturePage />} />
  </Route>
</Route>
```

Layouts by area: `StudentLayout` for students, `DepartmentAdminLayout` for department admins, and `SystemAdminLayout` for Technical Admins. The document editor is a full-viewport route (`/dashboard/document/:documentId`) without the student shell.

### 4.2 Local vs live API

```bash
cd frontend
cp .env.example .env.local
# VITE_USE_LIVE_API=false → mock, no login
npm run dev
```

**Do not** in the frontend:

- Do not hardcode product names; use `appConfig.appName`.
- Do not introduce raw design values (hex colors, raw `px`); use tokens.
- Do not bypass the shared API client.

---

## 5. Application Configuration

### 5.1 Legal copy, disclaimer, and license

There is no shared marketing `Footer.tsx`. Landing copy lives in `frontend/src/pages/users/LandingPage.tsx`.

The AI disclaimer must stay in one component: `frontend/src/components/ui/AiDisclaimerNotice.tsx` (`AI_DISCLAIMER_DEFAULT_MESSAGE`). Pass `message=` only for a shorter variant, for example "Ask WREN". Do not duplicate the legal paragraph on the dashboard or debrief modal.

The repository license is MIT (the `license` field in the root `package.json` and the README License section). Update both files if the distribution terms change.

### 5.2 Configuring LLM models

Debrief and Ask WREN call **Amazon Bedrock**. The model id is **configuration**, not a hardcoded string in orchestration logic.

**Recommended:** change the model through the Technical Admin configuration/API when possible. The other mechanisms exist for deployment and recovery paths.

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
  --region <your-data-plane-region>
```

When changing the model:

- Prefer cross-region inference profile ids when your account uses them. Enable the model in the **data-plane Region**, and in any other Regions the profile requires.
- Compute IAM already allows `bedrock:InvokeModel` on `inference-profile/us.anthropic.*`, `us.meta.*`, and the corresponding foundation-model ARNs (`crisBedrockInvokeResources` in `ComputeStack.ts`). A new model **family** such as Amazon Titan needs an IAM update there.

The Feedback Engine also receives `BEDROCK_MODEL_ID` at deploy time, but runtime code resolves the model in this precedence order:

1. `platform_usage_policy.bedrock_model_id` in the database
2. SSM parameter `/{stackPrefix}/config/bedrock-model-id`
3. The `BEDROCK_MODEL_ID` environment variable set at deploy time
4. The CDK deployment default

After a model change, confirm the resolved model id in the Feedback Engine CloudWatch logs (`/aws/lambda/wren-dev-feedback-engine`) before treating the change as complete. Admin prompt fields use a separate Bedrock Guardrail (`PROMPT_ATTACK`) from the Config stack; see [bedrock-guardrails.md](./bedrock-guardrails.md).

Push a new Feedback Engine image if Python invocation code changes. SSM-only model swaps do not require a new image, since the engine reads SSM at runtime.

### 5.3 Usage limits

Lifetime caps are stored in **Postgres** (`platform_usage_policy`) and enforced in the Admin, Document, and Feedback paths. Changing them does **not** require a code deploy.

| Limit | Typical meaning |
| --- | --- |
| `messageLimit` | Ask WREN / user messages |
| `debriefGenerationLimit` | AI Debrief jobs |
| `documentUploadLimit` | Uploads |
| `draftsPerDocumentLimit` | Draft versions per document |

- Technical Admin UI: `SystemUsageLimitsForm` (`frontend/src/features/system-admin/components/SystemUsageLimitsForm.tsx`)
- API: `GET`/`PUT /v1/admin/config/usage-limits`
- Overrides: `POST /v1/overrides` grants extra actions for one student and document type, with an expiry.

A `429` with `USAGE_LIMIT_REACHED` means a cap was hit. See the [API guide](./api-guide.md).

---

## 6. Data and Documents

### 6.1 Database schema changes (migrations)

Migrations are **forward-only**, numbered `.sql` files in `backend/database/migrations/`. They are bundled into the Database stack's migration Lambda and applied on deploy, tracked in `schema_migrations`.

The schema currently ships as a single consolidated baseline, `0001_baseline.sql`. While the project is still pre-release, schema changes are folded back into that baseline rather than added as separate numbered files, so it stays the one source of the current schema.

```sql
-- backend/database/migrations/0001_baseline.sql — add to the baseline
CREATE TABLE IF NOT EXISTS my_feature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

> **Once the baseline has been applied to a shared or production environment, stop editing it.** From that point, schema changes must be new forward-only files (`0002_…`, `0003_…`); never edit an already-applied migration.

Invariants, enforced in SQL and `backend/database/schema.test.ts`:

- Drafts are **immutable**. There is no `UPDATE`; a new version is a new row.
- There is **no** `replacement_prose` column on feedback.
- `activity_event` has **no foreign key** to documents, so it survives a document delete.

Apply migrations by redeploying Database; `MigrationRunner` copies `backend/database/migrations` into the Lambda. For a one-off against RDS Proxy, use `psql` with `sslmode=require` (see the migrations README).

If you add a new app DB role, update `cdk/lib/appDbRoles.ts`, grant it in SQL, and let the password-sync custom resource run.

**Do not** in the database layer:

- Do not edit an applied migration.
- Do not modify immutable draft rows.
- Do not bypass the migration runner for normal schema changes.

### 6.2 Document ingest and OCR

Writers upload `.docx` or `.pdf`, or paste into the editor.

Flow:

1. `POST /v1/uploads/presign` returns a 15-minute pre-signed URL with KMS fields and a content-type lock; the browser POSTs directly to S3.
2. `POST /v1/documents` or `POST /v1/documents/{id}/drafts` with `source.kind: file` and `key`.
3. The Document Lambda extracts Word content directly. PDF work is queued to the ingest worker, which routes **all** PDFs through **Amazon Textract** (`AnalyzeDocument` for single-page or image input; async `StartDocumentAnalysis` for multi-page PDFs in S3). There is no separate digital-text path today — the Tesseract/LiteParse engines were removed, and `resolveOcrEngine` always returns `textract`.
4. Poll `GET /v1/documents/{id}/ingest/status` for `queued`, `processing`, `completed`, or `failed`.

Key files:

- `backend/document/src/lambda-handler.ts` — HTTP and presign
- `backend/document/src/ingestWorker.ts` — async ingest
- `backend/document/src/textractOcr.ts` and `pdfToTipTap.ts` — extraction
- S3 lifecycle: tagged orphan uploads expire after 1 day (`StorageResources.ts`)

To support another file type, extend the content-type allow-lists in the Document Lambda **and** the presign conditions, and add tests. Keep size limits aligned with the usage policy.

---

## 7. Modifying the Feedback Engine

The Feedback Engine is **not a RAG system**. It compares drafts and generates **Socratic** questions. Do not add retrieval or a re-ranker against `document_vectors` unless the feature explicitly requires it.

`document_vectors` is **not** part of the current Feedback Engine request path. Its presence in the database does not mean the engine should retrieve from it.

To change coaching behavior:

| Concern | Where |
| --- | --- |
| System and type prompts | Department Admin type config (`typePromptText`); save-time no-ghostwriting and Bedrock prompt-attack checks |
| Prompt assembly and untrusted student block | `backend/engine/python/wren_engine/prompt_assembly.py` |
| Output allow-list (no rewrites) | `backend/engine/python/wren_engine/output_guardrail.py` |
| Diff, anchors, progress | `backend/engine/python/` (see engine README) |
| Job enqueue and REST | `backend/feedback/src/lambda-handler.ts` |
| Queue and timeout | `ComputeStack.ts`: engine timeout 15 minutes, SQS visibility 16 minutes, `batchSize: 1` |

After Python engine changes:

1. Build and push the image to ECR `{stackPrefix}-feedback-engine` tag `bootstrap` (see the deployment guide).
2. Update the Lambda through the pipeline or `update-function-code`.
3. Confirm Bedrock model access and check CloudWatch `/aws/lambda/wren-dev-feedback-engine`.

Realtime completion uses AppSync `onDebriefReady`. The UI falls back to `GET .../feedback/status` if `VITE_APPSYNC_URL` is unset.

**Do not** in the Feedback Engine:

- Do not generate replacement prose.
- Do not treat student-authored content as trusted instructions.
- Do not add retrieval merely because embeddings exist.

---

## 8. Shared Types (`@wren/types`)

Domain DTOs live in `types/`. Frontend and Lambdas **must** import from `@wren/types` rather than duplicating shapes.

When you add an entity:

1. Add a **strict** Zod schema in `types/src/`.
2. Export it from `types/src/index.ts`.
3. Add the new type to the compile-time `LacksReplacementProse` guards in `index.ts`.
4. Run `npm run -w @wren/types typecheck` and `npx jest types/src`.

---

## 9. Deployment and Testing

Repo root (workspaces):

```bash
npm ci
```

CDK (from `cdk/` after root `npm ci`). These commands are examples for an already-initialized development environment. For dependency ordering, first deployment, or infrastructure changes, use the [deployment guide](./deployment-guide.md).

> **Important:** `npx cdk deploy --all` requires the Feedback Engine bootstrap image to already exist in ECR.

```bash
npm ci
npx cdk synth
npx cdk deploy wren-dev-Compute wren-dev-Api
# or, once the ECR bootstrap image exists:
npx cdk deploy --all
```

Frontend:

```bash
cd frontend
npm ci
npm run dev      # Vite
npm run build    # tsc -b && vite build
npm run lint
npm test         # vitest
```

Python engine local tests: see `backend/engine/python/README.md`.

For the full first-time deployment order, Bedrock and ECR setup, Amplify, the first-admin flow, and all advanced deployment variables, see the [deployment guide](./deployment-guide.md). Context keys are documented in the [CDK README](../cdk/README.md).

---

## 10. Encryption

Storage uses a **customer-managed KMS key** with rotation enabled (`StorageResources.ts`), covering the documents and reference S3 buckets and the DynamoDB conversation table. RDS and Secrets Manager use **AWS-managed keys** unless you explicitly configure a CMK. Presigned uploads include `x-amz-server-side-encryption` and the key id when `DOCUMENTS_KMS_KEY_ARN` is set; keep this in sync with the bucket key.

For CDK property names, IAM grants, and the step-by-step CMK changes for each store, see [AWS Managed Keys](./aws-managed-keys.md).

> **Do not** turn off `enforceSSL` or `BlockPublicAccess.BLOCK_ALL` on the buckets.

> **CORS.** API Gateway OPTIONS and Lambda responses echo `Access-Control-Allow-Origin` for local Vite, the configured `customDomain` (plus `www`), extra `-c corsAllowedOrigins=...` values, and Amplify default hosts — not `*`. The documents bucket CORS list is the same exact origins plus `https://*.amplifyapp.com` (S3 cannot use a regex). The reference bucket has no CORS: admin uploads go through the Admin Lambda, not a browser presign.

---

## 11. Troubleshooting

- **Lambda timeout:** document ingest 3 minutes, Feedback Engine 15 minutes, authorizer 20 seconds. Raise `timeout` or `memorySize` in `ComputeStack.ts`. SQS visibility must stay **greater** than the consumer timeout.
- **VPC / DB:** Lambdas use RDS Proxy (`DB_PROXY_HOST`) and per-role secrets (`wren_document`, `wren_admin`, and so on). Check Secrets Manager `{prefix}/database/...` and the security groups; the proxy allows the VPC CIDR on port 5432.
- **401:** expired Cognito token or missing `Authorization`. Refresh the session. Authorizer log group: `/aws/lambda/wren-dev-authorizer`.
- **403:** role, capability, or department scope. Inspect `GET /v1/auth/me`.
- **Debrief never finishes:** check Feedback Engine and Bedrock model access, the DLQ alarm, and queue depth. Poll `/feedback/status` if AppSync is unset.
- **CORS / edge protection:** API Gateway responses include CORS headers. WAF rules apply at the CloudFront edge; do not assume the direct API Gateway URL receives the same edge protections.
- **Theme lint failures:** move hex or `px` values into `frontend/src/styles/tokens/` and `theme.css`.
- **Display-name CI:** do not put `"WREN"` as a quoted product string in new source; use `appConfig` or the CDK `appName`.
- **Logging:** CloudWatch is the primary debug surface. Do not log JWTs or full draft bodies.

**API Gateway throttling:** 100 req/s, 200 burst. **WAF rate limit** (CloudFront): 2000 requests per 5 minutes per IP.

---

## 12. Related Operational Documentation

This guide covers how to modify WREN. For how to deploy and operate it, see:

- [Deployment guide](./deployment-guide.md) — first-time deployment, first-admin flow, [advanced deployment configuration](./deployment-guide.md#advanced-deployment-configuration), and [monitoring and operational ownership](./deployment-guide.md#monitoring-and-operational-ownership).
- [AWS managed keys](./aws-managed-keys.md) — full encryption architecture and CMK changes.
- [Security overview](./security-overview.md) — security model and controls.
