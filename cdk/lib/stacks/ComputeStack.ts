import * as path from "path";
import { Stack, type StackProps, Duration, CfnOutput, RemovalPolicy, Token } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { IKey } from "aws-cdk-lib/aws-kms";
import type { Construct } from "constructs";

import { AppSyncRealtimeConstruct } from "../constructs/AppSyncRealtimeConstruct";
import { NotificationInfraConstruct } from "../constructs/NotificationInfraConstruct";

import type { AppDbRole } from "../appDbRoles.js";
import { bedrockModelIdParameterName, cacheEnabledWorkloadsEnv, resolveLogRetention, ssmParameterNames, type AppConfig } from "../config";
import { corsLambdaEnvironment } from "../corsOrigins";

/** IAM resources for us.anthropic.* / us.meta.* cross-region inference profiles. */
function crisBedrockInvokeResources(region: string, account: string): string[] {
  const profileRegions = [...new Set([region, "us-east-1", "us-east-2", "us-west-2"])];
  const resources: string[] = [];
  for (const r of profileRegions) {
    resources.push(`arn:aws:bedrock:${r}:${account}:inference-profile/us.anthropic.*`);
    resources.push(`arn:aws:bedrock:${r}:${account}:inference-profile/us.meta.*`);
  }
  // Include the caller region: InvokeModel on us.* profiles from ca-central-1
  // still authorizes arn:aws:bedrock:<region>::foundation-model/anthropic.*.
  const fmRegions = [...new Set([region, "us-east-1", "us-east-2", "us-west-2"])];
  for (const r of fmRegions) {
    resources.push(`arn:aws:bedrock:${r}::foundation-model/anthropic.*`);
    resources.push(`arn:aws:bedrock:${r}::foundation-model/meta.*`);
  }
  return resources;
}

/**
 * Props for the Compute stack. Receives concrete VPC and resource identifiers
 * from foundational stacks (per CDK steering: constructs receive concrete
 * objects, stacks resolve from SSM/lookup).
 */
export interface ComputeStackProps extends StackProps {
  readonly config: AppConfig;
  readonly vpc: ec2.IVpc;
  /** Existing Feedback Engine ECR repository owned or explicitly imported by Cicd. */
  readonly feedbackEngineRepository: ecr.IRepository;
  /** RDS Proxy endpoint hostname (from Database stack via SSM). */
  readonly databaseProxyEndpoint: string;
  /** Per-Lambda Secrets Manager ARNs (Postgres role secrets, not dbadmin). */
  readonly databaseSecretArns: Record<AppDbRole, string>;
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
  /** Operator-only TechnicalAdmin sync; never wired to API Gateway. */
  public readonly syncCognitoAdminsFunction: lambda.Function;
  public readonly feedbackOrchestratorFunction: lambda.Function;
  public readonly feedbackEngineFunction: lambda.Function;
  public readonly diffAnchorProgressFunction: lambda.Function;
  public readonly feedbackQueue: sqs.Queue;
  public readonly feedbackDlq: sqs.Queue;
  public readonly documentIngestQueue: sqs.Queue;
  public readonly documentIngestDlq: sqs.Queue;
  public readonly notificationFunction: lambda.Function;
  public readonly notificationDlq: sqs.Queue;
  public readonly notificationTopicArn: string;
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
    // Per-role secrets are username+password only; host/port/dbname are
    // non-secret overrides (the RDS admin secret used to embed them).
    const dbEnv = (secretArn: string) => ({
      DB_PROXY_HOST: props.databaseProxyEndpoint,
      DB_PORT: "5432",
      DB_NAME: "appdb",
      DB_SECRET_ARN: secretArn,
      NODE_OPTIONS: "--enable-source-maps",
    });
    const secrets = props.databaseSecretArns;
    const corsEnv = corsLambdaEnvironment(config);

    // Shared bundling config: workspace packages are resolved from the monorepo
    // root node_modules (npm workspaces hoist them there). esbuild runs from the
    // monorepo root so it naturally resolves @wren/* via the workspace symlinks.
    const monorepoRoot = path.join(__dirname, "../../..");
    const sharedBundling: lambdaNodejs.BundlingOptions = {
      minify: true,
      sourceMap: true,
      target: "node22",
    };
    // pdf.js / pdf-parse must ship as real node_modules (workers + ESM), not
    // an esbuild bundle — otherwise Lambda cannot load the digital PDF path.
    // nodeModules are installed on the deploying machine, so a Windows/macOS
    // deploy would ship only that platform's @napi-rs/canvas binding (needed
    // by pdf.js) — add the Linux one Lambda actually loads.
    // inputDir is the monorepo root (projectRoot) for both local and Docker bundling.
    const documentBundling: lambdaNodejs.BundlingOptions = {
      ...sharedBundling,
      nodeModules: ["pdfjs-dist", "pdf-parse"],
      commandHooks: {
        beforeBundling: () => [],
        beforeInstall: () => [],
        afterBundling: (inputDir: string, outputDir: string) => [
          // Forward slashes work for node on Windows and inside the Linux container.
          `node "${inputDir}/cdk/scripts/installLinuxCanvasBinding.mjs" "${outputDir}"`,
        ],
      },
    };

    // One-way salt for activity-log actor pseudonyms. Generated into Secrets
    // Manager (never a guessable path). Only the secret's NAME is passed to
    // Lambda; the shared @wren/db-node activity-log writer fetches the value
    // with GetSecretValue at runtime (outside the handler, cached per
    // container). Injecting the value itself (secretValue / dynamic reference)
    // would expose it to anyone with lambda:GetFunctionConfiguration.
    //
    // The name, not `secretArn`, is passed because in "external" mode
    // `fromSecretNameV2` only knows a partial ARN (no six-character suffix).
    const activityPseudonymSaltName = `${config.stackPrefix}/audit/pseudonym-salt`;
    const activityPseudonymSalt = config.auditPseudonymSaltOwnership === "external"
      ? secretsmanager.Secret.fromSecretNameV2(
        this,
        "ActivityPseudonymSalt",
        activityPseudonymSaltName,
      )
      : new secretsmanager.Secret(this, "ActivityPseudonymSalt", {
        secretName: activityPseudonymSaltName,
        description: "One-way salt for activity-log actor pseudonyms",
        generateSecretString: {
          passwordLength: 48,
          excludePunctuation: true,
        },
      });
    if (config.auditPseudonymSaltOwnership === "managed") {
      activityPseudonymSalt.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }
    const activitySaltEnv = {
      WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID: activityPseudonymSaltName,
    };

    // HMAC key binding the API Gateway authorizer context to this deployment.
    // The authorizer signs the context it mints; the
    // service Lambdas verify the signature and reject forged contexts from a
    // direct `lambda:InvokeFunction`. Like the pseudonym salt, only the secret
    // NAME is passed to the functions — the value is fetched with
    // GetSecretValue at runtime (cached per container), never exposed via
    // lambda:GetFunctionConfiguration.
    //
    // Co-located under `${prefix}/audit/*` ON PURPOSE: that path is already the
    // only Secrets Manager scope the Compute permissions boundary allows roles
    // to read and the only one the scoped Compute CFN deploy role may create
    // (CicdStack). Reusing it keeps this change from widening either hardened
    // scope. Ownership tracks the audit salt so protected teardown retains it.
    const authContextSigningSecretName = `${config.stackPrefix}/audit/auth-context-signing-key`;
    const authContextSigningSecret = config.auditPseudonymSaltOwnership === "external"
      ? secretsmanager.Secret.fromSecretNameV2(
        this,
        "AuthContextSigningKey",
        authContextSigningSecretName,
      )
      : new secretsmanager.Secret(this, "AuthContextSigningKey", {
        secretName: authContextSigningSecretName,
        description: "HMAC key for signing the API Gateway authorizer context",
        generateSecretString: {
          passwordLength: 64,
          excludePunctuation: true,
        },
      });
    if (config.auditPseudonymSaltOwnership === "managed") {
      authContextSigningSecret.applyRemovalPolicy(RemovalPolicy.RETAIN);
    }
    // Signer (authorizer) and verifiers (service Lambdas) both need the name.
    const authContextSigningEnv = {
      AUTH_CONTEXT_SIGNING_SECRET_ID: authContextSigningSecretName,
    };
    // Enforcement mode is set on the VERIFIERS only; the authorizer always signs.
    const authContextVerifyEnv = {
      AUTH_CONTEXT_VERIFY_MODE: config.authContextVerifyMode,
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
      // VPC cold start (ENI + Secrets Manager + RDS Proxy + JWKS) can exceed 10s.
      timeout: Duration.seconds(20),
      // Guaranteed concurrency FLOOR on the auth critical path. Prevents the
      // shared account pool from being starved by long-running functions
      // (authorizer throttling remediation — see lambdaConcurrency.ts).
      reservedConcurrentExecutions: config.lambdaConcurrency.authorizer,
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv(secrets.wren_authorizer),
        // First-login identity relinks write a pseudonymized `identity.relinked`
        // activity_event. Secret NAME only (grant below).
        ...activitySaltEnv,
        // Signs the authorizer context it mints.
        ...authContextSigningEnv,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        ...(config.technicalAdminBootstrapSubject
          ? { TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT: config.technicalAdminBootstrapSubject }
          : {}),
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
      memorySize: 384,
      timeout: Duration.minutes(3),
      // Reserved CAP so a burst of long-running OCR jobs cannot consume the
      // whole account pool and starve the authorizer. Aligns with the ingest
      // SQS maxConcurrency below (authorizer throttling remediation).
      reservedConcurrentExecutions: config.lambdaConcurrency.document,
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv(secrets.wren_document),
        ...corsEnv,
        // Verifies the authorizer-context signature.
        ...authContextSigningEnv,
        ...authContextVerifyEnv,
        // Document deletion records an activity_event; the shared
        // writer needs the same pseudonym salt as Admin/Audit so an actor's
        // pseudonym is correlatable across services. Only the secret's name
        // is passed; the value is fetched at runtime (grant below).
        ...activitySaltEnv,
        DOCUMENTS_BUCKET_NAME: props.documentsBucketName,
        DOCUMENTS_KMS_KEY_ARN: props.storageEncryptionKey.keyArn,
        PDF_OCR_ENABLED: "true",
        // Textract is the OCR fallback when a PDF has no usable text layer.
        PDF_OCR_ENGINE: "textract",
        CONVERSATION_TABLE_NAME: props.conversationTableName,
      },
      bundling: documentBundling,
    });

    // -----------------------------------------------------------------------
    // Document ingest queue (async PDF OCR via Textract)
    // -----------------------------------------------------------------------
    // Messages reference user documents: SSE-SQS at rest + TLS-only queue policy.
    this.documentIngestDlq = new sqs.Queue(this, "DocumentIngestDlq", {
      queueName: `${config.stackPrefix}-document-ingest-dlq`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    this.documentIngestQueue = new sqs.Queue(this, "DocumentIngestQueue", {
      queueName: `${config.stackPrefix}-document-ingest-queue`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
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
    // The admin prompt-injection scan fails closed without a guardrail id.
    // Catch a literally-empty id at synth; the normal value is an
    // unresolved SSM token. CDK must NEVER set PROMPT_GUARDRAIL_SKIP (dev/test
    // bypass only).
    if (!Token.isUnresolved(props.promptGuardrailId) && props.promptGuardrailId.trim() === "") {
      throw new Error(
        "ComputeStack: promptGuardrailId must be a non-empty Bedrock Guardrail id " +
          "(admin prompt-injection screening fails closed without it).",
      );
    }
    this.adminFunction = new lambdaNodejs.NodejsFunction(this, "AdminFn", {
      functionName: `${config.stackPrefix}-admin`,
      entry: path.join(monorepoRoot, "backend/admin/src/lambda-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv(secrets.wren_admin),
        ...corsEnv,
        ...activitySaltEnv,
        // Verifies the authorizer-context signature.
        ...authContextSigningEnv,
        ...authContextVerifyEnv,
        REFERENCE_BUCKET_NAME: props.referenceBucketName,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        COGNITO_USER_POOL_ID: props.userPoolId,
        PROMPT_GUARDRAIL_ID: props.promptGuardrailId,
        PROMPT_GUARDRAIL_VERSION: "DRAFT",
        STACK_PREFIX: config.stackPrefix,
      },
      bundling: sharedBundling,
    });

    // -----------------------------------------------------------------------
    // Operator-only sync-cognito-admins Lambda (Node 22)
    //
    // Grants TechnicalAdmin to Cognito SystemAdmin group members. Isolated from
    // the API-facing Admin Lambda so that function has no unauthenticated
    // privileged branch. Deliberately has NO resource-policy grant (no API
    // Gateway / service principal): only IAM principals with an explicit
    // lambda:InvokeFunction on this function can run it.
    // -----------------------------------------------------------------------
    this.syncCognitoAdminsFunction = new lambdaNodejs.NodejsFunction(this, "SyncCognitoAdminsFn", {
      functionName: `${config.stackPrefix}-sync-cognito-admins`,
      description: "Operator-only: grant TechnicalAdmin to Cognito SystemAdmin group members",
      entry: path.join(monorepoRoot, "backend/admin/src/lambda-sync-cognito-admins.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(60),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv(secrets.wren_admin),
        // Each grant writes a pseudonymized activity_event (same salt as Admin).
        ...activitySaltEnv,
        COGNITO_USER_POOL_ID: props.userPoolId,
      },
      bundling: sharedBundling,
    });

    // -----------------------------------------------------------------------
    // Feedback DLQ + Queue (SQS — async job execution, REQ-NFR-SCALE-01)
    // -----------------------------------------------------------------------
    // Feedback jobs reference user drafts: SSE-SQS at rest + TLS-only queue policy.
    this.feedbackDlq = new sqs.Queue(this, "FeedbackDlq", {
      queueName: `${config.stackPrefix}-feedback-dlq`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    this.feedbackQueue = new sqs.Queue(this, "FeedbackQueue", {
      queueName: `${config.stackPrefix}-feedback-queue`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      visibilityTimeout: Duration.minutes(16), // Must exceed engine timeout
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
      memorySize: 256,
      // Ask WREN invokes Bedrock synchronously on this Lambda.
      timeout: Duration.seconds(60),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv(secrets.wren_feedback_orch),
        ...corsEnv,
        // Verifies the authorizer-context signature.
        ...authContextSigningEnv,
        ...authContextVerifyEnv,
        FEEDBACK_QUEUE_URL: this.feedbackQueue.queueUrl,
        CONVERSATION_TABLE_NAME: props.conversationTableName,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        STACK_PREFIX: config.stackPrefix,
        // Prompt-cache decision layer (plan §15). Safe defaults keep caching
        // effectively OFF (observe / 5m / none); the runtime reads these keys.
        CACHE_MODE: config.cacheMode,
        CACHE_TTL: config.cacheTtl,
        CACHE_ENABLED_WORKLOADS: cacheEnabledWorkloadsEnv(config),
      },
      bundling: sharedBundling,
    });
    this.feedbackQueue.grantSendMessages(this.feedbackOrchestratorFunction);

    // -----------------------------------------------------------------------
    // Feedback Engine Lambda (Python 3.12, container — AI workload via Bedrock)
    // -----------------------------------------------------------------------
    this.feedbackEngineFunction = new lambda.Function(this, "FeedbackEngineFn", {
      functionName: `${config.stackPrefix}-feedback-engine`,
      runtime: lambda.Runtime.FROM_IMAGE,
      code: lambda.Code.fromEcrImage(props.feedbackEngineRepository, {
        tagOrDigest: config.feedbackEngineImageTag,
      }),
      handler: lambda.Handler.FROM_IMAGE,
      memorySize: 512,
      timeout: Duration.minutes(15), // long documents can exceed 5m on Bedrock
      // Reserved CAP so the longest-running function (15-min timeout, holds a
      // slot for minutes) cannot exhaust the shared account pool and starve the
      // authorizer. Aligns with the SQS maxConcurrency below (authorizer
      // throttling remediation — see lambdaConcurrency.ts).
      reservedConcurrentExecutions: config.lambdaConcurrency.feedbackEngine,
      vpc,
      vpcSubnets: privateSubnets,
      environment: {
        DB_PROXY_HOST: props.databaseProxyEndpoint,
        DB_PORT: "5432",
        DB_NAME: "appdb",
        DB_SECRET_ARN: secrets.wren_feedback_engine,
        BEDROCK_MODEL_ID: config.bedrockModelId,
        STACK_PREFIX: config.stackPrefix,
        REFERENCE_BUCKET_NAME: props.referenceBucketName,
        DOCUMENTS_BUCKET_NAME: props.documentsBucketName,
        // Prompt-cache decision layer (plan §15). Same safe defaults as the
        // orchestrator; the Python runtime reads these keys.
        CACHE_MODE: config.cacheMode,
        CACHE_TTL: config.cacheTtl,
        CACHE_ENABLED_WORKLOADS: cacheEnabledWorkloadsEnv(config),
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
    });

    // -----------------------------------------------------------------------
    // Notification Infrastructure (SNS topic + SQS queue + DLQ + SSM params)
    // -----------------------------------------------------------------------
    const notificationInfra = new NotificationInfraConstruct(this, "NotificationInfra", {
      stackPrefix: config.stackPrefix,
    });
    this.notificationTopicArn = notificationInfra.topic.topicArn;
    this.notificationDlq = notificationInfra.dlq;

    // -----------------------------------------------------------------------
    // Notification Service Lambda (Node 22) — processes SQS events, REST API,
    // and EventBridge scheduled override-expiry scanning.
    // -----------------------------------------------------------------------
    this.notificationFunction = new lambdaNodejs.NodejsFunction(this, "NotificationFn", {
      functionName: `${config.stackPrefix}-notification`,
      entry: path.join(monorepoRoot, "backend/notification/src/lambda-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(30),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv(secrets.wren_notification),
        ...corsEnv,
        ...activitySaltEnv,
        // Verifies the authorizer-context signature (findings f-140e2506 / f-bd8143e2).
        ...authContextSigningEnv,
        ...authContextVerifyEnv,
        NOTIFICATION_TOPIC_ARN: notificationInfra.topic.topicArn,
        OVERRIDE_EXPIRY_WARNING_HOURS: "24",
      },
      bundling: sharedBundling,
    });

    // SQS event source: the notification Lambda is triggered by messages on the queue.
    this.notificationFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(notificationInfra.queue, {
        batchSize: 5,
        maxConcurrency: 10,
      }),
    );

    // EventBridge rule: invoke every 15 minutes for override-expiry scanning.
    const overrideExpiryRule = new events.Rule(this, "OverrideExpiryRule", {
      ruleName: `${config.stackPrefix}-notification-override-expiry`,
      schedule: events.Schedule.rate(Duration.minutes(15)),
      description: "Scans for expiring/expired usage overrides to generate notifications",
    });
    overrideExpiryRule.addTarget(new targets.LambdaFunction(this.notificationFunction));

    // IAM: SNS publish (for the notification topic, though primarily used by producers)
    notificationInfra.topic.grantPublish(this.notificationFunction);

    // IAM: SSM parameter read (notification config thresholds)
    this.notificationFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter", "ssm:GetParameters"],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/${config.stackPrefix}/notifications/*`,
      ],
    }));

    // Expose the notification topic ARN to other Lambdas that publish events.
    this.feedbackOrchestratorFunction.addEnvironment(
      "NOTIFICATION_TOPIC_ARN",
      notificationInfra.topic.topicArn,
    );
    notificationInfra.topic.grantPublish(this.feedbackOrchestratorFunction);

    this.adminFunction.addEnvironment(
      "NOTIFICATION_TOPIC_ARN",
      notificationInfra.topic.topicArn,
    );
    notificationInfra.topic.grantPublish(this.adminFunction);

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
      timeout: Duration.seconds(20),
      // Guaranteed concurrency FLOOR for realtime auth (authorizer throttling
      // remediation — see lambdaConcurrency.ts).
      reservedConcurrentExecutions: config.lambdaConcurrency.appsyncAuthorizer,
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv(secrets.wren_appsync_auth),
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        // AppSync Lambda auth uses the Cognito idToken (not accessToken).
        // The frontend sends the idToken in the Authorization header per the
        // AppSync @aws_lambda auth convention.
        COGNITO_TOKEN_USE: 'id',
      },
      bundling: sharedBundling,
    });

    // -----------------------------------------------------------------------
    // AppSync real-time API — debrief-ready notifications
    // -----------------------------------------------------------------------
    const appSyncRealtime = new AppSyncRealtimeConstruct(this, "AppSyncRealtime", {
      authorizerFunction: this.appSyncAuthorizerFunction,
      feedbackEngineRole: this.feedbackEngineFunction.role!,
      notificationLambdaRole: this.notificationFunction.role!,
      stackPrefix: config.stackPrefix,
      logRetention: resolveLogRetention(config),
    });
    this.appSyncGraphqlUrl = appSyncRealtime.graphqlUrl;

    // Inject the AppSync endpoint into the Feedback Engine so it can publish
    // the debriefReady mutation after writing feedback_item rows.
    this.feedbackEngineFunction.addEnvironment("APPSYNC_URL", appSyncRealtime.graphqlUrl);

    // Inject the AppSync endpoint into the Notification Lambda so it can
    // publish real-time notification mutations to subscribers.
    this.notificationFunction.addEnvironment("APPSYNC_URL", appSyncRealtime.graphqlUrl);

    // -----------------------------------------------------------------------
    // IAM: scoped roles — each function gets only what it needs
    // -----------------------------------------------------------------------
    this.grantDatabaseAccess(this.authorizerFunction, secrets.wren_authorizer);
    this.grantDatabaseAccess(this.appSyncAuthorizerFunction, secrets.wren_appsync_auth);
    this.grantDatabaseAccess(this.documentFunction, secrets.wren_document);
    this.grantDatabaseAccess(this.adminFunction, secrets.wren_admin);
    this.grantDatabaseAccess(this.syncCognitoAdminsFunction, secrets.wren_admin);
    this.grantDatabaseAccess(this.feedbackOrchestratorFunction, secrets.wren_feedback_orch);
    this.grantDatabaseAccess(this.feedbackEngineFunction, secrets.wren_feedback_engine);
    this.grantDatabaseAccess(this.notificationFunction, secrets.wren_notification);

    // Activity-log pseudonym salt: read at runtime by the shared
    // @wren/db-node activity-log writer in every function that receives
    // `activitySaltEnv` (Admin, Audit, Document, sync-cognito-admins, Authorizer,
    // Notification; Document records its deletion events through the same
    // writer). Every
    // such function MUST be granted here — the CDK test enforces it. grantRead
    // scopes GetSecretValue/DescribeSecret to this one secret and, for
    // fromSecretNameV2 ("external" mode), appends the `-??????` suffix
    // wildcard that a hand-written statement on `secretArn` would miss.
    activityPseudonymSalt.grantRead(this.adminFunction);
    activityPseudonymSalt.grantRead(this.documentFunction);
    // sync-cognito-admins writes a pseudonymized activity_event per grant.
    activityPseudonymSalt.grantRead(this.syncCognitoAdminsFunction);
    // Authorizer audits first-login identity relinks.
    activityPseudonymSalt.grantRead(this.authorizerFunction);
    // Notification records a pseudonymized activity_event per Notification_Type
    // catalog create/update.
    activityPseudonymSalt.grantRead(this.notificationFunction);

    // Auth-context signing key: the authorizer signs; the
    // three API Gateway service Lambdas verify. grantRead scopes
    // GetSecretValue/DescribeSecret to this one secret (and, in "external"
    // mode, appends the `-??????` suffix wildcard). All four reads fall under
    // the `${prefix}/audit/*` scope the permissions boundary already permits.
    authContextSigningSecret.grantRead(this.authorizerFunction);
    authContextSigningSecret.grantRead(this.adminFunction);
    authContextSigningSecret.grantRead(this.documentFunction);
    authContextSigningSecret.grantRead(this.feedbackOrchestratorFunction);
    authContextSigningSecret.grantRead(this.notificationFunction);

    // Authorizer: look up Cognito email/name/email_verified when auto-provisioning
    // app_user on first login, and check whether a previously linked subject
    // still exists before an email relink (both via AdminGetUser).
    this.authorizerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["cognito-idp:AdminGetUser"],
      resources: [
        `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.userPoolId}`,
      ],
    }));

    // Document Lambda: S3 read/write for document uploads + presigned URLs.
    // Batch deletes (DeleteObjectsCommand) authorize per key as s3:DeleteObject;
    // there is no s3:DeleteObjects IAM action. Keys are deleted without a
    // VersionId, so s3:DeleteObjectVersion is not needed either.
    // https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html
    this.documentFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "s3:GetObject",
        "s3:PutObject",
        "s3:PutObjectTagging",
        "s3:GetObjectTagging",
        "s3:DeleteObjectTagging",
        "s3:DeleteObject",
      ],
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

    // -----------------------------------------------------------------------
    // Orphan-upload reconciliation sweep (Node 22, daily EventBridge schedule)
    // -----------------------------------------------------------------------
    // The documents-bucket lifecycle rule only expires objects tagged
    // `orphan-upload=true`. This sweep re-tags presigned uploads older than a
    // day that are untagged and referenced by no draft / ingest-job row, so a
    // failed attach can never strand an object permanently. Own role, scoped
    // to list + tag on the documents bucket; it never reads or deletes bytes.
    const orphanUploadSweepFunction = new lambdaNodejs.NodejsFunction(this, "OrphanUploadSweepFn", {
      functionName: `${config.stackPrefix}-orphan-upload-sweep`,
      entry: path.join(monorepoRoot, "backend/document/src/orphanUploadSweepHandler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.minutes(10),
      vpc,
      vpcSubnets: privateSubnets,
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ...dbEnv(secrets.wren_document),
        DOCUMENTS_BUCKET_NAME: props.documentsBucketName,
      },
      bundling: sharedBundling,
    });
    this.grantDatabaseAccess(orphanUploadSweepFunction, secrets.wren_document);
    orphanUploadSweepFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:ListBucket"],
      resources: [`arn:aws:s3:::${props.documentsBucketName}`],
      conditions: { StringLike: { "s3:prefix": ["documents/*"] } },
    }));
    orphanUploadSweepFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObjectTagging", "s3:PutObjectTagging"],
      resources: [`arn:aws:s3:::${props.documentsBucketName}/documents/*`],
    }));
    const orphanUploadSweepRule = new events.Rule(this, "OrphanUploadSweepRule", {
      ruleName: `${config.stackPrefix}-orphan-upload-sweep`,
      schedule: events.Schedule.rate(Duration.days(1)),
      description: "Re-tags stranded, unreferenced document uploads for lifecycle expiry",
    });
    orphanUploadSweepRule.addTarget(new targets.LambdaFunction(orphanUploadSweepFunction));

    // Admin Lambda: S3 read/delete on reference material. PutObject is
    // intentionally omitted (finding S-3): no code in the admin backend uploads
    // reference bytes, so the write grant was unused. Restore it only alongside
    // an in-repo, shape-validated upload path.
    this.adminFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["s3:GetObject", "s3:DeleteObject"],
      resources: [`arn:aws:s3:::${props.referenceBucketName}/*`],
    }));
    props.storageEncryptionKey.grantEncryptDecrypt(this.adminFunction);

    // Sync-cognito-admins Lambda: Cognito ListUsersInGroup (removed from the
    // API-facing Admin role, which no longer runs the script).
    this.syncCognitoAdminsFunction.addToRolePolicy(new iam.PolicyStatement({
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

    const bedrockInvokeResources = crisBedrockInvokeResources(this.region, this.account);

    // Feedback Engine: Bedrock invoke scoped to us.anthropic.* / us.meta.* CRIS
    // (not all models/regions). A non-us.* profile will 403 until this list grows.
    this.feedbackEngineFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:GetInferenceProfile",
      ],
      resources: bedrockInvokeResources,
    }));

    // Ask WREN (Feedback Orchestrator): Bedrock + ConversationHistory DynamoDB.
    this.feedbackOrchestratorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
        "bedrock:GetInferenceProfile",
      ],
      resources: bedrockInvokeResources,
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
    // SSM Bedrock model id — runtime source of truth for Admin UI + invoke.
    const bedrockModelParamArn = `arn:aws:ssm:${this.region}:${this.account}:parameter${bedrockModelIdParameterName(config)}`;
    for (const fn of [this.adminFunction, this.feedbackEngineFunction, this.feedbackOrchestratorFunction]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["ssm:GetParameter"],
        resources: [bedrockModelParamArn],
      }));
    }
    this.adminFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:PutParameter"],
      resources: [bedrockModelParamArn],
    }));
    // Read-only: the first admin's Cognito sub, so revokeRole can refuse to
    // demote them. Written by the deploy workflow, not this stack. The admin
    // function reads the permanent protected-admin parameter and falls back to
    // the legacy bootstrap-arming parameter, so it needs read on both.
    this.adminFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmParameterNames.protectedAdminSubject(config)}`,
        `arn:aws:ssm:${this.region}:${this.account}:parameter${ssmParameterNames.technicalAdminBootstrapSubject(config)}`,
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
    new CfnOutput(this, "SyncCognitoAdminsFunctionName", {
      value: this.syncCognitoAdminsFunction.functionName,
      description: "Operator-only: aws lambda invoke --payload '{\"_script\":\"sync-cognito-admins\"}'",
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
    new CfnOutput(this, "NotificationFunctionArn", {
      value: this.notificationFunction.functionArn,
    });
    new CfnOutput(this, "NotificationTopicArn", {
      value: this.notificationTopicArn,
      description: "SNS topic ARN for publishing notification events",
      exportName: `${config.stackPrefix}-notification-topic-arn`,
    });
  }

  /**
   * Grant a Lambda permission to read only its own DB secret from Secrets Manager.
   */
  private grantDatabaseAccess(fn: lambda.Function, secretArn: string): void {
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue"],
      resources: [secretArn],
    }));
  }
}
