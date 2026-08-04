import * as path from "path";
import { Stack, type StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { Construct } from "constructs";

import { AppSyncRealtimeConstruct } from "../constructs/AppSyncRealtimeConstruct";

import type { AppConfig } from "../config";

/**
 * Props for the Compute stack. Receives concrete VPC and resource identifiers
 * from foundational stacks (per CDK steering: constructs receive concrete
 * objects, stacks resolve from SSM/lookup).
 */
export interface ComputeStackProps extends StackProps {
  readonly config: AppConfig;
  readonly vpc: ec2.IVpc;
  /** RDS Proxy endpoint hostname (from Database stack via SSM). */
  readonly databaseProxyEndpoint: string;
  /** ARN of the Secrets Manager secret holding DB credentials. */
  readonly databaseSecretArn: string;
  /** S3 bucket name for submitted documents. */
  readonly documentsBucketName: string;
  /** S3 bucket name for reference materials. */
  readonly referenceBucketName: string;
  /** KMS key encrypting the documents / reference buckets (SSE-KMS). */
  readonly storageEncryptionKey: IKey;
  /** DynamoDB conversation table name. */
  readonly conversationTableName: string;
  /** Cognito User Pool ID (from Cognito stack). */
  readonly userPoolId: string;
  /** Cognito User Pool Client ID (from Cognito stack). */
  readonly userPoolClientId: string;
  /** Bedrock Guardrail ID for admin prompt injection detection. */
  readonly promptGuardrailId: string;
}

/**
 * `${StackPrefix}-Compute` — All service Lambda functions.
 *
 * Maps the design's subsystem→compute assignments:
 *   - Document/Draft Lambda (Node 22): ingestion, extraction, draft versioning
 *   - Authorizer Lambda (Node 22): Cognito JWT verification + app-DB mapping
 *   - Admin/Config/Auth/Usage Lambda (Node 22): transactional Postgres writes
 *   - Audit Lambda (Node 22): activity log + aggregate analytics
 *   - Feedback Orchestrator Lambda (Node 22): enqueues feedback jobs to SQS
 *   - Feedback Engine Lambda (Python 3.12, container): AI workload via Bedrock
 *   - Diff/Anchor/Progress Lambda (Python 3.12): pure-logic diff/resolution
 *
 * Each function has its own scoped IAM role (least-privilege). The Feedback
 * Engine is fronted by an SQS queue + DLQ for async execution with graceful
 * degradation under overload (REQ-NFR-SCALE-01 criterion 3).
 *
 * Requirements: 47.1 (scale compute), 47.2 (auto-scale), 47.3 (queue/throttle)
 */
export class ComputeStack extends Stack {
  public readonly authorizerFunction: lambda.Function;
  public readonly documentFunction: lambda.Function;
  public readonly adminFunction: lambda.Function;
  public readonly auditFunction: lambda.Function;
  public readonly feedbackOrchestratorFunction: lambda.Function;
  public readonly feedbackEngineFunction: lambda.Function;
  public readonly diffAnchorProgressFunction: lambda.Function;
  public readonly feedbackQueue: sqs.Queue;
  public readonly feedbackDlq: sqs.Queue;
  public readonly documentIngestQueue: sqs.Queue;
  public readonly documentIngestDlq: sqs.Queue;
  public readonly appSyncGraphqlUrl: string;
  public readonly appSyncAuthorizerFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { config, vpc } = props;

    // Select private subnets for data-plane Lambdas (security steering).
    const privateSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    // Shared environment variables for Node Lambdas that access the DB.
    // Note: @wren/db-node reads DB_SECRET_ARN and DB_PROXY_HOST, not DATABASE_*.
    const dbEnv = {
      DB_PROXY_HOST: props.databaseProxyEndpoint,
      DB_SECRET_ARN: props.databaseSecretArn,
      NODE_OPTIONS: "--enable-source-maps",
    };

    // Shared bundling config: workspace packages are resolved from the monorepo
    // root node_modules (npm workspaces hoist them there). esbuild runs from the
    // monorepo root so it naturally resolves @wren/* via the workspace symlinks.
    const monorepoRoot = path.join(__dirname, "../../..");
    const sharedBundling: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: true,
      target: "node22",
    };

    // -----------------------------------------------------------------------
    // Lambda Authorizer (Node 22)
    // -----------------------------------------------------------------------
    this.authorizerFunction = new lambdaNodejs.NodejsFunction(this, "AuthorizerFn", {
      functionName: `${config.stackPrefix}-authorizer`,
      entry: path.join(monorepoRoot, "backend/auth/src/authorizer.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
      },
      bundling: sharedBundling,
    });

    // -----------------------------------------------------------------------
    // Document / Draft Service Lambda (Node 22)
    // -----------------------------------------------------------------------
    this.documentFunction = new lambdaNodejs.NodejsFunction(this, "DocumentFn", {
      functionName: `${config.stackPrefix}-document`,
      entry: path.join(monorepoRoot, "backend/document/src/lambda-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      // Textract OCR needs headroom for multi-page PDF analysis.
      // PDF ingest is async via SQS so API Gateway's ~29s sync cap does not
      // abort large OCR jobs — the worker uses this full timeout.
      memorySize: 2048,
      timeout: Duration.minutes(3),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv,
        DOCUMENTS_BUCKET_NAME: props.documentsBucketName,
        PDF_OCR_ENABLED: "true",
        // Textract is the sole OCR engine — no LiteParse/Tesseract.
        PDF_OCR_ENGINE: "textract",
        CONVERSATION_TABLE_NAME: props.conversationTableName,
      },
      bundling: sharedBundling,
    });

    // -----------------------------------------------------------------------
    // Document ingest queue (async PDF OCR via Textract)
    // -----------------------------------------------------------------------
    this.documentIngestDlq = new sqs.Queue(this, "DocumentIngestDlq", {
      queueName: `${config.stackPrefix}-document-ingest-dlq`,
      retentionPeriod: Duration.days(14),
    });

    this.documentIngestQueue = new sqs.Queue(this, "DocumentIngestQueue", {
      queueName: `${config.stackPrefix}-document-ingest-queue`,
      // Must exceed DocumentFn timeout so in-flight OCR is not redelivered early.
      visibilityTimeout: Duration.minutes(4),
      deadLetterQueue: {
        queue: this.documentIngestDlq,
        maxReceiveCount: 3,
      },
    });

    this.documentFunction.addEnvironment(
      "DOCUMENT_INGEST_QUEUE_URL",
      this.documentIngestQueue.queueUrl,
    );
    this.documentIngestQueue.grantSendMessages(this.documentFunction);
    this.documentFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(this.documentIngestQueue, {
        batchSize: 1,
        maxConcurrency: 5,
      }),
    );

    // -----------------------------------------------------------------------
    // Admin / Config / Auth / Usage Service Lambda (Node 22)
    // -----------------------------------------------------------------------
    this.adminFunction = new lambdaNodejs.NodejsFunction(this, "AdminFn", {
      functionName: `${config.stackPrefix}-admin`,
      entry: path.join(monorepoRoot, "backend/admin/src/lambda-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv,
        REFERENCE_BUCKET_NAME: props.referenceBucketName,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        COGNITO_USER_POOL_ID: props.userPoolId,
        PROMPT_GUARDRAIL_ID: props.promptGuardrailId,
        PROMPT_GUARDRAIL_VERSION: "DRAFT",
      },
      bundling: sharedBundling,
    });

    // -----------------------------------------------------------------------
    // Audit / Activity-Log / Analytics Service Lambda (Node 22)
    // -----------------------------------------------------------------------
    this.auditFunction = new lambdaNodejs.NodejsFunction(this, "AuditFn", {
      functionName: `${config.stackPrefix}-audit`,
      entry: path.join(monorepoRoot, "backend/admin/src/lambda-audit.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(15),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv,
        WREN_ACTIVITY_PSEUDONYM_SALT: `/${config.stackPrefix}/audit/pseudonym-salt`,
      },
      bundling: sharedBundling,
    });

    // -----------------------------------------------------------------------
    // Feedback DLQ + Queue (SQS — async job execution, REQ-NFR-SCALE-01)
    // -----------------------------------------------------------------------
    this.feedbackDlq = new sqs.Queue(this, "FeedbackDlq", {
      queueName: `${config.stackPrefix}-feedback-dlq`,
      retentionPeriod: Duration.days(14),
    });

    this.feedbackQueue = new sqs.Queue(this, "FeedbackQueue", {
      queueName: `${config.stackPrefix}-feedback-queue`,
      visibilityTimeout: Duration.seconds(300), // Must exceed engine timeout
      deadLetterQueue: {
        queue: this.feedbackDlq,
        maxReceiveCount: 3, // Retry up to 3 times before DLQ
      },
    });

    // -----------------------------------------------------------------------
    // Feedback Orchestrator Lambda (Node 22) — enqueues to SQS, returns job id
    // -----------------------------------------------------------------------
    this.feedbackOrchestratorFunction = new lambdaNodejs.NodejsFunction(this, "FeedbackOrchestratorFn", {
      functionName: `${config.stackPrefix}-feedback-orchestrator`,
      entry: path.join(monorepoRoot, "backend/feedback/src/lambda-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      // Ask WREN invokes Bedrock synchronously on this Lambda.
      timeout: Duration.seconds(60),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv,
        FEEDBACK_QUEUE_URL: this.feedbackQueue.queueUrl,
        CONVERSATION_TABLE_NAME: props.conversationTableName,
        BEDROCK_MODEL_ID: config.bedrockModelId,
      },
      bundling: sharedBundling,
    });
    this.feedbackQueue.grantSendMessages(this.feedbackOrchestratorFunction);

    // -----------------------------------------------------------------------
    // Feedback Engine Lambda (Python 3.12, container — AI workload via Bedrock)
    // -----------------------------------------------------------------------
    const feedbackEngineRepo = ecr.Repository.fromRepositoryName(
      this,
      "FeedbackEngineRepo",
      `${config.stackPrefix}-feedback-engine`,
    );

    this.feedbackEngineFunction = new lambda.Function(this, "FeedbackEngineFn", {
      functionName: `${config.stackPrefix}-feedback-engine`,
      runtime: lambda.Runtime.FROM_IMAGE,
      code: lambda.Code.fromEcrImage(feedbackEngineRepo, {
        tagOrDigest: "bootstrap",
      }),
      handler: lambda.Handler.FROM_IMAGE,
      memorySize: 1024,
      timeout: Duration.minutes(5), // AI workload — generous timeout
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        DB_PROXY_HOST: props.databaseProxyEndpoint,
        DB_SECRET_ARN: props.databaseSecretArn,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        REFERENCE_BUCKET_NAME: props.referenceBucketName,
        DOCUMENTS_BUCKET_NAME: props.documentsBucketName,
      },
    });
    // SQS event source: the engine is triggered by messages on the feedback queue.
    this.feedbackEngineFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(this.feedbackQueue, {
        batchSize: 1, // Process one feedback request at a time
        maxConcurrency: 10, // Limit concurrent engine invocations
      }),
    );

    // -----------------------------------------------------------------------
    // Diff / Anchor / Progress Lambda (Python 3.12 — pure logic)
    // -----------------------------------------------------------------------
    this.diffAnchorProgressFunction = new lambda.Function(this, "DiffAnchorProgressFn", {
      functionName: `${config.stackPrefix}-diff-anchor-progress`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambda/diff-anchor-progress")),
      memorySize: 512,
      timeout: Duration.seconds(60),
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        DB_PROXY_HOST: props.databaseProxyEndpoint,
        DB_SECRET_ARN: props.databaseSecretArn,
      },
    });

    // -----------------------------------------------------------------------
    // AppSync Lambda authorizer (Node 22)
    // Same two-step pattern as the REST authorizer: Cognito JWT → DB identity
    // + ownership check. Deployed separately so it can be tuned independently.
    // -----------------------------------------------------------------------
    this.appSyncAuthorizerFunction = new lambdaNodejs.NodejsFunction(this, "AppSyncAuthorizerFn", {
      functionName: `${config.stackPrefix}-appsync-authorizer`,
      entry: path.join(monorepoRoot, "backend/auth/src/appSyncAuthorizer.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        // AppSync Lambda auth uses the Cognito idToken (not accessToken).
        // The frontend sends the idToken in the Authorization header per the
        // AppSync @aws_lambda auth convention.
        COGNITO_TOKEN_USE: 'id',
      },
      bundling: sharedBundling,
    });

    // DB secret access — same grant pattern as the REST authorizer.
    this.appSyncAuthorizerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [props.databaseSecretArn],
    }));

    // -----------------------------------------------------------------------
    // AppSync real-time API — debrief-ready notifications
    // -----------------------------------------------------------------------
    const appSyncRealtime = new AppSyncRealtimeConstruct(this, "AppSyncRealtime", {
      authorizerFunction: this.appSyncAuthorizerFunction,
      feedbackEngineRole: this.feedbackEngineFunction.role!,
      stackPrefix: config.stackPrefix,
    });
    this.appSyncGraphqlUrl = appSyncRealtime.graphqlUrl;

    // Inject the AppSync endpoint into the Feedback Engine so it can publish
    // the debriefReady mutation after writing feedback_item rows.
    this.feedbackEngineFunction.addEnvironment("APPSYNC_URL", appSyncRealtime.graphqlUrl);

    // -----------------------------------------------------------------------
    // IAM: scoped roles — each function gets only what it needs
    // -----------------------------------------------------------------------
    this.grantDatabaseAccess([
      this.authorizerFunction,
      this.documentFunction,
      this.adminFunction,
      this.auditFunction,
      this.feedbackOrchestratorFunction,
      this.feedbackEngineFunction,
      this.diffAnchorProgressFunction,
    ], props.databaseSecretArn);

    // Authorizer: look up Cognito email/name when auto-provisioning app_user on first login.
    this.authorizerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["cognito-idp:AdminGetUser"],
      resources: [
        `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`,
      ],
    }));

    // Document Lambda: S3 read/write for document uploads + presigned URLs.
    this.documentFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:DeleteObjects"],
      resources: [`arn:aws:s3:::${props.documentsBucketName}/*`],
    }));
    // Amazon Textract OCR (LAYOUT + TABLES analysis).
    this.documentFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "textract:AnalyzeDocument",
        "textract:StartDocumentAnalysis",
        "textract:GetDocumentAnalysis",
        // Legacy detect APIs kept for compatibility if rolled back.
        "textract:DetectDocumentText",
        "textract:StartDocumentTextDetection",
        "textract:GetDocumentTextDetection",
      ],
      resources: ["*"],
    }));
    props.storageEncryptionKey.grantEncryptDecrypt(this.documentFunction);

    // Document Lambda: DynamoDB DeleteItem to clean up conversation sessions on document deletion
    // (REQ-AUDIT-RETENTION-01 criterion 1 / REQ-AUDIT-OPSTATE-01 criterion 4).
    this.documentFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["dynamodb:DeleteItem"],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.conversationTableName}`,
      ],
    }));

    // Admin Lambda: S3 read/write for reference material uploads.
    this.adminFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      resources: [`arn:aws:s3:::${props.referenceBucketName}/*`],
    }));
    props.storageEncryptionKey.grantEncryptDecrypt(this.adminFunction);

    // Admin Lambda: Cognito ListUsersInGroup for the sync-cognito-admins script.
    this.adminFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["cognito-idp:ListUsersInGroup"],
      resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`],
    }));

    // Admin Lambda: Bedrock model listing for the model config UI.
    this.adminFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:ListFoundationModels", "bedrock:ListInferenceProfiles"],
      resources: ["*"],
    }));

    // Admin Lambda: ApplyGuardrail for prompt injection detection on admin saves.
    this.adminFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["bedrock:ApplyGuardrail"],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:guardrail/*`,
      ],
    }));

    // Feedback Engine: Bedrock invoke (scoped to account, model-agnostic for cross-region inference).
    this.feedbackEngineFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ],
      resources: [
        `arn:aws:bedrock:*:${this.account}:model/*`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        `arn:aws:bedrock:*::foundation-model/*`,
      ],
    }));

    // Ask WREN (Feedback Orchestrator): Bedrock + ConversationHistory DynamoDB.
    this.feedbackOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ],
      resources: [
        `arn:aws:bedrock:*:${this.account}:model/*`,
        `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        `arn:aws:bedrock:*::foundation-model/*`,
      ],
    }));
    this.feedbackOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:Query",
      ],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.conversationTableName}`,
      ],
    }));
    // ConversationHistory is SSE-KMS with the storage CMK — DynamoDB calls need decrypt/encrypt.
    props.storageEncryptionKey.grantEncryptDecrypt(this.feedbackOrchestratorFunction);

    // Feedback Engine: S3 read for documents + reference materials.
    this.feedbackEngineFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [
        `arn:aws:s3:::${props.documentsBucketName}/*`,
        `arn:aws:s3:::${props.referenceBucketName}/*`,
      ],
    }));
    this.feedbackEngineFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      resources: [
        `arn:aws:s3:::${props.referenceBucketName}`,
      ],
    }));

    // Feedback Engine: SQS consume (read/delete messages from feedback queue).
    this.feedbackEngineFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
      resources: [this.feedbackQueue.queueArn],
    }));

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new CfnOutput(this, "AuthorizerFunctionArn", {
      value: this.authorizerFunction.functionArn,
    });
    new CfnOutput(this, "DocumentFunctionArn", {
      value: this.documentFunction.functionArn,
    });
    new CfnOutput(this, "AdminFunctionArn", {
      value: this.adminFunction.functionArn,
    });
    new CfnOutput(this, "AuditFunctionArn", {
      value: this.auditFunction.functionArn,
    });
    new CfnOutput(this, "FeedbackOrchestratorFunctionArn", {
      value: this.feedbackOrchestratorFunction.functionArn,
    });
    new CfnOutput(this, "FeedbackEngineFunctionArn", {
      value: this.feedbackEngineFunction.functionArn,
    });
    new CfnOutput(this, "FeedbackQueueUrl", {
      value: this.feedbackQueue.queueUrl,
    });
    new CfnOutput(this, "FeedbackDlqUrl", {
      value: this.feedbackDlq.queueUrl,
    });
    new CfnOutput(this, "AppSyncAuthorizerFunctionArn", {
      value: this.appSyncAuthorizerFunction.functionArn,
    });
    new CfnOutput(this, "AppSyncGraphqlUrl", {
      value: this.appSyncGraphqlUrl,
      description: "AppSync GraphQL endpoint for real-time debrief subscriptions",
      exportName: `${config.stackPrefix}-appsync-graphql-url`,
    });
    new CfnOutput(this, "DocumentIngestQueueUrl", {
      value: this.documentIngestQueue.queueUrl,
    });
  }

  /**
   * Grant each Lambda permission to read the DB secret from Secrets Manager
   * (required to connect via RDS Proxy with IAM auth or secret-based auth).
   */
  private grantDatabaseAccess(
    functions: lambda.Function[],
    secretArn: string,
  ): void {
    for (const fn of functions) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [secretArn],
      }));
    }
  }
}
