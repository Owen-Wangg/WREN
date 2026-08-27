# AWS Managed Keys Usage

This document lists every place in the WREN CDK app where encryption uses an **AWS managed key** (or SSE-S3 / SSE-SQS / SSE-SNS service defaults) rather than a **customer-managed KMS key (CMK)**, and the code changes required to bring your own key.

The product display name is **LEON**. AWS resources and this repository use the prefix **WREN**. There is **no Glue job** in this project.

**Already on a CMK (not covered as migrations below):** documents S3 bucket, reference S3 bucket, and the Ask WREN DynamoDB `ConversationHistory` table. Those use the storage key in `cdk/lib/constructs/StorageResources.ts` (`enableKeyRotation: true`, `RemovalPolicy.RETAIN`). Compute already calls `storageEncryptionKey.grantEncryptDecrypt` for Document, Admin, and Feedback Orchestrator.

---

## 1. RDS Instance — `cdk/lib/constructs/DatabaseResources.ts`

**Current behaviour**

`storageEncrypted: true` is set on `DatabaseInstance` without `storageEncryptionKey`. AWS encrypts the EBS volume with the AWS managed key for RDS (`aws/rds`). Performance Insights is **not** enabled, so there is no Performance Insights encryption setting today.

```ts
// cdk/lib/constructs/DatabaseResources.ts
return new DatabaseInstance(this, "Instance", {
  ...
  storageEncrypted: true, // uses aws/rds managed key
  deletionProtection: true,
  ...
});
```

**To use a CMK**

1. Create a dedicated key, or reuse the storage CMK from `StorageStack` (pass it into `DatabaseStack` / `DatabaseResources` — it is not wired today):

   ```ts
   import * as kms from "aws-cdk-lib/aws-kms";

   const rdsKey = new kms.Key(this, "RdsEncryptionKey", {
     enableKeyRotation: true,
     description: "CMK for RDS storage encryption",
     removalPolicy: RemovalPolicy.RETAIN,
   });
   ```

2. Set `storageEncryptionKey` on the instance (keep `storageEncrypted: true`):

   ```ts
   return new DatabaseInstance(this, "Instance", {
     ...
     storageEncrypted: true,
     storageEncryptionKey: rdsKey,
     ...
   });
   ```

3. If you later enable Performance Insights, also set `performanceInsightEncryptionKey` (same key or a dedicated one). The RDS service-linked role needs `kms:CreateGrant` / encrypt-decrypt on the key; CDK usually adds this when `storageEncryptionKey` is a `Key` construct you own.

Changing the RDS encryption key on an **existing** instance requires a snapshot restore (or a new instance). Plan a migration window; `RemovalPolicy.RETAIN` will not rewrite encryption in place.

---

## 2. Secrets Manager Secrets — `DatabaseResources.ts` and `ComputeStack.ts`

**Current behaviour**

CDK-created `secretsmanager.Secret` resources omit `encryptionKey`. Secrets Manager encrypts them with `aws/secretsmanager`.

| Secret | File | Construct / name |
| --- | --- | --- |
| RDS admin (`dbadmin`) | `DatabaseResources.ts` | `Credentials.fromGeneratedSecret` → `{prefix}/database/credentials` |
| Per-role DB passwords (×8) | `DatabaseResources.ts` | `{prefix}/database/{role}` for each `APP_DB_ROLES` entry |
| Activity-log pseudonym salt | `ComputeStack.ts` | `ActivityPseudonymSalt` → `{prefix}/audit/pseudonym-salt` |

`APP_DB_ROLES` (`cdk/lib/appDbRoles.ts`): `wren_authorizer`, `wren_appsync_auth`, `wren_document`, `wren_admin`, `wren_audit`, `wren_feedback_orch`, `wren_feedback_engine`, `wren_notification`.

GitHub tokens are **not** created by CDK. Operators put them in Secrets Manager; if those secrets also omit a CMK, they use `aws/secretsmanager` as well:

| Secret | Used by |
| --- | --- |
| `{prefix}/cicd/github-pat` | `CicdStack` CodePipeline GitHub source |
| `{prefix}/github/token` | `AmplifyStack` GitHub source |

```ts
// Example — same pattern for generated DB secrets and the salt
secrets[role] = new secretsmanager.Secret(this, `AppUserSecret${...}`, {
  secretName: `${this.props.config.stackPrefix}/database/${role}`,
  // no encryptionKey — uses aws/secretsmanager
  ...
});
```

**To use a CMK**

1. Create a key (one shared secrets key is typical):

   ```ts
   const secretsKey = new kms.Key(this, "SecretsEncryptionKey", {
     enableKeyRotation: true,
     description: "CMK for Secrets Manager secrets",
   });
   ```

2. Pass `encryptionKey: secretsKey` on every CDK `Secret`, and on `Credentials.fromGeneratedSecret` via its `encryptionKey` option if you use the generated admin secret.

3. **IAM:** several roles use **inline** `secretsmanager:GetSecretValue` rather than `secret.grantRead`. Those do **not** pick up `kms:Decrypt` automatically:

   | Caller | File |
   | --- | --- |
   | Each Compute Lambda (`grantDatabaseAccess`) | `ComputeStack.ts` |
   | Password sync custom resource | `DbPasswordSync.ts` |
   | Migration runner | `MigrationRunner.ts` |

   Add `secretsKey.grantDecrypt(...)` on those functions (and on RDS Proxy’s secret-access role if CDK does not already attach it). Prefer `secret.grantRead(fn)` after `encryptionKey` is set so KMS is included.

4. For GitHub PAT / Amplify token secrets created in the console or CLI, set the secret’s KMS key there and add a key-policy statement for `codepipeline.amazonaws.com`, CodePipeline’s role, and Amplify’s service-linked role (`amplify.amazonaws.com`) as required.

5. `CicdStack`’s Compute CloudFormation deploy role already has a broad `KmsUseExistingStorageKey` statement (`kms:Decrypt` on `*`). Tighten that to the secrets/storage key ARNs if you introduce more CMKs.

---

## 3. S3 — CodePipeline artifact bucket — `cdk/lib/stacks/CicdStack.ts`

**Current behaviour**

`new codepipeline.Pipeline(...)` does **not** pass `artifactBucket`. CDK creates a default artifact bucket with **SSE-S3** (`AES256` / `aws/s3`). This app does **not** define export buckets (those exist only in other products).

Application document/reference buckets already use SSE-KMS with the storage CMK (`StorageResources.ts`). Do not change those to SSE-S3.

**To use a CMK**

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

The CDK **bootstrap** asset bucket (`cdk-hnb659fds-assets-…`) is created by `cdk bootstrap`, not this app. Changing its encryption is a bootstrap/KMS customisation, not a stack edit in `CicdStack`.

---

## 4. ECR Repository — `cdk/lib/stacks/CicdStack.ts`

**Current behaviour**

One repository: `{prefix}-feedback-engine`. No `encryption` / `encryptionKey`, so ECR uses AES-256 with `aws/ecr`.

```ts
this.ecrRepository = new ecr.Repository(this, "FeedbackEngineRepo", {
  repositoryName: `${config.stackPrefix}-feedback-engine`,
  imageScanOnPush: true,
  // no encryptionKey — uses aws/ecr
  ...
});
```

**To use a CMK**

1. Create an ECR key and set `encryption: ecr.RepositoryEncryption.KMS` plus `encryptionKey` (CDK API: `encryptionKey` on `Repository`).

2. Grant encrypt/decrypt to the CodeBuild build role (`grantPullPush` does not replace KMS). Grant **decrypt** to:

   - the UpdateLambda CodeBuild role (`grantPull`)
   - the Feedback Engine Lambda execution role (image pull at start)
   - `lambda.amazonaws.com` if you rely on a repository policy for pull

Existing images stay on the old encryption until they are **pushed again** after the repo encryption change (or you recreate the repo).

---

## 5. SQS Queues — `ComputeStack.ts` and `NotificationInfraConstruct.ts`

**Current behaviour**

Queues are created without `encryptionMasterKey`. SQS uses SSE-SQS (`aws/sqs`).

| Queue | File |
| --- | --- |
| `DocumentIngestQueue` / `DocumentIngestDlq` | `ComputeStack.ts` |
| `FeedbackQueue` / `FeedbackDlq` | `ComputeStack.ts` |
| `NotificationQueue` / `NotificationDLQ` | `NotificationInfraConstruct.ts` |

**To use a CMK**

1. Create a queue key (or one key per domain: ingest / feedback / notifications).

2. Set `encryptionMasterKey` on **both** the main queue and its DLQ:

   ```ts
   this.feedbackDlq = new sqs.Queue(this, "FeedbackDlq", {
     ...
     encryptionMasterKey: queueKey,
   });

   this.feedbackQueue = new sqs.Queue(this, "FeedbackQueue", {
     ...
     encryptionMasterKey: queueKey,
   });
   ```

3. Grant encrypt/decrypt to every producer and consumer:

   - Ingest: Document Lambda (send + consume)
   - Feedback: Orchestrator (send), Feedback Engine (receive)
   - Notifications: publishers (`grantPublish` on SNS is not enough once SQS is KMS-encrypted), Notification Lambda (consume)

SNS→SQS subscriptions need the **SNS service** (or the topic’s role) to `kms:GenerateDataKey` / `kms:Decrypt` on the **queue** key as well.

---

## 6. SNS Topics — `NotificationInfraConstruct.ts` and `ObservabilityStack.ts`

**Current behaviour**

Topics omit `masterKey`. SNS uses `aws/sns`.

| Topic | File |
| --- | --- |
| `{prefix}-notification-events` | `NotificationInfraConstruct.ts` |
| `{prefix}-alarms` | `ObservabilityStack.ts` |

**To use a CMK**

1. Create a topic key and set `masterKey` on the `sns.Topic`.

2. Grant encrypt/decrypt to publishers (Notification Lambda / other producers, CloudWatch for the alarm topic — CloudWatch must be allowed in the **key policy**: `cloudwatch.amazonaws.com` or the alarms service).

3. Grant decrypt to subscribers. For notification events, the SQS subscription needs SNS to encrypt for the queue (see section 5).

---

## 7. CloudWatch Logs — Lambda, VPC flow logs, AppSync

**Current behaviour**

Log groups do not set `encryptionKey`. CloudWatch Logs uses `aws/logs`.

- Lambda: `ObservabilityStack` `LogRetention` on `/aws/lambda/{functionName}`
- VPC flow logs: `NetworkResources.createFlowLogGroup()` (`LogGroup` without a KMS key)
- AppSync: `logConfig` on the GraphQL API (`AppSyncRealtimeConstruct.ts`) creates a service log group with the default key

**To use a CMK**

1. Create a logs key. The key policy must allow `logs.{region}.amazonaws.com` to `kms:Encrypt`, `kms:Decrypt`, `kms:ReEncrypt*`, `kms:GenerateDataKey*`, and `kms:DescribeKey` (AWS requirement for log-group CMKs).

2. On a `LogGroup`, set `encryptionKey`. For `LogRetention`, you may need an explicit `LogGroup` first, or an L1 `KmsKeyId` on the log group, because `LogRetention` only sets retention.

3. VPC: pass that key into `new LogGroup(..., { encryptionKey: logsKey })`.

CMK encryption cannot be added to some **existing** log groups in place; you may need a new log group name.

---

## 8. Lambda environment variables — `ComputeStack.ts` (and other function constructs)

**Current behaviour**

`NodejsFunction` / `DockerImageFunction` omit `environmentEncryption`. Lambda encrypts environment variables with an AWS-owned key (not a customer CMK). The activity-log salt is injected from Secrets Manager into `WREN_ACTIVITY_PSEUDONYM_SALT` at deploy time.

**To use a CMK**

Set `environmentEncryption` on each function to a `kms.IKey`, and grant the function role `kms:Decrypt`. Prefer reading the salt via `GetSecretValue` at runtime instead of `secretValue.unsafeUnwrap()` in the template if you are tightening encryption of env vars.

---

## 9. SSM Parameter Store — `AppConfigParameters.ts`, `NotificationInfraConstruct.ts`

**Current behaviour**

Parameters are `StringParameter` (standard strings), not `SecureString`. They are not encrypted with a customer KMS key. Values are display name, Bedrock model id, guardrail ids, and notification thresholds — not DB passwords.

**To use a CMK**

Convert sensitive parameters to SSM `SecureString` with `encryptionKey`, or keep secrets in Secrets Manager (already used for DB credentials). Standard `StringParameter` cannot attach a CMK.

---

## Out of scope / not present

| Item | Notes |
| --- | --- |
| Glue job / Glue security configuration | Not in this repository |
| Export S3 buckets / export SQS | Not in this repository |
| Cognito User Pool | No customer KMS key in CDK; Cognito manages pool data encryption |
| API Gateway | In-transit TLS; method settings do not introduce a data-plane CMK |
| Bedrock Guardrail (`CfnGuardrail` in Config) | Prompt-attack config; not a KMS-encrypted data store |
| S3 documents + reference + DynamoDB conversations | **Already CMK** (`StorageResources`) |

---

## Summary

| Resource | Location | AWS managed / default key | Property / change for CMK |
| --- | --- | --- | --- |
| RDS storage | `DatabaseResources.ts` | `aws/rds` | `storageEncryptionKey` on `DatabaseInstance` |
| Secrets Manager (admin + 8 app roles + salt) | `DatabaseResources.ts`, `ComputeStack.ts` | `aws/secretsmanager` | `encryptionKey` on each `Secret`; `kms:Decrypt` on inline `GetSecretValue` roles |
| GitHub PAT / Amplify token | Operator-created secrets | `aws/secretsmanager` unless set | Console/CLI CMK + key policy for Pipeline/Amplify |
| CodePipeline artifacts | `CicdStack.ts` (implicit bucket) | SSE-S3 (`aws/s3`) | Explicit bucket `BucketEncryption.KMS` + `encryptionKey`; pass `artifactBucket` |
| ECR `{prefix}-feedback-engine` | `CicdStack.ts` | `aws/ecr` | `encryptionKey` on `Repository`; grant build/Lambda/pull |
| SQS (ingest, feedback, notifications + DLQs) | `ComputeStack.ts`, `NotificationInfraConstruct.ts` | SSE-SQS (`aws/sqs`) | `encryptionMasterKey`; grant producers/consumers/SNS |
| SNS (notifications + alarms) | `NotificationInfraConstruct.ts`, `ObservabilityStack.ts` | `aws/sns` | `masterKey`; key policy for CloudWatch on alarms |
| CloudWatch Logs | Observability, VPC, AppSync | `aws/logs` | `encryptionKey` on `LogGroup` + logs service in key policy |
| Lambda env vars | Compute (and helpers) | AWS-owned Lambda key | `environmentEncryption` |
| SSM String parameters | Config + notifications | Not CMK | Use SecureString + key, or keep secrets in Secrets Manager |
| S3 documents/reference + DynamoDB | `StorageResources.ts` | **Customer CMK** | Already done |

After any CMK cutover, redeploy the owning stack (`npx cdk deploy wren-dev-Database`, `wren-dev-Compute`, `wren-dev-CICD`, `wren-dev-Observability`, `wren-dev-Vpc` as needed) and exercise secret reads, queue processing, image pulls, and alarm delivery.

---

## Related documents

- [Security overview](./security-overview.md) (encryption at rest)
- [Modification guide](./modification-guide.md) (encryption table)
- [Deployment guide](./deployment-guide.md)
- [CDK package](../cdk/README.md)
