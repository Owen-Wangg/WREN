# AWS Encryption and Customer-Managed KMS Key Usage

This document identifies resources in the WREN CDK application that currently use AWS-managed KMS keys or AWS service-managed encryption (such as SSE-S3 and SSE-SQS) rather than customer-managed KMS keys (CMKs), and describes the changes required to use customer-managed keys where the service supports them.

## Scope

This covers resources in the WREN CDK application that currently rely on AWS-managed KMS keys or AWS service-managed encryption. Resources already on the storage CMK are listed once below and not repeated as migrations.

This document distinguishes between two things that are easy to conflate:

- **AWS-managed KMS keys** — keys AWS creates and manages on your behalf, visible in KMS under an `aws/<service>` alias (for example `aws/rds`, `aws/secretsmanager`, `aws/logs`).
- **AWS service-managed encryption** — encryption where the service owns the key material and does not expose a KMS key you can reference, such as SSE-S3 (S3-managed keys) and SSE-SQS (SQS-managed keys).

The document separates what the CDK code declares from what AWS provisions. Each section states the CDK configuration first and identifies the resulting AWS encryption mechanism where it is known. Where the mechanism depends on service or account configuration, confirm it against the deployed resource.

Already on a CMK: the documents S3 bucket, reference S3 bucket, and the Ask WREN DynamoDB `ConversationHistory` table. These use the storage key in `cdk/lib/constructs/StorageResources.ts` (`enableKeyRotation: true`, `RemovalPolicy.RETAIN`), and Compute calls `storageEncryptionKey.grantEncryptDecrypt` for the Document, Admin, and Feedback Orchestrator functions.

---

## 1. RDS Instance — `cdk/lib/constructs/DatabaseResources.ts`

Current behaviour

CDK: `storageEncrypted: true` is set on `DatabaseInstance` without `storageEncryptionKey`.

AWS: RDS therefore encrypts the DB instance storage using the `aws/rds` AWS-managed KMS key (the documented default when no customer-managed key is specified). Performance Insights is not enabled, so there is currently no Performance Insights encryption setting.

To use a CMK

1. Create a dedicated key, or reuse the storage CMK from `StorageStack` (pass it into `DatabaseStack` / `DatabaseResources` — it is not wired today):

   ```ts
   import * as kms from "aws-cdk-lib/aws-kms";

   const rdsKey = new kms.Key(this, "RdsEncryptionKey", {
     enableKeyRotation: true,
     description: "CMK for RDS storage encryption",
     removalPolicy: RemovalPolicy.RETAIN,
   });
   ```

2. Set `storageEncryptionKey` on the instance (keep `storageEncrypted: true`).

3. If Performance Insights is enabled in the future, also set `performanceInsightEncryptionKey`. The RDS service-linked role needs `kms:CreateGrant` and encrypt-decrypt on the key; CDK usually adds this when `storageEncryptionKey` is a `Key` construct you own.

> Changing the RDS encryption key on an existing instance requires a snapshot restore or a new instance. Plan a migration window; `RemovalPolicy.RETAIN` will not rewrite encryption in place.

---

## 2. Secrets Manager Secrets — `DatabaseResources.ts` and `ComputeStack.ts`

Current behaviour

CDK: `secretsmanager.Secret` resources omit `encryptionKey`.

AWS: Secrets Manager therefore encrypts them with the `aws/secretsmanager` AWS-managed KMS key (its default when no customer-managed key is set).

| Secret | File | Construct / name |
| --- | --- | --- |
| RDS admin (`dbadmin`) | `DatabaseResources.ts` | `Credentials.fromGeneratedSecret` → `{prefix}/database/credentials` |
| Per-role DB passwords (×8) | `DatabaseResources.ts` | `{prefix}/database/{role}` for each `APP_DB_ROLES` entry |
| Activity-log pseudonym salt | `ComputeStack.ts` | `ActivityPseudonymSalt` → `{prefix}/audit/pseudonym-salt` |

`APP_DB_ROLES` (`cdk/lib/appDbRoles.ts`): `wren_authorizer`, `wren_appsync_auth`, `wren_document`, `wren_admin`, `wren_audit`, `wren_feedback_orch`, `wren_feedback_engine`, `wren_notification`.

GitHub tokens are created by operators, not CDK. If those operator-created secrets do not specify a customer-managed KMS key, Secrets Manager uses `aws/secretsmanager`:

| Secret | Used by |
| --- | --- |
| `{prefix}/cicd/github-pat` | `CicdStack` CodePipeline GitHub source |
| `{prefix}/github/token` | `AmplifyStack` GitHub source |

To use a CMK

1. Create a key:

   ```ts
   const secretsKey = new kms.Key(this, "SecretsEncryptionKey", {
     enableKeyRotation: true,
     description: "CMK for Secrets Manager secrets",
   });
   ```

2. Pass `encryptionKey: secretsKey` on every CDK `Secret`, and on `Credentials.fromGeneratedSecret` via its `encryptionKey` option if you use the generated admin secret.

3. IAM: several roles use inline `secretsmanager:GetSecretValue` rather than `secret.grantRead`, so they do not pick up `kms:Decrypt` automatically:

   | Caller | File |
   | --- | --- |
   | Each Compute Lambda (`grantDatabaseAccess`) | `ComputeStack.ts` |
   | Password sync custom resource | `DbPasswordSync.ts` |
   | Migration runner | `MigrationRunner.ts` |

   Add `secretsKey.grantDecrypt(...)` on those functions (and on the RDS Proxy secret-access role if CDK does not already attach it). Prefer `secret.grantRead(fn)` rather than manually granting `secretsmanager:GetSecretValue`, because the CDK grant can include the permissions required to use the secret's encryption key.

4. For GitHub PAT / Amplify token secrets created in the console or CLI, set the KMS key there and add key-policy statements for `codepipeline.amazonaws.com`, CodePipeline's role, and Amplify's service-linked role (`amplify.amazonaws.com`) as required.

5. `CicdStack`'s Compute CloudFormation deploy role already has a broad `KmsUseExistingStorageKey` statement (`kms:Decrypt` on `*`). Tighten it to the secrets/storage key ARNs if you introduce more CMKs.

---

## 3. S3 — CodePipeline artifact bucket — `cdk/lib/stacks/CicdStack.ts`

Current behaviour

CDK: `new codepipeline.Pipeline(...)` does not pass `artifactBucket`, so CDK creates a default artifact bucket.

AWS: that bucket uses SSE-S3 (AES-256, S3-managed encryption — not a KMS key). The application document and reference buckets already use SSE-KMS with the storage CMK (`StorageResources.ts`); leave those unchanged.

To use a CMK

1. Create a pipeline key and an explicit artifact bucket:

   ```ts
   const pipelineKey = new kms.Key(this, "PipelineArtifactKey", {
     enableKeyRotation: true,
     description: "CMK for CodePipeline artifact buckets",
   });

   const artifactBucket = new s3.Bucket(this, "PipelineArtifactBucket", {
     encryption: s3.BucketEncryption.KMS,
     encryptionKey: pipelineKey,
     blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
     enforceSSL: true,
   });
   ```

2. Pass `artifactBucket` into `new codepipeline.Pipeline(...)`.

3. Grant encrypt/decrypt to the CodeBuild projects (`BuildProject`, `UpdateLambdaProject`) and allow the CodePipeline service principal `kms:Decrypt` / `kms:GenerateDataKey`.

> The CDK bootstrap asset bucket (`cdk-hnb659fds-assets-…`) is created by `cdk bootstrap`. Changing its encryption is a bootstrap/KMS customisation, not a `CicdStack` edit.

---

## 4. ECR Repository — `cdk/lib/stacks/CicdStack.ts`

Current behaviour

One repository, `{prefix}-feedback-engine`, is created without a customer-managed `encryption` / `encryptionKey`, so ECR uses its default AES-256 encryption.

To use a CMK

1. Set `encryption: ecr.RepositoryEncryption.KMS` plus `encryptionKey` on the `Repository`.

2. Once the repository uses a customer-managed key, the roles that pull and push images may need KMS permissions on that key. Confirm the resulting IAM and key-policy requirements against the actual configuration before granting, and consider:

   - the CodeBuild build role (`grantPullPush`)
   - the UpdateLambda CodeBuild role (`grantPull`)
   - the Feedback Engine Lambda execution role (image pull at start)
   - `lambda.amazonaws.com` if you rely on a repository policy for pull

> Changing the repository's encryption configuration is a migration concern, not just a CDK property change. Verify how existing images are handled before applying it to an existing production repository.

---

## 5. SQS Queues — `ComputeStack.ts` and `NotificationInfraConstruct.ts`

Current behaviour

CDK: queues are created without `encryptionMasterKey`.

AWS: the queues use SQS's default server-side encryption (SSE-SQS), which does not use a customer-managed KMS key. Confirm the deployed queue's encryption attributes if needed.

| Queue | File |
| --- | --- |
| `DocumentIngestQueue` / `DocumentIngestDlq` | `ComputeStack.ts` |
| `FeedbackQueue` / `FeedbackDlq` | `ComputeStack.ts` |
| `NotificationQueue` / `NotificationDLQ` | `NotificationInfraConstruct.ts` |

To use a CMK

1. Create a queue key (or one key per domain: ingest / feedback / notifications).

2. Set `encryptionMasterKey` on both the main queue and its DLQ.

3. Grant encrypt/decrypt to every producer and consumer:

   - Ingest: Document Lambda (send + consume)
   - Feedback: Orchestrator (send), Feedback Engine (receive)
   - Notifications: publishers (`grantPublish` on SNS is not enough once SQS is KMS-encrypted), Notification Lambda (consume)

> SNS→SQS subscriptions also need the SNS service (or the topic's role) to `kms:GenerateDataKey` / `kms:Decrypt` on the queue key.

> When a queue's KMS key changes, messages already in the queue remain encrypted under the previous key. Keep the old key available until those messages have been processed or drained.

---

## 6. SNS Topics — `NotificationInfraConstruct.ts` and `ObservabilityStack.ts`

Current behaviour

CDK: topics do not specify a customer-managed `masterKey`.

AWS: the topics use SNS's default encryption configuration. Confirm the deployed encryption mode before treating it as an AWS-managed KMS key.

| Topic | File |
| --- | --- |
| `{prefix}-notification-events` | `NotificationInfraConstruct.ts` |
| `{prefix}-alarms` | `ObservabilityStack.ts` |

To use a CMK

1. Create a topic key and set `masterKey` on the `sns.Topic`.

2. Grant encrypt/decrypt to publishers. For the alarm topic, CloudWatch must be allowed in the key policy (`cloudwatch.amazonaws.com`).

3. Grant decrypt to subscribers. For notification events, the SQS subscription needs SNS to encrypt for the queue (see section 5).

---

## 7. CloudWatch Logs — Lambda, VPC flow logs, AppSync

Current behaviour

CDK: log groups do not set `encryptionKey`.

AWS: CloudWatch Logs therefore uses the `aws/logs` AWS-managed KMS key.

- Lambda: `ObservabilityStack` `LogRetention` on `/aws/lambda/{functionName}`
- VPC flow logs: `NetworkResources.createFlowLogGroup()` (`LogGroup` without a KMS key)
- AppSync: `logConfig` on the GraphQL API (`AppSyncRealtimeConstruct.ts`) creates a service log group with the default key

To use a CMK

1. Create a logs key and configure its key policy to allow CloudWatch Logs to use it. AWS documents the required KMS permissions, including `kms:Encrypt`, `kms:Decrypt`, `kms:ReEncrypt*`, and `kms:GenerateDataKey*`; scope the policy to the log service with `kms:ViaService` where appropriate.

2. Set `encryptionKey` on the `LogGroup`. For `LogRetention`, you may need an explicit `LogGroup` first (or an L1 `KmsKeyId`), because `LogRetention` only sets retention.

3. VPC: pass the key into `new LogGroup(..., { encryptionKey: logsKey })`.

> CMK encryption cannot be added to some existing log groups in place; you may need a new log-group name.

---

## 8. Lambda environment variables — `ComputeStack.ts` (and other function constructs)

Current behaviour

CDK: `NodejsFunction` / `DockerImageFunction` omit `environmentEncryption`.

AWS: Lambda therefore encrypts environment variables with an AWS-managed KMS key by default. No secret values are stored in Lambda environment variables. For the activity-log pseudonym salt, the Admin and Audit functions receive only the secret's name (`WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID`) and reads the value with `GetSecretValue` at runtime, the same pattern as `DB_SECRET_ARN`.

To use a CMK

Set `environmentEncryption` on each function to a `kms.IKey` and grant the function role `kms:Decrypt`. Do not put secret values in Lambda environment variables (e.g. `secretValue.unsafeUnwrap()`): Lambda returns them in plaintext to any caller with `lambda:GetFunctionConfiguration`. `cdk/test/ComputeStack.activitySalt.test.ts` fails the build if any function environment contains a `{{resolve:secretsmanager:…}}` reference.

---

## 9. SSM Parameter Store — `AppConfigParameters.ts`, `NotificationInfraConstruct.ts`

Current behaviour

CDK: parameters are `StringParameter` (standard strings), not `SecureString`.

AWS: standard string parameters are not encrypted with a customer KMS key. The values are the display name, Bedrock model id, guardrail ids, and notification thresholds — not DB passwords.

To use a CMK

Convert sensitive parameters to SSM `SecureString` with `encryptionKey`, or keep secrets in Secrets Manager (already used for DB credentials). A standard `StringParameter` cannot attach a CMK.

---

## Validation after migration

After a CMK cutover, redeploy each stack affected by the encryption change (for example `npx cdk deploy wren-dev-Database`, `wren-dev-Compute`, `wren-dev-Cicd`, `wren-dev-Observability`, `wren-dev-Vpc`) and exercise secret reads, queue processing, image pulls, and alarm delivery to confirm every consumer has the required `kms:Decrypt` / `kms:GenerateDataKey` grants.

---

## Summary

The summary reflects the encryption configuration produced by the CDK. AWS-managed key aliases are included where the service has a documented default; for SQS, SNS, and ECR, confirm the deployed configuration where noted.

| Resource | Location | Current encryption | Customer-managed KMS migration |
| --- | --- | --- | --- |
| RDS storage | `DatabaseResources.ts` | AWS-managed KMS key (`aws/rds`) | `storageEncryptionKey` on `DatabaseInstance` |
| Secrets Manager (admin + 8 app roles + salt) | `DatabaseResources.ts`, `ComputeStack.ts` | AWS-managed KMS key (`aws/secretsmanager`) | `encryptionKey` on each `Secret`; `kms:Decrypt` on inline `GetSecretValue` roles |
| GitHub PAT / Amplify token | Operator-created secrets | AWS-managed KMS key (`aws/secretsmanager`) unless set | Console/CLI CMK + key policy for Pipeline/Amplify |
| CodePipeline artifacts | `CicdStack.ts` (implicit bucket) | SSE-S3 (S3-managed, AES-256) | Explicit bucket `BucketEncryption.KMS` + `encryptionKey`; pass `artifactBucket` |
| ECR `{prefix}-feedback-engine` | `CicdStack.ts` | Default AES-256 encryption | `encryption: KMS` + `encryptionKey` on `Repository`; confirm pull/push KMS grants |
| SQS (ingest, feedback, notifications + DLQs) | `ComputeStack.ts`, `NotificationInfraConstruct.ts` | Service-managed SSE-SQS | `encryptionMasterKey`; grant producers/consumers/SNS |
| SNS (notifications + alarms) | `NotificationInfraConstruct.ts`, `ObservabilityStack.ts` | SNS default encryption | `masterKey`; key policy for CloudWatch on alarms |
| CloudWatch Logs | Observability, VPC, AppSync | AWS-managed KMS key (`aws/logs`) | `encryptionKey` on `LogGroup` + logs service in key policy |
| Lambda env vars | Compute (and helpers) | AWS-managed KMS key | `environmentEncryption` |
| SSM String parameters | Config + notifications | Standard String (no CMK) | Use SecureString + key, or keep secrets in Secrets Manager |
| S3 documents/reference + DynamoDB | `StorageResources.ts` | Customer-managed KMS (storage CMK) | Already done |

---

## Related documents

- [Security overview](./security-overview.md) (encryption at rest)
- [Modification guide](./modification-guide.md) (encryption table)
- [Deployment guide](./deployment-guide.md)
- [CDK package](../cdk/README.md)
