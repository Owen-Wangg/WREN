# LEON REST API Documentation

This document provides comprehensive documentation for the LEON (WREN) REST API, including endpoint descriptions, authentication requirements, request/response formats, and example usage.

The product display name is **LEON**. AWS resources, CDK stacks, and this repository use the project prefix **WREN**. The contract used to deploy API Gateway lives in [`cdk/lib/openapi.yaml`](../cdk/lib/openapi.yaml). Shared Zod/TypeScript DTOs live in [`types/`](../types/README.md).

## Table of Contents

- [Authentication](#authentication)
- [Base URL](#base-url)
- [Common Headers](#common-headers)
- [Error Responses](#error-responses)
- [Auth Endpoints](#auth-endpoints)
- [Document Endpoints](#document-endpoints)
- [Feedback Endpoints](#feedback-endpoints)
- [Ask LEON Endpoints](#ask-leon-endpoints)
- [Department Endpoints](#department-endpoints)
- [Document Type Endpoints](#document-type-endpoints)
- [User and Role Endpoints](#user-and-role-endpoints)
- [Usage Endpoints](#usage-endpoints)
- [Analytics Endpoints](#analytics-endpoints)
- [Notification Endpoints](#notification-endpoints)
- [Admin Config Endpoints](#admin-config-endpoints)
- [Security Considerations](#security-considerations)
- [AppSync Realtime](#appsync-realtime)
- [Troubleshooting](#troubleshooting)

## Authentication

All REST endpoints require authentication except CORS `OPTIONS` preflight. The SPA signs in through Amazon Cognito and sends a JWT in the `Authorization` header.

Authorization is enforced in two layers:

1. **Lambda authorizer** (coarse) — verifies the Cognito JWT (signature, issuer, expiry), maps `sub` to an application user in PostgreSQL, and attaches roles, administered department IDs, and access grants to the request context. First login provisions an `app_user` with the default **Student** role. Cognito groups are used only during that first-login bootstrap; the database is the source of truth afterward.
2. **Service Lambdas** (fine-grained) — each handler re-checks the requested capability against the actor using the capability matrix. A cached authorizer Allow does not grant a privileged operation.

The authorizer result is cached for **30 seconds**. Downstream services parse `requestContext.authorizer` (`userId`, `email`, `roles`, `administeredDepartmentIds`, `grants`).

---

### Obtaining a Token

The frontend uses the Cognito access token as `Authorization: Bearer {token}`. The authorizer prefers access tokens and falls back to ID tokens.

```javascript
// JavaScript example using amazon-cognito-identity-js (as the SPA does)
const session = await authService.getSession(); // or CognitoUser.getSession
const token = session.getAccessToken().getJwtToken();
```

```javascript
// AWS Amplify equivalent
import { fetchAuthSession } from "aws-amplify/auth";

const session = await fetchAuthSession();
const token = session.tokens?.accessToken?.toString();
```

---

### Roles

There is no implicit role hierarchy. Authority is the explicit capability matrix only.

| Role | Typical access |
| --- | --- |
| `Student` | Own documents, drafts, debriefs, Ask LEON, ratings, notifications, list of own access grants |
| `DepartmentAdmin` | Catalog and config for administered departments, department user lists, usage overrides, scoped analytics |
| `TechnicalAdmin` | Platform operations: departments, usage policy, Bedrock model, user search, role assignment, notification types, platform analytics |

A user may hold more than one role. An operation is allowed if any held role authorizes it in the requested scope.

`DepartmentAdmin` operations are limited to departments in `administeredDepartmentIds`. `TechnicalAdmin` is **not** a superuser for educational content (topics and access grants remain department-scoped).

## Base URL

API Gateway stage URL (CDK output `ApiEndpoint`):

```
https://{api-id}.execute-api.{region}.amazonaws.com/{stage}
```

Default data-plane region is `ca-central-1`. Default stage is the environment name (typically `dev`, not `prod`).

Replace `{api-id}`, `{region}`, and `{stage}` with values from the AWS Console or:

```bash
aws cloudformation describe-stacks --stack-name wren-dev-Api --region ca-central-1 --query "Stacks[0].Outputs"
```

CloudFront (`DistributionDomainName` from `wren-dev-CloudFrontWaf` in `us-east-1`) fronts the API as an alternate hostname. The SPA’s `VITE_API_BASE_URL` is normally the API Gateway stage URL.

All REST paths are under `/v1`.

## Common Headers

```
Authorization: Bearer {cognito-access-token}
Content-Type: application/json
Accept: application/json
```

The authorizer also accepts a raw JWT without the `Bearer ` prefix.

API Gateway throttling: **100** requests/second sustained, **200** burst.

## Error Responses

### Standard Error Format

```json
{ "code": "PERMISSION_DENIED", "message": "Error message description" }
```

Common `code` values:

| Code | Typical HTTP status |
| --- | --- |
| `UNAUTHORIZED` | 401 |
| `PERMISSION_DENIED` | 403 |
| `NOT_FOUND` | 404 |
| `BAD_REQUEST` | 400 |
| `CONFLICT` | 409 |
| `USAGE_LIMIT_REACHED` | 429 |
| `PROMPT_INJECTION_DETECTED` | 400 |
| `GHOSTWRITING_DETECTED` | 400 |
| `INTERNAL_ERROR` | 500 |

Feedback items never include replacement prose. Payloads that carry a `replacementProse` field are rejected (`GHOSTWRITING_DETECTED`).

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `202` - Accepted (async job queued)
- `204` - No Content
- `400` - Bad Request
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient role or department scope)
- `404` - Not Found
- `409` - Conflict
- `429` - Usage limit reached
- `500` - Internal Server Error

---

# Auth Endpoints

These endpoints require a valid Cognito token.

## Get Current User

Return the authenticated application identity and database-backed roles.

**Endpoint:** `GET /v1/auth/me`

**Response:** `200 OK`

```json
{
  "userId": "uuid",
  "email": "student@example.com",
  "roles": ["Student"],
  "administeredDepartmentIds": []
}
```

**Parameters (response):**

- `userId` (string): Application user UUID (not the Cognito `sub`)
- `email` (string): Email from the app database
- `roles` (array): `Student`, `DepartmentAdmin`, and/or `TechnicalAdmin`
- `administeredDepartmentIds` (array): Department UUIDs if the user is a Department Admin

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/auth/me" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

# Document Endpoints

These endpoints operate on documents owned by the authenticated student (ownership is checked in the Document Lambda).

## List Documents

List the caller’s documents.

**Endpoint:** `GET /v1/documents`

**Query Parameters:**

- `status` (string, optional): `Still Drafting` or `Polishing`
- `limit` (integer, optional): Default `20`
- `offset` (integer, optional): Default `0`

**Response:** `200 OK`

```json
{
  "items": [
    {
      "id": "uuid",
      "ownerUserId": "uuid",
      "documentTypeId": "uuid",
      "contentTypeId": "uuid",
      "name": "Memo draft",
      "metadata": { "Writing Topic": "Contracts" },
      "status": "Still Drafting",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "total": 1
}
```

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents?limit=20&offset=0" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Create Document

Create a document from a pasted text, TipTap JSON, or a previously uploaded file key.

**Endpoint:** `POST /v1/documents`

**Request Body:**

```json
{
  "documentTypeId": "uuid",
  "contentTypeId": "uuid",
  "name": "Memo draft",
  "metadata": { "Writing Topic": "Contracts" },
  "source": { "kind": "paste", "text": "Student draft text..." },
  "content": { "type": "doc", "content": [] }
}
```

**Parameters:**

- `documentTypeId` (string, required): Document type UUID
- `name` (string, required): Document name
- `source` (object, required): `kind` is `file` or `paste`. For paste, include `text`. For file, include `key` from [Get Upload URL](#get-upload-url)
- `contentTypeId` (string, optional): Content type UUID
- `metadata` (object, optional): Custom field values as string map
- `content` (object, optional): TipTap `JSONContent` (`type: "doc"`) so rich formatting is stored on the first draft

LOCKED document types require an active access grant. PDF uploads may return ingest fields (`ingestStatus`, `ingestJobId`) instead of a fully extracted draft.

**Response:** `200 OK` with a document object

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"documentTypeId":"uuid","name":"Memo draft","source":{"kind":"paste","text":"Hello"}}'
```

---

## Get Document

Get a document with its drafts.

**Endpoint:** `GET /v1/documents/{documentId}`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Response:** `200 OK` with document object

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Delete Document

Delete a document owned by the authenticated student, including drafts and feedback.

**Endpoint:** `DELETE /v1/documents/{documentId}`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Response:** `200 OK`

```json
{
  "documentId": "uuid",
  "deletedDrafts": 3,
  "deletedFeedbackItems": 12
}
```

**Example (cURL):**

```bash
curl -X DELETE "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Get Ingest Status

Poll async PDF ingest (Textract) for a document.

**Endpoint:** `GET /v1/documents/{documentId}/ingest/status`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Response:** `200 OK`

```json
{
  "status": "processing",
  "jobId": "string",
  "draftId": "uuid",
  "errorMessage": "string"
}
```

`status` is one of `pending`, `queued`, `processing`, `completed`, `failed`.

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/ingest/status" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Get Latest Draft

**Endpoint:** `GET /v1/documents/{documentId}/drafts`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Response:** `200 OK` with a draft object (`id`, `documentId`, `versionNumber`, `s3Key`, `segments`, `wordCount`, `createdAt`, optional TipTap `content`)

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/drafts" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Create Draft Version

Create a new immutable draft version. Provide TipTap `content`, `segments`, and/or `source` (file re-upload or paste). When `content` is present, the server derives segments from it. When both `source` and `segments` are present without `content`, `source` wins.

**Endpoint:** `POST /v1/documents/{documentId}/drafts`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Request Body:**

```json
{
  "content": { "type": "doc", "content": [] },
  "segments": [{ "index": 0, "text": "Paragraph one." }],
  "source": { "kind": "paste", "text": "..." }
}
```

**Response:**

- `201 Created` — draft object
- `202 Accepted` — PDF ingest queued

```json
{
  "ingestStatus": "queued",
  "jobId": "string",
  "documentId": "uuid"
}
```

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/drafts" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"content":{"type":"doc","content":[]}}'
```

---

## Autosave Current Draft

Patch TipTap content onto the current draft without creating a new version.

**Endpoint:** `PATCH /v1/documents/{documentId}/drafts/current`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Request Body:**

```json
{
  "content": { "type": "doc", "content": [] }
}
```

**Parameters:**

- `content` (object, required): TipTap `JSONContent`

**Response:** `200 OK` with updated draft

**Example (cURL):**

```bash
curl -X PATCH "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/drafts/current" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"content":{"type":"doc","content":[]}}'
```

---

## Get Upload URL

Get a presigned S3 POST for `.docx` or `.pdf` upload. Use the returned `key` as `source.key` when creating a document or draft.

**Endpoint:** `POST /v1/uploads/presign`

**Request Body:**

```json
{
  "filename": "essay.docx",
  "contentType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
}
```

**Parameters:**

- `filename` (string, required)
- `contentType` (string, required)

**Response:** `200 OK`

```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "fields": { "key": "documents/user-id/uploads/...", "Policy": "..." },
  "key": "documents/user-id/uploads/uuid-essay.docx"
}
```

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/uploads/presign" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"filename":"essay.docx","contentType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}'
```

POST the file to `uploadUrl` as `multipart/form-data` using `fields`, then create the document with `"source": { "kind": "file", "key": "<key>" }`.

---

## List Access Grants

List the authenticated user’s active access grants (needed for LOCKED document types).

**Endpoint:** `GET /v1/access-grants`

**Response:** `200 OK` with an array of grant objects (`id`, `userId`, `documentTypeId`, `grantedBy`, `grantedAt`, `revokedAt`)

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/access-grants" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

# Feedback Endpoints

AI Debrief is asynchronous: enqueue a job, then poll status or subscribe via AppSync. Feedback items are Socratic questions — never rewrites.

## Get Feedback

Get feedback items and anchors for a draft (defaults to latest).

**Endpoint:** `GET /v1/documents/{documentId}/feedback`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Query Parameters:**

- `draftId` (uuid, optional): Historical debrief generation

**Response:** `200 OK`

```json
{
  "items": [
    {
      "id": "uuid",
      "documentId": "uuid",
      "errorCategoryId": "uuid",
      "kind": "inline",
      "questionText": "What would change if a reader could not see this paragraph?",
      "quotedText": "the clause",
      "currentAnchorId": "uuid",
      "sourceDraftId": "uuid",
      "createdAt": "2024-01-20T14:22:00.000Z"
    }
  ],
  "anchors": [],
  "progressSummary": [],
  "draftId": "uuid"
}
```

`kind` is `inline` or `structural`. Anchor `state` is `active` or `removed`. Resolution status on progress is `resolved`, `partially_resolved`, `still_unresolved`, `removed`, or `unchanged`.

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/feedback?draftId=uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Request Feedback

Enqueue debrief generation for the current draft. Subject to lifetime usage policy (`USAGE_LIMIT_REACHED` → `429`).

**Endpoint:** `POST /v1/documents/{documentId}/feedback`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Request Body:** optional empty object

**Response:** `202 Accepted`

```json
{
  "jobId": "string",
  "status": "queued"
}
```

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/feedback" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Get Feedback History

List past AI Debrief generations for a document (newest first).

**Endpoint:** `GET /v1/documents/{documentId}/feedback/history`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Response:** `200 OK`

```json
{
  "versions": [
    {
      "draftId": "uuid",
      "draftVersion": 2,
      "generatedAt": "2024-01-20T14:22:00.000Z",
      "itemCount": 8
    }
  ]
}
```

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/feedback/history" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Get Feedback Status

Poll generation status (UI fallback when AppSync is unavailable).

**Endpoint:** `GET /v1/documents/{documentId}/feedback/status`

**Path Parameters:**

- `documentId` (string, required): Document UUID

**Response:** `200 OK`

```json
{
  "status": "completed",
  "itemCount": 8
}
```

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/feedback/status" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Record Helpfulness Rating

Record a student’s helpful/not-helpful rating for a debrief. Stored anonymously (no `user_id`) for admin analytics.

**Endpoint:** `POST /v1/feedback-helpfulness`

**Request Body:**

```json
{
  "environmentId": "uuid",
  "draftId": "uuid",
  "helpful": false,
  "comment": "The questions did not match this assignment."
}
```

**Parameters:**

- `environmentId` (uuid, required): Document ID
- `helpful` (boolean, required)
- `draftId` (uuid, optional): Draft the debrief was generated against
- `comment` (string, optional): Max 1000 characters

**Response:** `200 OK` — `{ "recorded": true }`

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/feedback-helpfulness" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"environmentId":"uuid","helpful":true}'
```

---

## Get Section Applicability Votes

Fetch the owning student’s per-section applicable/not-applicable votes.

**Endpoint:** `GET /v1/feedback-section-applicability`

**Query Parameters:**

- `environmentId` (uuid, required): Document ID
- `draftId` (uuid, required): Draft ID

**Response:** `200 OK`

```json
{
  "votes": {
    "error-category-uuid": true
  }
}
```

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/feedback-section-applicability?environmentId=uuid&draftId=uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Record Section Applicability Vote

Upsert a vote for one error-category section. Toggling replaces the previous vote. Stored anonymously.

**Endpoint:** `POST /v1/feedback-section-applicability`

**Request Body:**

```json
{
  "environmentId": "uuid",
  "draftId": "uuid",
  "errorCategoryId": "uuid",
  "applicable": false
}
```

**Response:** `200 OK` — `{ "recorded": true }`

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/feedback-section-applicability" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"environmentId":"uuid","draftId":"uuid","errorCategoryId":"uuid","applicable":true}'
```

---

# Ask LEON Endpoints

Conversations are anchored to a document + draft (DynamoDB). Replies are Socratic, not rewrites. The product UI label is Ask LEON; the path is `/ask-wren`.

## Get Conversation

**Endpoint:** `GET /v1/documents/{documentId}/ask-wren`

**Path Parameters:**

- `documentId` (uuid, required)

**Query Parameters:**

- `draftId` (string, required)

**Response:** `200 OK`

```json
{
  "sessionId": "string",
  "documentId": "uuid",
  "draftId": "uuid",
  "messages": [
    {
      "id": "string",
      "role": "user",
      "text": "Can you explain the citation comment?",
      "createdAt": "2024-01-20T14:22:00.000Z"
    }
  ]
}
```

`role` is `user` or `wren`.

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/ask-wren?draftId=uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Send Message

**Endpoint:** `POST /v1/documents/{documentId}/ask-wren`

**Path Parameters:**

- `documentId` (uuid, required)

**Request Body:**

```json
{
  "draftId": "uuid",
  "text": "Can you explain the citation comment?"
}
```

**Parameters:**

- `draftId` (string, required)
- `text` (string, required): Min length 1

**Response:** `200 OK`

```json
{
  "sessionId": "string",
  "message": {
    "id": "string",
    "role": "wren",
    "text": "Which part of the citation are you unsure about?",
    "createdAt": "2024-01-20T14:23:00.000Z"
  }
}
```

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/documents/uuid/ask-wren" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"draftId":"uuid","text":"Can you explain the citation comment?"}'
```

---

# Department Endpoints

## List Departments

**Endpoint:** `GET /v1/departments`

**Response:** `200 OK` — array of `{ "id", "name" }`

Department Admins only see departments they administer.

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/departments" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Create Department

**Endpoint:** `POST /v1/departments`

**Authorization:** `TechnicalAdmin`

**Request Body:**

```json
{ "name": "Law" }
```

**Response:** `201 Created` with department object

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/departments" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"name":"Law"}'
```

---

## Get Department

**Endpoint:** `GET /v1/departments/{departmentId}`

**Path Parameters:**

- `departmentId` (string, required)

**Response:** `200 OK` with department object

---

## Delete Department

Soft-delete (archive) a department.

**Endpoint:** `DELETE /v1/departments/{departmentId}`

**Authorization:** `TechnicalAdmin`

**Path Parameters:**

- `departmentId` (uuid, required)

**Response:** `200 OK` with archived department object

**Example (cURL):**

```bash
curl -X DELETE "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/departments/uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## List Department Users

Users who have submitted at least one document in the department.

**Endpoint:** `GET /v1/departments/{departmentId}/users`

**Authorization:** Department Admin for this department, or Technical Admin

**Path Parameters:**

- `departmentId` (uuid, required)

**Query Parameters:**

- `q` (string, optional): Search term
- `limit` (integer, optional): Default `50`
- `offset` (integer, optional): Default `0`

**Response:** `200 OK`

```json
{
  "users": [],
  "total": 0
}
```

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/departments/uuid/users?limit=50&offset=0" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Set Department Access State

Set department-wide student access (`OPEN` or `LOCKED`).

**Endpoint:** `PUT /v1/departments/{departmentId}/access-state`

**Authorization:** `TechnicalAdmin`

**Request Body:**

```json
{ "accessState": "LOCKED" }
```

**Response:** `200 OK` with updated department

**Example (cURL):**

```bash
curl -X PUT "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/departments/uuid/access-state" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"accessState":"OPEN"}'
```

---

## Update Department Prompt

**Endpoint:** `PUT /v1/departments/{departmentId}/prompt`

**Authorization:** Department Admin for this department (capability `department.manage`)

**Request Body:**

```json
{ "prompt": "Department-level coaching instructions..." }
```

`prompt` may be `null` to clear.

**Response:** `200 OK` with updated department

Admin-submitted prompt text is run through Bedrock Guardrails; injection is rejected with `PROMPT_INJECTION_DETECTED`.

**Example (cURL):**

```bash
curl -X PUT "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/departments/uuid/prompt" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Department-level coaching instructions."}'
```

---

# Document Type Endpoints

## List Document Types

**Endpoint:** `GET /v1/document-types`

**Query Parameters:**

- `departmentId` (uuid, optional)

**Response:** `200 OK` with an array of document type objects (`id`, `departmentId`, `name`, `accessState`, optional `sizeLimitWords`)

`accessState` is `OPEN` (any authenticated student) or `LOCKED` (requires an access grant).

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/document-types?departmentId=uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Create Document Type

**Endpoint:** `POST /v1/document-types`

**Authorization:** Department Admin (administered department) or Technical Admin (`documentType.manageCatalog`)

**Request Body:**

```json
{
  "departmentId": "uuid",
  "name": "Legal memo"
}
```

**Response:** `201 Created`

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/document-types" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"departmentId":"uuid","name":"Legal memo"}'
```

---

## Set Document Type Access State

**Endpoint:** `PUT /v1/document-types/{documentTypeId}/access-state`

**Authorization:** `TechnicalAdmin` (`documentType.setAccessState`)

**Path Parameters:**

- `documentTypeId` (uuid, required)

**Request Body:**

```json
{ "accessState": "LOCKED" }
```

**Response:** `200 OK` — `{ "accessState": "LOCKED" }`

**Example (cURL):**

```bash
curl -X PUT "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/document-types/uuid/access-state" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"accessState":"OPEN"}'
```

---

## List Content Types

**Endpoint:** `GET /v1/document-types/{documentTypeId}/content-types`

**Path Parameters:**

- `documentTypeId` (string, required)

**Response:** `200 OK` — array of `{ "id", "documentTypeId", "label" }`

---

## Get Document Type Config

**Endpoint:** `GET /v1/document-types/{documentTypeId}/config`

**Authorization:** `documentType.readConfig` (Department Admin in scope, or Technical Admin)

**Response:** `200 OK` — `DocumentTypeConfig` (`tone`, `density`, `categoryPriority`, `typePromptText`, description fields, `updatedAt`)

---

## Update Document Type Config

Partial update of taxonomy, conventions, and type prompt.

**Endpoint:** `PUT /v1/document-types/{documentTypeId}/config`

**Authorization:** `documentType.modifyConfig`

**Request Body:** object of config fields (see `DocumentTypeConfig` in the OpenAPI spec)

**Response:** `200 OK` with updated config

**Example (cURL):**

```bash
curl -X PUT "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/document-types/uuid/config" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"typePromptText":"Ask about structure before sentence-level issues.","tone":"supportive"}'
```

---

## List Error Categories

**Endpoint:** `GET /v1/document-types/{documentTypeId}/error-categories`

`internalGuidance` is stripped for callers who are not Technical Admin or Department Admin of the owning department.

**Response:** `200 OK` — array of category objects

---

## Create Error Category

**Endpoint:** `POST /v1/document-types/{documentTypeId}/error-categories`

**Request Body:**

```json
{
  "name": "Clarity",
  "internalGuidance": "Prefer questions about reader confusion."
}
```

**Response:** `201 Created`

---

## Update Error Category

**Endpoint:** `PATCH /v1/document-types/{documentTypeId}/error-categories/{categoryId}`

**Request Body:** `{ "name": "Citation format", "internalGuidance": "..." }` (fields optional)

**Response:** `200 OK`

---

## Delete Error Category

**Endpoint:** `DELETE /v1/document-types/{documentTypeId}/error-categories/{categoryId}`

**Response:** `204 No Content`

---

# User and Role Endpoints

## Search Users

Platform-wide user search.

**Endpoint:** `GET /v1/users`

**Authorization:** `TechnicalAdmin` (`user.search`)

**Query Parameters:**

- `q` (string, optional): If the value contains `@`, treated as email; otherwise first-name search
- `firstName`, `lastName`, `email`, `role` (optional)
- `page`, `pageSize` (optional pagination)

**Response:** `200 OK` — paginated user search result (`users`, total/page fields per service schema)

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/users?q=jane" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Assign Role

**Endpoint:** `POST /v1/roles`

**Authorization:** `TechnicalAdmin`

**Request Body:**

```json
{
  "userId": "uuid",
  "role": "DepartmentAdmin",
  "scope": {},
  "departmentId": "uuid"
}
```

**Parameters:**

- `userId` (string, required)
- `role` (string, required): `Student`, `DepartmentAdmin`, or `TechnicalAdmin`
- `scope` (object, required)
- `departmentId` (string, optional): Required when assigning `DepartmentAdmin`

**Response:** `200 OK` — `{ "success": true, "userId": "uuid", "role": "DepartmentAdmin" }`

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/roles" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"userId":"uuid","role":"DepartmentAdmin","scope":{},"departmentId":"uuid"}'
```

---

## Revoke Role

**Endpoint:** `DELETE /v1/roles`

**Authorization:** `TechnicalAdmin`

**Request Body:** same shape as assign (`userId`, `role`, `scope`, optional `departmentId`)

**Response:** `200 OK` — `{ "success": true, "userId": "uuid", "role": "DepartmentAdmin" }`

**Example (cURL):**

```bash
curl -X DELETE "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/roles" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"userId":"uuid","role":"DepartmentAdmin","scope":{},"departmentId":"uuid"}'
```

---

# Usage Endpoints

## Get Usage Report

**Endpoint:** `GET /v1/usage`

**Authorization:** `TechnicalAdmin` (`usageLimit.configure`)

**Query Parameters:**

- `scope` (string, optional): `platform` (default) or a document type UUID
- `periodStart` (ISO datetime, optional): Defaults to UTC start of the current calendar month

**Response:** `200 OK` — usage report or `null` when no limit is configured

```json
{
  "scope": { "kind": "platform" },
  "limitValue": 100,
  "consumed": 12,
  "remaining": 88,
  "periodStart": "2024-01-01T00:00:00.000Z"
}
```

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/usage?scope=platform" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Grant Usage Override

Grant a temporary extra-action allowance for a student on a document type.

**Endpoint:** `POST /v1/overrides`

**Authorization:** Department Admin (in scope) or Technical Admin (`usageOverride.grant`)

**Request Body:**

```json
{
  "userId": "uuid",
  "documentTypeId": "uuid",
  "bounds": { "additionalActions": 5 },
  "reason": "Extension after system outage",
  "expiresAt": "2024-02-01T00:00:00.000Z"
}
```

**Response:** `200 OK` with override object

**Example (cURL):**

```bash
curl -X POST "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/overrides" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"userId":"uuid","documentTypeId":"uuid","bounds":{"additionalActions":5},"reason":"Extension","expiresAt":"2024-02-01T00:00:00.000Z"}'
```

---

# Analytics Endpoints

Department Admins are scoped to administered departments. Technical Admins may query platform-wide. Aggregates never include per-student identity.

## Get Aggregate Analytics

**Endpoint:** `GET /v1/analytics`

**Query Parameters:**

- `documentTypeId` (string, optional)

**Response:** `200 OK`

```json
{
  "totals": [
    {
      "scopeKind": "platform",
      "scopeId": null,
      "metric": "documents_created",
      "value": 120
    }
  ]
}
```

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/analytics?documentTypeId=uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Get Analytics Summary

**Endpoint:** `GET /v1/analytics/summary`

**Authorization:** `TechnicalAdmin`

**Query Parameters:**

- `departmentId` (string, optional): Limit to one department’s document types

**Response:** `200 OK`

```json
{
  "totalDocuments": 120,
  "totalDrafts": 340,
  "activeUsers": 45,
  "breakdownByDocumentType": [
    { "id": "uuid", "name": "Legal memo", "feedbackGenerated": 80 }
  ],
  "platformUsageOverTime": [
    { "month": "2024-01", "feedbackGenerated": 40 }
  ]
}
```

---

## Get Helpfulness Analytics

**Endpoint:** `GET /v1/analytics/feedback-helpfulness`

**Query Parameters:**

- `documentTypeId` (uuid, required)

**Response:** `200 OK`

```json
{
  "helpful": 40,
  "notHelpful": 8,
  "total": 48,
  "comments": [
    {
      "helpful": false,
      "comment": "Too generic",
      "createdAt": "2024-01-20T14:22:00.000Z"
    }
  ]
}
```

Up to 20 recent anonymous comments.

---

## Get Section Applicability Analytics

**Endpoint:** `GET /v1/analytics/section-applicability`

**Query Parameters:**

- `documentTypeId` (uuid, required)

**Response:** `200 OK`

```json
{
  "asOf": "2024-01-20T14:22:00.000Z",
  "sections": [
    {
      "categoryId": "uuid",
      "categoryName": "Clarity",
      "applicableCount": 10,
      "notApplicableCount": 2,
      "total": 12,
      "notApplicablePct": 16.67
    }
  ]
}
```

Sections with zero votes are omitted. Sorted by not-applicable percentage descending.

---

## Get Improvement Trends

Weekly average resolution scores per error category.

**Endpoint:** `GET /v1/analytics/improvement-trends`

**Query Parameters:**

- `documentTypeId` (uuid, required)

**Response:** `200 OK`

```json
{
  "trends": [
    {
      "week": "2024-W03",
      "weekStart": "2024-01-15",
      "categoryId": "uuid",
      "categoryName": "Clarity",
      "score": 0.62,
      "sampleSize": 14
    }
  ]
}
```

---

# Notification Endpoints

Any authenticated role may read and update **their own** inbox. Catalog CRUD is Technical Admin only.

## List Notifications

**Endpoint:** `GET /v1/notifications`

**Query Parameters:**

- `cursor` (string, optional): Opaque keyset cursor
- `limit` (integer, optional): 1–100, default `20`
- `stateFilter` (string, optional): `unread` or `read`

**Response:** `200 OK`

```json
{
  "notifications": [
    {
      "id": "uuid",
      "typeSlug": "debrief-ready",
      "typeLabel": "Debrief ready",
      "renderedContent": "Your AI Debrief is ready.",
      "state": "unread",
      "createdAt": "2024-01-20T14:22:00.000Z",
      "actionUrl": "/documents/uuid"
    }
  ],
  "nextCursor": null,
  "unreadCount": 1
}
```

**Example (cURL):**

```bash
curl -X GET "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/notifications?limit=20" \
  -H "Authorization: Bearer eyJraWQiOiJ..."
```

---

## Get Unread Count

**Endpoint:** `GET /v1/notifications/unread-count`

**Response:** `200 OK` — `{ "count": 3 }`

---

## Update Notification State

**Endpoint:** `PATCH /v1/notifications/{id}`

**Path Parameters:**

- `id` (string, required)

**Request Body:**

```json
{ "state": "read" }
```

`state` is `read` or `dismissed`.

**Response:** `200 OK` — `{ "success": true }`

**Example (cURL):**

```bash
curl -X PATCH "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/notifications/uuid" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"state":"read"}'
```

---

## Bulk Notification Action

**Endpoint:** `POST /v1/notifications/bulk`

**Request Body:**

```json
{ "action": "markAllRead" }
```

`action` is `markAllRead` or `dismissAll`.

**Response:** `200 OK` — `{ "affected": 5 }`

---

## List Notification Types

**Endpoint:** `GET /v1/admin/notification-types`

**Authorization:** `TechnicalAdmin`

**Response:** `200 OK` — array of catalog entries (`id`, `slug`, `label`, `displayTemplate`, `actionUrlTemplate`, `targetRoles`, `dedupStrategy`, timestamps)

---

## Create Notification Type

**Endpoint:** `POST /v1/admin/notification-types`

**Authorization:** `TechnicalAdmin`

**Request Body:**

```json
{
  "slug": "debrief-ready",
  "label": "Debrief ready",
  "targetRoles": ["Student"],
  "displayTemplate": "Your AI Debrief is ready.",
  "actionUrlTemplate": "/documents/{documentId}",
  "dedupStrategy": { "enabled": true, "windowMinutes": 60, "keyFields": ["documentId"] }
}
```

**Response:** `201 Created`

---

## Update Notification Type

**Endpoint:** `PUT /v1/admin/notification-types/{id}`

**Authorization:** `TechnicalAdmin`

**Request Body:** partial fields (`label`, `targetRoles`, `displayTemplate`, `actionUrlTemplate`, `dedupStrategy`)

**Response:** `200 OK`

---

# Admin Config Endpoints

## Get Usage Limits

**Endpoint:** `GET /v1/admin/config/usage-limits`

**Authorization:** `TechnicalAdmin`

**Response:** `200 OK`

```json
{
  "messageLimit": 100,
  "debriefGenerationLimit": 50,
  "documentUploadLimit": 20,
  "draftsPerDocumentLimit": 10
}
```

---

## Update Usage Limits

**Endpoint:** `PUT /v1/admin/config/usage-limits`

**Authorization:** `TechnicalAdmin`

**Request Body:** same four integer fields as the GET response (all required, minimum 1)

**Response:** `200 OK` with updated policy

**Example (cURL):**

```bash
curl -X PUT "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/admin/config/usage-limits" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"messageLimit":100,"debriefGenerationLimit":50,"documentUploadLimit":20,"draftsPerDocumentLimit":10}'
```

---

## Get Bedrock Model Config

**Endpoint:** `GET /v1/admin/config/model`

**Authorization:** `TechnicalAdmin`

**Response:** `200 OK`

```json
{
  "modelId": "us.anthropic.claude-sonnet-4-6",
  "writable": true,
  "allowedModels": [{ "id": "us.anthropic.claude-sonnet-4-6" }]
}
```

Runtime value is stored in SSM (`/wren-dev/config/bedrock-model-id`) and the platform usage policy row.

---

## Update Bedrock Model Config

**Endpoint:** `PUT /v1/admin/config/model`

**Authorization:** `TechnicalAdmin`

**Request Body:**

```json
{ "modelId": "us.anthropic.claude-sonnet-4-6" }
```

`modelId` must be in the allowed inference-profile list. **Response:** `200 OK` with the same shape as GET.

The OpenAPI spec still documents `501` on this PUT (`summary: not implemented`). The Admin Lambda **does** implement the update (`handleUpdateModelConfig`) and returns `200` when the model id is allowed. Treat the Lambda as source of truth until the spec responses are updated.

**Example (cURL):**

```bash
curl -X PUT "https://{api-id}.execute-api.{region}.amazonaws.com/{stage}/v1/admin/config/model" \
  -H "Authorization: Bearer eyJraWQiOiJ..." \
  -H "Content-Type: application/json" \
  -d '{"modelId":"us.anthropic.claude-sonnet-4-6"}'
```

---

## Security Considerations

### Token Management

- Cognito access tokens expire (typically 1 hour) — refresh the session before calling the API
- Never log tokens or put them in client source control
- Pass `Authorization: Bearer {token}` on every REST call; AppSync subscriptions use the **ID** token

### Dual Enforcement

- The authorizer Allow is stage-wide and cacheable (30s TTL)
- Privileged mutations must still pass `authorizeCapability` inside the service Lambda
- IdP groups/claims are not used for ongoing authorization

### CORS

REST methods support CORS. Deployed gateway responses include:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS`
- `Access-Control-Allow-Headers: Content-Type,Accept,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent`

Tighten origins for production (the Api stack currently allows `*`).

### Input Validation

- Selected routes use API Gateway request validators (`body-only`, `params-only`, `full`)
- Service layers validate with Zod (`@wren/types` and handler schemas)
- The raw OpenAPI definition is [`cdk/lib/openapi.yaml`](../cdk/lib/openapi.yaml)

### Caching

API Gateway method caching is **disabled**. Feedback GET must not be cached by document ID alone (that would skip the ownership check). Lambdas set `Cache-Control: private` where needed.

### Throttling

100 req/s sustained, 200 burst at the API stage.

## AppSync Realtime

Debrief-ready and notification events can be delivered over AppSync GraphQL subscriptions. If `VITE_APPSYNC_URL` is unset, the UI polls REST status endpoints instead.

**HTTPS GraphQL URL** (CDK output `AppSyncGraphqlUrl` on the Compute stack):

```
https://{appsync-id}.appsync-api.{region}.amazonaws.com/graphql
```

**Realtime WebSocket URL** (derived by the client):

```
wss://{appsync-id}.appsync-realtime-api.{region}.amazonaws.com/graphql
```

Auth for the websocket uses the Cognito **ID** token in the AppSync `header` query parameter. Schema: [`cdk/lib/appsync/schema.graphql`](../cdk/lib/appsync/schema.graphql).

Client subscriptions:

| Subscription | Variables | Purpose |
| --- | --- | --- |
| `onDebriefReady` | `documentId` | Debrief job finished (`itemCount`) |
| `onNotification` | `recipientUserId` | New in-app notification |
| `onNotificationStateChange` | `recipientUserId` | Read/dismissed sync across sessions |

Publish mutations (`publishDebriefReady`, `publishNotification`, `publishNotificationStateChange`) are IAM-only for Lambdas, not for the browser.

## Troubleshooting

### 401 Unauthorized

- Verify `Authorization` is present and the JWT is not expired
- Confirm the token is from the same user pool and app client as this environment
- First-login provisioning happens in the authorizer; a brief 401 can occur if the token is missing entirely

```javascript
import { fetchAuthSession } from "aws-amplify/auth";
const session = await fetchAuthSession({ forceRefresh: true });
const token = session.tokens?.accessToken?.toString();
```

### 403 Forbidden

- Confirm the caller’s roles from `GET /v1/auth/me`
- Department Admin operations need the target department in `administeredDepartmentIds`
- Technical Admin is not a blanket override for department-scoped educational operations

### 404 Not Found

- Resource ID is wrong, or the student does not own the document
- Department or document type was archived / never created

### 429 Usage Limit Reached

- Lifetime policy caps (messages, debriefs, uploads, drafts) were exceeded
- A Department Admin can grant a temporary override via `POST /v1/overrides`

### 500 Internal Server Error

- Check CloudWatch for `/aws/lambda/wren-dev-authorizer`, `wren-dev-document`, `wren-dev-feedback-orchestrator`, `wren-dev-feedback-engine`, `wren-dev-admin`
- For debrief failures, confirm Bedrock model access in the account

### CORS error in the browser

- Gateway-generated 401/403 include CORS headers; a missing `Authorization` header still fails preflight if `OPTIONS` is broken
- Confirm the request method is allowed (`PATCH` is required for draft autosave)

---

**API Version:** 1.0.0  
**OpenAPI Spec:** `cdk/lib/openapi.yaml`  
**Shared types:** `types/` (`@wren/types`)
