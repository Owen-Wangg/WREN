import { Duration, RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { Key } from "aws-cdk-lib/aws-kms";
import {
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
      }),
    );
    this.referenceBucket = this.createBucket("Reference");
    this.conversationTable = this.createConversationTable();
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
                allowedHeaders: ["*"],
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
}
