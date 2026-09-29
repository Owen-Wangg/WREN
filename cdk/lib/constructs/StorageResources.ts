import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { Key } from "aws-cdk-lib/aws-kms";
import {
  AnyPrincipal,
  Effect,
  PolicyStatement,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  type LifecycleRule,
  StorageClass,
} from "aws-cdk-lib/aws-s3";
import { ReadWriteType, Trail } from "aws-cdk-lib/aws-cloudtrail";
import { Construct } from "constructs";
import { conversationTableName, type AppConfig } from "../config.js";
import { s3CorsAllowedOrigins } from "../corsOrigins.js";

export interface StorageResourcesProps {
  readonly config: AppConfig;
}

/**
 * Object + key-value persistence layer.
 *
 *   - Two S3 buckets (submitted documents, Reference Material) with
 *     block-public-access, enforced SSL, KMS encryption, versioning, and
 *     lifecycle rules (REQ-SEC-PII-01, steering).
 *   - A DynamoDB table for Ask-WREN conversation/session state, named
 *     `${StackPrefix}-ConversationHistory` (PK `sessionId`, `ttl` attribute).
 *     The table name is scoped to `StackPrefix` only and carries NO brand or
 *     application name.
 *   - A CloudTrail data-event trail scoped to the two PII buckets, delivering
 *     object-level read/write audit records to a dedicated, lifecycle-expired
 *     log bucket for incident forensics (finding S-5).
 *
 * All resources are at-rest encrypted and retained on stack teardown so
 * personal data is never silently destroyed. Per the CDK steering the props
 * are saved as a private field and resources are created in protected methods.
 */
export class StorageResources extends Construct {
  public readonly encryptionKey: Key;
  public readonly documentsBucket: Bucket;
  public readonly referenceBucket: Bucket;
  public readonly conversationTable: Table;
  public readonly auditLogBucket: Bucket;
  public readonly auditTrail: Trail;

  private readonly props: StorageResourcesProps;

  constructor(scope: Construct, id: string, props: StorageResourcesProps) {
    super(scope, id);
    this.props = props;

    this.encryptionKey = this.createEncryptionKey();
    this.documentsBucket = this.createBucket("Documents");
    this.documentsBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "AllowTextractReadDocuments",
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("textract.amazonaws.com")],
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: [this.documentsBucket.arnForObjects("*")],
        conditions: {
          StringEquals: { "aws:SourceAccount": Stack.of(this).account },
        },
      }),
    );
    // Defense-in-depth: enforce SSE-KMS on every upload regardless of the
    // presign env var (finding S-4). StringNotEquals also denies PutObject
    // that omits the header entirely, so the encryption invariant no longer
    // rests solely on bucket default encryption. The CMK id is intentionally
    // not pinned — requiring aws:kms is enough and avoids coupling the policy
    // to the key's lifecycle.
    this.documentsBucket.addToResourcePolicy(
      new PolicyStatement({
        sid: "DenyUnencryptedDocumentUploads",
        effect: Effect.DENY,
        principals: [new AnyPrincipal()],
        actions: ["s3:PutObject"],
        resources: [this.documentsBucket.arnForObjects("*")],
        conditions: {
          StringNotEquals: { "s3:x-amz-server-side-encryption": "aws:kms" },
        },
      }),
    );
    this.referenceBucket = this.createBucket("Reference");
    this.conversationTable = this.createConversationTable();

    const trail = this.createObjectAccessTrail();
    this.auditLogBucket = trail.auditLogBucket;
    this.auditTrail = trail.auditTrail;
  }

  protected createEncryptionKey(): Key {
    return new Key(this, "EncryptionKey", {
      description: `${this.props.config.stackPrefix} storage encryption key (S3 + DynamoDB).`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  protected lifecycleRules(): LifecycleRule[] {
    return [
      {
        id: "AbortIncompleteMultipartUploads",
        abortIncompleteMultipartUploadAfter: Duration.days(7),
      },
      {
        id: "ExpireOrphanedDocumentUploads",
        // Staging keys from POST /v1/uploads/presign. Tag is cleared when the
        // object is attached to a document/draft so retained originals survive.
        expiration: Duration.days(1),
        tagFilters: { "orphan-upload": "true" },
      },
      {
        id: "TransitionNoncurrentToInfrequentAccess",
        noncurrentVersionTransitions: [
          {
            storageClass: StorageClass.INFREQUENT_ACCESS,
            transitionAfter: Duration.days(30),
          },
        ],
        noncurrentVersionExpiration: Duration.days(365),
      },
    ];
  }

  protected createBucket(name: "Documents" | "Reference"): Bucket {
    return new Bucket(this, `${name}Bucket`, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.KMS,
      encryptionKey: this.encryptionKey,
      bucketKeyEnabled: true,
      versioned: true,
      lifecycleRules: this.lifecycleRules(),
      removalPolicy: RemovalPolicy.RETAIN,
      // Documents: browser POST via presigned URL (create/ingest flow).
      // Reference material is uploaded by the Admin Lambda (PutObject), not
      // the browser — no CORS on that bucket.
      ...(name === "Documents"
        ? {
            cors: [
              {
                allowedMethods: [HttpMethods.PUT, HttpMethods.POST, HttpMethods.GET, HttpMethods.HEAD],
                allowedOrigins: s3CorsAllowedOrigins(this.props.config),
                // Scoped to the headers an upload actually needs instead of "*"
                // (finding S-7). The current flow is a multipart POST, which
                // sends only Content-Type (the SSE / tagging values ride as
                // form fields, not headers); the x-amz-* SSE headers and
                // x-amz-tagging are pre-authorized so a future presigned-PUT
                // flow works without loosening CORS again.
                allowedHeaders: [
                  "Content-Type",
                  "x-amz-server-side-encryption",
                  "x-amz-server-side-encryption-aws-kms-key-id",
                  "x-amz-server-side-encryption-bucket-key-enabled",
                  "x-amz-tagging",
                ],
                exposedHeaders: ["ETag"],
                maxAge: 3000,
              },
            ],
          }
        : {}),
    });
  }

  protected createConversationTable(): Table {
    return new Table(this, "ConversationHistory", {
      tableName: conversationTableName(this.props.config),
      partitionKey: { name: "sessionId", type: AttributeType.STRING },
      timeToLiveAttribute: "ttl",
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: this.encryptionKey,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }

  /**
   * Object-level audit trail for the two PII buckets (finding S-5). A
   * CloudTrail data-event selector scoped to the Documents and Reference
   * bucket ARNs records every object read/write, giving incident forensics a
   * "who accessed what" trail that S3 default encryption + TLS alone cannot.
   *
   * Records land in a DEDICATED log bucket (never one of the PII buckets),
   * lifecycle-expired at 90 days and retained on teardown — matching the
   * CloudFront access-log bucket. The log bucket uses S3-managed encryption:
   * it matches that precedent and avoids the CloudTrail KMS key-policy
   * coupling, while still encrypting the logs at rest.
   *
   * Management events are disabled (`ReadWriteType.NONE` +
   * `includeManagementEvents: false`) so the trail carries data events only,
   * and the trail is single-region (data events are regional) to keep scope
   * and cost tight. File-log integrity validation is enabled.
   */
  protected createObjectAccessTrail(): {
    auditLogBucket: Bucket;
    auditTrail: Trail;
  } {
    const auditLogBucket = new Bucket(this, "AuditLogBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: "ExpireObjectAccessLogs",
          expiration: Duration.days(90),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const auditTrail = new Trail(this, "DataEventTrail", {
      bucket: auditLogBucket,
      managementEvents: ReadWriteType.NONE,
      enableFileValidation: true,
      isMultiRegionTrail: false,
      includeGlobalServiceEvents: false,
    });

    auditTrail.addS3EventSelector(
      [
        { bucket: this.documentsBucket },
        { bucket: this.referenceBucket },
      ],
      {
        readWriteType: ReadWriteType.ALL,
        includeManagementEvents: false,
      },
    );

    return { auditLogBucket, auditTrail };
  }
}
