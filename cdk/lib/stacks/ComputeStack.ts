import { Stack, type StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import type { Construct } from "constructs";

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
  /** DynamoDB conversation table name. */
  readonly conversationTableName: string;
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

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { config, vpc } = props;

    // Select private subnets for data-plane Lambdas (security steering).
    const privateSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    // Shared environment variables for Node Lambdas that access the DB.
    const dbEnv = {
      DATABASE_PROXY_ENDPOINT: props.databaseProxyEndpoint,
      DATABASE_SECRET_ARN: props.databaseSecretArn,
      NODE_OPTIONS: "--enable-source-maps",
    };

    // -----------------------------------------------------------------------
    // Lambda Authorizer (Node 22)
    // -----------------------------------------------------------------------
    this.authorizerFunction = new lambda.Function(this, "AuthorizerFn", {
      functionName: `${config.stackPrefix}-authorizer`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/authorizer"),
      memorySize: 256,
      timeout: Duration.seconds(10),
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        ...dbEnv,
        COGNITO_USER_POOL_ID: `/${config.stackPrefix}/auth/user-pool-id`,
        COGNITO_CLIENT_ID: `/${config.stackPrefix}/auth/client-id`,
      },
    });

    // -----------------------------------------------------------------------
    // Document / Draft Service Lambda (Node 22)
    // -----------------------------------------------------------------------
    this.documentFunction = new lambda.Function(this, "DocumentFn", {
      functionName: `${config.stackPrefix}-document`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/document"),
      memorySize: 512,
      timeout: Duration.seconds(30),
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        ...dbEnv,
        DOCUMENTS_BUCKET_NAME: props.documentsBucketName,
      },
    });

    // -----------------------------------------------------------------------
    // Admin / Config / Auth / Usage Service Lambda (Node 22)
    // -----------------------------------------------------------------------
    this.adminFunction = new lambda.Function(this, "AdminFn", {
      functionName: `${config.stackPrefix}-admin`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/admin"),
      memorySize: 512,
      timeout: Duration.seconds(30),
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        ...dbEnv,
        REFERENCE_BUCKET_NAME: props.referenceBucketName,
      },
    });

    // -----------------------------------------------------------------------
    // Audit / Activity-Log / Analytics Service Lambda (Node 22)
    // -----------------------------------------------------------------------
    this.auditFunction = new lambda.Function(this, "AuditFn", {
      functionName: `${config.stackPrefix}-audit`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/audit"),
      memorySize: 256,
      timeout: Duration.seconds(15),
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        ...dbEnv,
        WREN_ACTIVITY_PSEUDONYM_SALT: `/${config.stackPrefix}/audit/pseudonym-salt`,
      },
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
    this.feedbackOrchestratorFunction = new lambda.Function(this, "FeedbackOrchestratorFn", {
      functionName: `${config.stackPrefix}-feedback-orchestrator`,
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset("lambda/feedback-orchestrator"),
      memorySize: 256,
      timeout: Duration.seconds(15),
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        ...dbEnv,
        FEEDBACK_QUEUE_URL: this.feedbackQueue.queueUrl,
      },
    });
    this.feedbackQueue.grantSendMessages(this.feedbackOrchestratorFunction);

    // -----------------------------------------------------------------------
    // Feedback Engine Lambda (Python 3.12, container — AI workload via Bedrock)
    // -----------------------------------------------------------------------
    this.feedbackEngineFunction = new lambda.Function(this, "FeedbackEngineFn", {
      functionName: `${config.stackPrefix}-feedback-engine`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset("lambda/feedback-engine"),
      memorySize: 1024,
      timeout: Duration.minutes(5), // AI workload — generous timeout
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        DATABASE_PROXY_ENDPOINT: props.databaseProxyEndpoint,
        DATABASE_SECRET_ARN: props.databaseSecretArn,
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
      code: lambda.Code.fromAsset("lambda/diff-anchor-progress"),
      memorySize: 512,
      timeout: Duration.seconds(60),
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        DATABASE_PROXY_ENDPOINT: props.databaseProxyEndpoint,
        DATABASE_SECRET_ARN: props.databaseSecretArn,
      },
    });

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

    // Document Lambda: S3 read/write for document uploads.
    this.documentFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      resources: [`arn:aws:s3:::${props.documentsBucketName}/*`],
    }));

    // Admin Lambda: S3 read/write for reference material uploads.
    this.adminFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      resources: [`arn:aws:s3:::${props.referenceBucketName}/*`],
    }));

    // Feedback Engine: Bedrock invoke (model-agnostic).
    this.feedbackEngineFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ],
      resources: ["*"], // Bedrock model ARNs are dynamic (cross-region inference)
    }));

    // Feedback Engine: S3 read for documents + reference materials.
    this.feedbackEngineFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [
        `arn:aws:s3:::${props.documentsBucketName}/*`,
        `arn:aws:s3:::${props.referenceBucketName}/*`,
      ],
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
