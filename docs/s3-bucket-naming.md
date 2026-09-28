# S3 Buckets: Naming, Partitioning, and Object Keys

This document lists every S3 bucket WREN creates or writes to. For each one it covers how the bucket is named, how objects are partitioned by prefix, and how object keys are built. Examples use the default stack prefix, account, and Region.

## 1. Bucket inventory

| Bucket | Owner (stack / construct) | Region | Name source | Example name |
| --- | --- | --- | --- | --- |
| Documents | `${prefix}-Storage` / `Storage/DocumentsBucket` | Data-plane (`ca-central-1`) | CloudFormation auto-name | `wren-dev-storage-storagedocumentsbucket59145458-1a2b3c4d5e6f` |
| Reference | `${prefix}-Storage` / `Storage/ReferenceBucket` | Data-plane | CloudFormation auto-name | `wren-dev-storage-storagereferencebucket77460b50-6f5e4d3c2b1a` |
| CloudFront access logs | `${prefix}-CloudFrontWaf` / `AccessLogs` | `us-east-1` | CloudFormation auto-name | `wren-dev-cloudfrontwaf-accesslogs8b620eca-0a1b2c3d4e5f` |
| CodePipeline artifacts | `${prefix}-Cicd` / `Pipeline/ArtifactsBucket` (only when the pipeline is enabled) | Data-plane | CloudFormation auto-name | `wren-dev-cicd-pipelineartifactsbucket22248f97-9f8e7d6c5b4a` |
| CDK bootstrap assets | `CDKToolkit` (created by `cdk bootstrap`, not by WREN) | Data-plane and `us-east-1` | CDK bootstrap convention | `cdk-hnb659fds-assets-111122223333-ca-central-1` |

## 2. Bucket naming convention

### 2.1 WREN-owned buckets (auto-named)

No WREN bucket sets an explicit `bucketName`. CloudFormation generates each name as:

```
<stack name>-<logical id>-<random suffix>     (all lowercased, max 63 characters)
```

- **Stack name.** This is `${stackPrefix}-<Concern>` from `stackName()` in `cdk/lib/config.ts`. 
- **Logical ID.** CDK derives it from the construct path plus an 8-character hash, for example `Storage/DocumentsBucket` becomes `StorageDocumentsBucket59145458`. The ID stays the same as long as the construct IDs in `StorageResources.ts`, `CloudFrontWafStack.ts`, and `CicdStack.ts` don't change.
- **Random suffix.** CloudFormation adds it when it creates the bucket. It is fixed for the bucket's lifetime.
- **Lowercasing and truncation.** CloudFormation lowercases the name, and it truncates the stack name and logical-ID parts if the total would exceed 63 characters. With a long custom `stackPrefix`, expect truncated names.

All four WREN buckets use `RemovalPolicy.RETAIN`. A redeploy after the stack has been deleted creates a new bucket with a new suffix, and the old bucket remains.

### 2.2 CDK bootstrap assets bucket

This bucket follows the CDK default-qualifier convention, hard-coded in `CicdStack.bootstrapAssetsBucketNameFor()`:

```
cdk-hnb659fds-assets-<account id>-<region>
```

WREN uses two of these: one in the data-plane Region for most stacks, and one in `us-east-1` for the `CloudFrontWaf` stack.

### 2.3 How runtime code finds bucket names

Application code never hard-codes bucket names. The Storage stack publishes them to SSM, and the Compute stack injects them as environment variables:

| Bucket | SSM parameter | Env var | Consumers |
| --- | --- | --- | --- |
| Documents | `/${stackPrefix}/storage/documents-bucket-name` | `DOCUMENTS_BUCKET_NAME` | Document Lambda, ingest worker, Feedback Engine |
| Reference | `/${stackPrefix}/storage/reference-bucket-name` | `REFERENCE_BUCKET_NAME` | Feedback Engine, Admin Lambda |

The Document Lambda also receives `DOCUMENTS_KMS_KEY_ARN`, the storage CMK that presigned uploads must use. 

## 3. Partition schema

"Partition" here means the key-prefix hierarchy. S3 has no folders; prefixes are the only structure.

### 3.1 Documents bucket

```
documents/
  <userId>/                    one prefix per writer (app_user.id, UUID)
    uploads/
      <uuid>-<safeFileName>    every uploaded .docx / .pdf
figures/                       reserved, not written in production
  <documentId>/
    figure-<page>-<nn>.png
```

- Objects are partitioned by the **owning user**, not by document or draft. One user's drafts across all documents share `documents/<userId>/uploads/`. The link from an object to a document or draft exists only in Postgres (`draft.s3_key`, `document_ingest_job.s3_key`).
- Ownership is enforced by this prefix. `POST /v1/documents` and `POST /v1/documents/{id}/drafts` return `403 PERMISSION_DENIED` unless `source.key` starts with `documents/<caller userId>/`.

### 3.2 Reference bucket

```
document-types/
  <documentTypeId>/            document_type.id (UUID)
    <file>                     UTF-8 text, usually .txt
```

- The Feedback Engine lists `document-types/<documentTypeId>/` with no delimiter, so objects in nested sub-prefixes are included too.
- This prefix is the only thing that links a file to a Document Type. The `reference_material.s3_key` column is catalog metadata, and the engine does not read it.

### 3.3 CloudFront access logs bucket

```
cloudfront/
  <distributionId>.<YYYY-MM-DD-HH>.<uniqueId>.gz
```

The `cloudfront/` prefix comes from `logFilePrefix` in `CloudFrontWafStack.ts`. CloudFront names the files, using a UTC hour ([CloudFront standard logging](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging-legacy-s3.html)).

### 3.4 CodePipeline artifacts bucket

```
<pipeline name>/<artifact name>/<random id>
```

CodePipeline generates these keys and may truncate the names. The pipeline is `${stackPrefix}-pipeline`, and its artifacts are `SourceOutput`, `CdkOutput`, and `ImageUri`. WREN code never builds keys in this bucket.

### 3.5 CDK bootstrap assets bucket

```
<sha256>.zip | <sha256>.json          CDK file assets (Lambda bundles, templates)
wren-bootstrap-source/
  <stackPrefix>/
    <commitSha>.zip                   git archive snapshot for the image build
```

- CDK (`cdk deploy` or `cdk-assets publish`) writes the hash-named assets at the bucket root.
- WREN writes only under `wren-bootstrap-source/<stackPrefix>/`, so several environments can share one account without key collisions. The bootstrap CodeBuild project can read only this prefix.

## 4. Object naming scheme

### 4.1 Document uploads (Documents bucket)

Built in `handlePresignUpload` (`backend/document/src/lambda-handler.ts`):

```ts
const safeName = filename.replace(/[^\w.\-()+ ]+/g, '_');
const key = `documents/${actor.userId}/uploads/${uuid()}-${safeName}`;
```

| Segment | Value |
| --- | --- |
| `documents/` | Literal |
| `<userId>` | Authenticated user's `app_user.id` (UUID) |
| `uploads/` | Literal |
| `<uuid>` | Random UUID v4, generated per presign request, so keys never collide |
| `<safeFileName>` | Client filename with each run of characters outside `A–Z a–z 0–9 _ . - ( ) + space` replaced by a single `_`. Accented and other non-ASCII letters are replaced too. There is no length cap. |

Rules:

- Only `.docx` and `.pdf` are accepted (checked case-insensitively on the original filename). The stored `Content-Type` is `application/pdf` or `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- The presigned POST expires after 15 minutes. It locks the content type and size (1 byte up to the usage-policy maximum, 30 MiB by default), and it requires SSE-KMS with the storage CMK.
- `draft.file_name` and `document_ingest_job.file_name` store the last key segment, which is `<uuid>-<safeFileName>`.
- Pasted text is not stored in S3. Those drafts have `s3_key = 'inline'`.

Examples:

| Client filename | Object key |
| --- | --- |
| `Essay draft (v2).docx` | `documents/3f6c2a9e-8b41-4d2e-9c7a-1b2d3e4f5a6b/uploads/7d9e1c42-5a3b-4f8e-b1c6-0e2f4a6b8c9d-Essay draft (v2).docx` |
| `Mémoire final.pdf` | `documents/3f6c2a9e-8b41-4d2e-9c7a-1b2d3e4f5a6b/uploads/0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f-M_moire final.pdf` |
| `memo#1&notes.PDF` | `documents/3f6c2a9e-8b41-4d2e-9c7a-1b2d3e4f5a6b/uploads/5b6c7d8e-9f0a-4b1c-9d2e-3f4a5b6c7d8e-memo_1_notes.PDF` |

### 4.2 Reference material (Reference bucket)

No code writes this bucket. The Admin Lambda has `PutObject` permission, but `referenceMaterialService.ts` manages only the catalog row, so an operator uploads files by hand. The engine (`load_reference_material` in `backend/engine/python/handler.py`) expects:

```
document-types/<documentTypeId>/<NN>_<title>.txt
```

- Objects are sorted by key before the character caps in `wren_engine/debrief_budget.py` are applied, so a numeric prefix (`01_`, `02_`, …) controls which files survive the cap.
- The file's title in the prompt is the last key segment with `.txt` removed.
- Every object is decoded as UTF-8. Binary files such as `.pdf` or `.docx` fail to decode, and the engine logs a warning and skips them.

Examples:

```
document-types/5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a/01_style-guide.txt
document-types/5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a/02_citation-rules.txt
```

Upload with, for example:

```sh
aws s3 cp 01_style-guide.txt "s3://$(aws ssm get-parameter --name /wren-dev/storage/reference-bucket-name --query Parameter.Value --output text)/document-types/<documentTypeId>/01_style-guide.txt"
```

The bucket's default encryption applies the storage CMK, so no extra encryption flags are needed.

### 4.3 Bootstrap source snapshot (CDK bootstrap assets bucket)

Built in `uploadCommitSnapshot` (`cdk/scripts/operations/deployWorkflow.ts`) using `CicdStack.bootstrapSourcePrefixFor()`:

```
wren-bootstrap-source/<stackPrefix>/<full 40-char commit SHA>.zip
```

Example: `wren-bootstrap-source/wren-dev/4e1f0c9b2a7d6e5f4c3b2a1908f7e6d5c4b3a291.zip`

The key includes the SHA, so each build reads a fixed source without relying on object versions. The CodeBuild project's synth-time source, `wren-bootstrap-source/<stackPrefix>/HEAD.zip`, is a placeholder that is never uploaded. Each build overrides it with the SHA key.

## 5. Lifecycle rules and tags

None of the lifecycle rules filters by prefix. They apply to the whole bucket, or they filter by tag.

| Bucket | Rule | Effect |
| --- | --- | --- |
| Documents, Reference | `AbortIncompleteMultipartUploads` | Abort after 7 days |
| Documents, Reference | `ExpireOrphanedDocumentUploads` | Expire objects tagged `orphan-upload=true` after 1 day |
| Documents, Reference | `TransitionNoncurrentToInfrequentAccess` | Noncurrent versions move to Standard-IA after 30 days and expire after 365 days |
| Access logs | `ExpireCloudFrontAccessLogs` | Expire after 90 days; abort multipart uploads after 7 days |
| Pipeline artifacts | `ExpirePipelineArtifacts` | Expire after 90 days; abort multipart uploads after 7 days |

- `orphan-upload=true` is the only object tag WREN sets. No code writes user-defined object metadata.
- The Documents and Reference buckets are versioned. Deleting a document (`DELETE /v1/documents/{id}`) runs `DeleteObjects` without a version ID. That adds delete markers, and the underlying bytes are removed later by the noncurrent-version rule, within 365 days.

## 6. Finding the deployed bucket names

```sh
# Documents / Reference (data-plane Region)
aws ssm get-parameter --name /wren-dev/storage/documents-bucket-name --query Parameter.Value --output text
aws ssm get-parameter --name /wren-dev/storage/reference-bucket-name --query Parameter.Value --output text

# CloudFront access logs (us-east-1)
aws cloudformation describe-stack-resource --region us-east-1 \
  --stack-name wren-dev-CloudFrontWaf --logical-resource-id AccessLogs8B620ECA \
  --query StackResourceDetail.PhysicalResourceId --output text

# CodePipeline artifacts
aws cloudformation describe-stack-resource \
  --stack-name wren-dev-Cicd --logical-resource-id PipelineArtifactsBucket22248F97 \
  --query StackResourceDetail.PhysicalResourceId --output text
```

Replace `wren-dev` with your `stackPrefix`.
