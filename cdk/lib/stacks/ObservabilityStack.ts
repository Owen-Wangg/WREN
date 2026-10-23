import { Stack, type StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as kms from "aws-cdk-lib/aws-kms";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import { CACHE_WORKLOADS, type AppConfig } from "../config";

/**
 * Props for the Observability stack.
 */
export interface ObservabilityStackProps extends StackProps {
  readonly config: AppConfig;
  /** Lambda function names to create log groups and alarms for. */
  readonly functionNames: string[];
  /** SQS queue name for the feedback queue (alarm on depth). */
  readonly feedbackQueueName: string;
  /** SQS DLQ name (alarm on non-zero messages). */
  readonly feedbackDlqName: string;
  /** Notification DLQ name. Alarm is created only when provided. */
  readonly notificationDlqName?: string;
  /** Document-ingest DLQ name. Alarm is created only when provided. */
  readonly documentIngestDlqName?: string;
  /**
   * Name of the Cognito JWT authorizer Lambda (critical path). Used for the
   * DB-failure / auth-failure log metric filters and their alarms. Defaults to
   * `${stackPrefix}-authorizer` when omitted.
   */
  readonly authorizerFunctionName?: string;
  /**
   * Name of the API Gateway access-log group. When provided, the
   * security observability adds metric filters/alarms over the structured
   * access log (unauthorized responses, privileged deletes). Omitted in unit
   * tests that synth the stack in isolation.
   */
  readonly apiAccessLogGroupName?: string;
  /**
   * Names of operator-only Lambdas that perform privileged writes (e.g.
   * `${prefix}-sync-cognito-admins`, which grants TechnicalAdmin). When
   * provided, a dedicated CloudTrail trail records WHO invoked them into
   * CloudWatch Logs (and S3). Lambda does not expose the IAM caller to the
   * function, so this is the only way to attribute a direct invoke.
   */
  readonly privilegedInvokeFunctionNames?: readonly string[];
  /**
   * Optional, configurable thresholds for the prompt-cache alarms (plan
   * §16/§17). All have SAFE defaults chosen so that, under the default
   * `observe` posture (no cache activity => cache metrics stay at zero /
   * insufficient-data), NONE of these alarms fire.
   */
  readonly cacheAlarmThresholds?: CacheAlarmThresholds;
}

/**
 * Tunable thresholds for the prompt-cache alarms. Every field is optional; the
 * defaults are quiet under the safe `observe` config because they only fire on
 * ACTUAL cache activity (writes/fallbacks) or a savings regression that is
 * gated on cache writes.
 */
export interface CacheAlarmThresholds {
  /**
   * `CacheWriteInputTokens` (Sum, per period) above which — with essentially no
   * cache reads — we treat writes as wasted. Default 1000 tokens/period.
   */
  readonly writeWithoutReadWriteTokens?: number;
  /**
   * `CacheReadInputTokens` (Sum, per period) at or below which reads count as
   * "essentially none" for the write-without-read signal. Default 1 token.
   */
  readonly writeWithoutReadReadFloor?: number;
  /** Consecutive periods the write-without-read condition must hold. Default 3. */
  readonly writeWithoutReadPeriods?: number;
  /**
   * `CacheFallbacks` (Sum, per period) above which fallbacks are "elevated".
   * Default 5 per 5-minute period.
   */
  readonly fallbacksThreshold?: number;
  /** Consecutive periods the fallback condition must hold. Default 3. */
  readonly fallbacksPeriods?: number;
  /**
   * Absolute `EstimatedCostUsd` (Sum, per period) above which cost is
   * "materially high". Deliberately large so normal traffic never trips it;
   * operators lower it per environment once a baseline exists. Default 50 USD
   * per 5-minute period.
   */
  readonly costRegressionUsd?: number;
  /** Consecutive periods the cost/savings regression must hold. Default 6. */
  readonly costRegressionPeriods?: number;
}

const DEFAULT_CACHE_ALARM_THRESHOLDS: Required<CacheAlarmThresholds> = {
  writeWithoutReadWriteTokens: 1000,
  writeWithoutReadReadFloor: 1,
  writeWithoutReadPeriods: 3,
  fallbacksThreshold: 5,
  fallbacksPeriods: 3,
  costRegressionUsd: 50,
  costRegressionPeriods: 6,
};

/** EMF namespace the WREN Bedrock runtime emits under (plan §16). */
const WREN_BEDROCK_NAMESPACE = "WREN/Bedrock";

/**
 * `${StackPrefix}-Observability` — Monitoring, logging, and alarms.
 *
 * - CloudWatch log groups with deliberate retention (30 days dev, 90 days prod)
 *   for each Lambda function. Lambda Powertools (Python) and structured logging
 *   (Node) provide correlation IDs and structured context.
 * - Alarms on:
 *   - Lambda errors (5xx) per function
 *   - Lambda throttles per function
 *   - Feedback queue depth (degradation signal)
 *   - Feedback, notification, and document-ingest DLQ messages
 *   - API Gateway latency p99
 * - SNS topic for alarm notifications.
 *
 * Requirements: REQ-NFR-LATENCY-01 (latency monitoring), REQ-NFR-SCALE-01
 * (queue depth as degradation signal).
 */
export class ObservabilityStack extends Stack {
  public readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    const { config } = props;
    const isProd = config.environmentName === "prod";
    const retentionDays = isProd ? logs.RetentionDays.THREE_MONTHS : logs.RetentionDays.ONE_MONTH;

    // -------------------------------------------------------------------
    // SNS Topic for alarm notifications
    // -------------------------------------------------------------------
    // SSE-SNS at rest with a dedicated CMK. The AWS-managed SNS key
    // (alias/aws/sns) cannot be used here: its key policy is not editable, so
    // CloudWatch alarms cannot generate data keys for it and alarm publishes
    // fail silently. The CMK grants cloudwatch.amazonaws.com the two KMS
    // actions it needs (per the CloudWatch alarm + encrypted SNS docs:
    // https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html).
    // The key only protects in-flight alarm messages, so it is destroyed on
    // teardown (7-day pending window) rather than retained.
    const alarmTopicKey = new kms.Key(this, "AlarmTopicKey", {
      description: `${config.stackPrefix} alarm SNS topic key (CloudWatch alarms)`,
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.DESTROY,
      pendingWindow: Duration.days(7),
    });
    alarmTopicKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: "AllowCloudWatchAlarmsToUseKey",
      principals: [new iam.ServicePrincipal("cloudwatch.amazonaws.com")],
      actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
      resources: ["*"],
    }));

    this.alarmTopic = new sns.Topic(this, "AlarmTopic", {
      topicName: `${config.stackPrefix}-alarms`,
      displayName: `${config.stackPrefix} Alarms`,
      masterKey: alarmTopicKey,
      // Adds a topic policy denying aws:SecureTransport=false (TLS-only).
      enforceSSL: true,
    });
    // An explicit topic policy replaces SNS's default policy, so CloudWatch
    // needs an explicit publish allow, scoped to alarms in this account.
    this.alarmTopic.addToResourcePolicy(new iam.PolicyStatement({
      sid: "AllowCloudWatchAlarmsPublish",
      principals: [new iam.ServicePrincipal("cloudwatch.amazonaws.com")],
      actions: ["sns:Publish"],
      resources: [this.alarmTopic.topicArn],
      conditions: { StringEquals: { "aws:SourceAccount": this.account } },
    }));
    if (config.alarmEmail !== undefined) {
      // SNS sends a confirmation email; alarms reach a human only after the
      // recipient accepts that subscription.
      this.alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail));
    }

    // -------------------------------------------------------------------
    // CloudWatch Log Groups (deliberate retention)
    // Use LogRetention instead of LogGroup to handle the case where Lambda
    // auto-created the log group before CDK took ownership. LogRetention uses
    // a custom resource with create-or-update (upsert) semantics — it sets
    // retention on existing log groups rather than failing with "already exists".
    // -------------------------------------------------------------------
    const functionNames = props.functionNames || [];
    const authorizerName = props.authorizerFunctionName ?? `${config.stackPrefix}-authorizer`;
    // Captured so the authorizer metric filters (below) can depend on the
    // LogRetention custom resource that upserts the authorizer's log group —
    // otherwise, on a first deploy where the authorizer has never run, the
    // group may not exist yet when the filters are created.
    let authorizerLogRetention: logs.LogRetention | undefined;
    // Captured so security metric filters (below) can depend on the
    // LogRetention custom resource that upserts each Lambda's log group on a
    // first deploy where the function has never run.
    // Construct IDs are derived from the function name (sanitized to
    // alphanumerics) so each function owns a STABLE logical ID regardless of
    // its position in `functionNames`. Reordering or removing an entry no
    // longer churns the logical IDs of the others (the index-based scheme did,
    // which caused the UPDATE_ROLLBACK_COMPLETE "already exists" incident).
    const idSuffix = (name: string) => name.replace(/[^a-zA-Z0-9]/g, "");
    const logRetentions = new Map<string, logs.LogRetention>();
    for (const functionName of functionNames) {
      const logRetention = new logs.LogRetention(this, `LogRetention-${idSuffix(functionName)}`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: retentionDays,
        removalPolicy: RemovalPolicy.RETAIN,
      });
      logRetentions.set(functionName, logRetention);
      if (functionName === authorizerName) {
        authorizerLogRetention = logRetention;
      }
    }

    // -------------------------------------------------------------------
    // Lambda Error Alarms
    // -------------------------------------------------------------------
    for (const functionName of functionNames) {
      const errorMetric = new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Errors",
        dimensionsMap: { FunctionName: functionName },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

      const errorAlarm = new cloudwatch.Alarm(this, `ErrorAlarm-${idSuffix(functionName)}`, {
        // alarmName intentionally omitted: a function-derived logical ID plus
        // an auto-generated physical name avoids the "already exists" collision
        // when migrating off the old index-based logical IDs (whose explicit
        // names survive until their delete completes). See the plan's strategy (a).
        metric: errorMetric,
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `Lambda errors > 5 in 5 min for ${functionName}`,
      });
      errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
    }

    // -------------------------------------------------------------------
    // Lambda Throttle Alarms
    // -------------------------------------------------------------------
    for (const functionName of functionNames) {
      const throttleMetric = new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Throttles",
        dimensionsMap: { FunctionName: functionName },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

      // Authorizer throttling remediation (Task 6): the OLD alarm required
      // Sum > 1 across 2 CONSECUTIVE 5-min periods. Lambda only emits a
      // Throttles datapoint when a throttle occurs, so the sporadic 1–2/hour
      // bursts seen in the incident produced isolated datapoints that never
      // chained across two periods — the alarm stayed OK and the team was
      // under-informed. Now: ANY throttle in a single 5-min window fires
      // (threshold 0, 1 datapoint). NOT_BREACHING is still correct — a period
      // with no throttles emits no datapoint and must read healthy.
      const throttleAlarm = new cloudwatch.Alarm(this, `ThrottleAlarm-${idSuffix(functionName)}`, {
        // alarmName intentionally omitted (see strategy (a) in the plan).
        metric: throttleMetric,
        threshold: 0,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription:
          `Lambda ${functionName} was throttled (any throttle in a 5-min window). ` +
          `Throttles on the authorizer break authentication — investigate account ` +
          `concurrency (L-B99A9384) and reserved-concurrency allocation.`,
      });
      throttleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
    }

    // -------------------------------------------------------------------
    // Authorizer throttling remediation (Task 6): account concurrency
    // saturation + authorizer DB/auth-failure detection.
    // -------------------------------------------------------------------
    this.addConcurrencyAndAuthFailureObservability(
      config,
      props.authorizerFunctionName,
      authorizerLogRetention,
    );

    // -------------------------------------------------------------------
    // Security observability: surface authentication failures,
    // authorization denials, privileged mutations, and audit-write failures as
    // CloudWatch metrics + alarms so security-critical events are no longer
    // invisible at the request/auth layer.
    // -------------------------------------------------------------------
    this.addSecurityObservability(config, logRetentions, props.apiAccessLogGroupName);

    // -------------------------------------------------------------------
    // Caller attribution for privileged operator Lambdas. Only created when function names are supplied.
    // -------------------------------------------------------------------
    if (props.privilegedInvokeFunctionNames && props.privilegedInvokeFunctionNames.length > 0) {
      this.addPrivilegedInvokeTrail(config, isProd, props.privilegedInvokeFunctionNames);
    }

    // -------------------------------------------------------------------
    // Feedback Queue Depth Alarm (degradation signal)
    // -------------------------------------------------------------------
    const queueDepthMetric = new cloudwatch.Metric({
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensionsMap: { QueueName: props.feedbackQueueName },
      statistic: "Maximum",
      period: Duration.minutes(5),
    });

    const queueDepthAlarm = new cloudwatch.Alarm(this, "FeedbackQueueDepthAlarm", {
      alarmName: `${config.stackPrefix}-feedback-queue-depth`,
      metric: queueDepthMetric,
      threshold: 50,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Feedback queue depth > 50 — possible degradation",
    });
    queueDepthAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // -------------------------------------------------------------------
    // Feedback job binding rejections (security signal)
    // The Feedback Engine emits JobBindingRejected (EMF, WREN/FeedbackEngine)
    // when a queue message's ids fail the DB ownership / draft↔document check.
    // The REST producer always sends server-derived ids, so any rejection
    // means a bug or a principal writing forged messages to the queue / DLQ.
    // -------------------------------------------------------------------
    const jobBindingRejectedMetric = new cloudwatch.Metric({
      namespace: "WREN/FeedbackEngine",
      metricName: "JobBindingRejected",
      dimensionsMap: { workload: "feedback_primary" },
      statistic: "Sum",
      period: Duration.minutes(5),
    });

    const jobBindingRejectedAlarm = new cloudwatch.Alarm(this, "FeedbackJobBindingRejectedAlarm", {
      alarmName: `${config.stackPrefix}-feedback-job-binding-rejected`,
      metric: jobBindingRejectedMetric,
      threshold: 0,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Feedback Engine rejected a queue message whose ids failed ownership/binding checks — possible forged SQS message",
    });
    jobBindingRejectedAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // -------------------------------------------------------------------
    // DLQ alarms (poison messages — needs investigation). Feedback has always
    // been wired; notification and document-ingest were silent until now.
    // -------------------------------------------------------------------
    this.addDlqVisibleAlarm(
      "FeedbackDlqAlarm",
      props.feedbackDlqName,
      "Messages in feedback DLQ — poison messages detected",
    );
    if (props.notificationDlqName !== undefined) {
      this.addDlqVisibleAlarm(
        "NotificationDlqAlarm",
        props.notificationDlqName,
        "Messages in notification DLQ — poison messages detected",
      );
    }
    if (props.documentIngestDlqName !== undefined) {
      this.addDlqVisibleAlarm(
        "DocumentIngestDlqAlarm",
        props.documentIngestDlqName,
        "Messages in document-ingest DLQ — poison messages detected",
      );
    }

    // -------------------------------------------------------------------
    // API Gateway Latency Alarm (p99)
    // -------------------------------------------------------------------
    const apiLatencyMetric = new cloudwatch.Metric({
      namespace: "AWS/ApiGateway",
      metricName: "Latency",
      dimensionsMap: { ApiName: `${config.stackPrefix}-api` },
      statistic: "p99",
      period: Duration.minutes(5),
    });

    const apiLatencyAlarm = new cloudwatch.Alarm(this, "ApiLatencyAlarm", {
      alarmName: `${config.stackPrefix}-api-latency-p99`,
      metric: apiLatencyMetric,
      threshold: 10000, // 10 seconds (REQ-NFR-LATENCY-01)
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "API p99 latency > 10s — review feedback generation path",
    });
    apiLatencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // -------------------------------------------------------------------
    // Prompt-cache observability (plan §16/§17): dashboard + alarms over the
    // WREN/Bedrock EMF metrics the runtime emits (dimensions: workload,
    // modelId). Under the default `observe` posture the runtime emits NO cache
    // writes/reads/fallbacks, so every cache alarm stays OK / insufficient-data
    // and never fires without real cache activity.
    // -------------------------------------------------------------------
    this.addCacheObservability(config, props.cacheAlarmThresholds);
  }

  /**
   * Account concurrency saturation + authorizer DB/auth-failure observability
   * (authorizer throttling remediation, Task 6). All alarms wire to
   * {@link alarmTopic}.
   */
  private addConcurrencyAndAuthFailureObservability(
    config: AppConfig,
    authorizerFunctionName: string | undefined,
    authorizerLogRetention: logs.LogRetention | undefined,
  ): void {
    const authorizerName = authorizerFunctionName ?? `${config.stackPrefix}-authorizer`;
    const limit = config.lambdaConcurrency.accountLimit;

    // ---- Account-wide concurrency saturation --------------------------------
    // The root cause was the account concurrent-executions pool (quota
    // L-B99A9384) saturating. Alarm BEFORE it is fully exhausted (80% of the
    // configured limit) so operators act before throttling starts. Uses the
    // account-level ConcurrentExecutions metric (no FunctionName dimension).
    const accountConcurrency = new cloudwatch.Metric({
      namespace: "AWS/Lambda",
      metricName: "ConcurrentExecutions",
      statistic: "Maximum",
      period: Duration.minutes(1),
    });
    const concurrencyAlarm = new cloudwatch.Alarm(this, "AccountConcurrencySaturationAlarm", {
      alarmName: `${config.stackPrefix}-account-concurrency-saturation`,
      metric: accountConcurrency,
      threshold: Math.floor(limit * 0.8),
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        `Account Lambda ConcurrentExecutions >= 80% of the configured limit ` +
        `(${limit}). The shared pool is nearing exhaustion — authorizer throttling ` +
        `risk. Review reserved concurrency and the L-B99A9384 quota.`,
    });
    concurrencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // ---- Authorizer log metric filters + alarms -----------------------------
    // Reference the authorizer's log group by name (LogRetention above manages
    // its retention). fromLogGroupName imports without trying to create it.
    const authorizerLogGroup = logs.LogGroup.fromLogGroupName(
      this,
      "AuthorizerLogGroupRef",
      `/aws/lambda/${authorizerName}`,
    );

    const authNamespace = `${config.stackPrefix}/Authorizer`;

    // Each entry: a metric filter turning a log pattern into a countable metric,
    // then an alarm on any occurrence. treatMissingData NOT_BREACHING keeps them
    // quiet when the pattern never appears.
    const logSignals: ReadonlyArray<{
      readonly id: string;
      readonly metricName: string;
      readonly pattern: logs.IFilterPattern;
      readonly alarmSuffix: string;
      readonly description: string;
    }> = [
      {
        // Runtime.ExitError: the crash-loop signature that amplified concurrency
        // during the incident (unhandled rejection kills the runtime).
        id: "Runtime ExitError",
        metricName: "RuntimeExitErrors",
        pattern: logs.FilterPattern.anyTerm("Runtime.ExitError"),
        alarmSuffix: "authorizer-runtime-exit",
        description:
          "Authorizer Runtime.ExitError — a container crash that forces cold starts " +
          "and amplifies concurrency. Investigate DB connectivity / unhandled rejections.",
      },
      {
        // DB connection guard opened (Task 3) — a credential-class failure window.
        id: "DB Guard Open",
        metricName: "DbConnectionGuardOpen",
        pattern: logs.FilterPattern.literal('{ $.event = "db_connection_guard_open" }'),
        alarmSuffix: "authorizer-db-guard-open",
        description:
          "Authorizer DB connection guard opened (credential-class DB failure). " +
          "Likely a password desync — check RDS Proxy / role secrets.",
      },
      {
        // Postgres 28P01 (invalid_password) — the desync error class.
        // Scoped with allTerms so it only fires on the authorizer's actual
        // error-log line (backend/auth/src/authorizer.ts logs
        // "Authorizer failed after token present:" followed by the pg error,
        // whose string form carries the SQLSTATE) — NOT any incidental mention
        // of the substring "28P01" elsewhere in the logs.
        id: "Postgres 28P01",
        metricName: "PostgresInvalidPassword",
        pattern: logs.FilterPattern.allTerms("Authorizer failed after token present", "28P01"),
        alarmSuffix: "authorizer-db-invalid-password",
        description:
          "Authorizer saw Postgres 28P01 (invalid_password) — credential desync on " +
          "the auth critical path.",
      },
      {
        // Postgres 42501 (insufficient_privilege) — the Sep 3 GRANT gap.
        // Scoped like the 28P01 filter to the authorizer's error-log line.
        id: "Postgres 42501",
        metricName: "PostgresPermissionDenied",
        pattern: logs.FilterPattern.allTerms("Authorizer failed after token present", "42501"),
        alarmSuffix: "authorizer-db-permission-denied",
        description:
          "Authorizer saw Postgres 42501 (permission denied) — a missing GRANT on the " +
          "wren_authorizer role. Apply 0002_authorizer_grants_repair.sql.",
      },
    ];

    for (const signal of logSignals) {
      const metricFilter = new logs.MetricFilter(this, `AuthMetricFilter-${signal.id}`, {
        logGroup: authorizerLogGroup,
        metricNamespace: authNamespace,
        metricName: signal.metricName,
        filterPattern: signal.pattern,
        metricValue: "1",
        defaultValue: 0,
      });
      // Ensure the authorizer log group exists (upserted by LogRetention)
      // before the filter is created — avoids a first-deploy ordering failure
      // when the authorizer has never run and its group does not yet exist.
      if (authorizerLogRetention) {
        metricFilter.node.addDependency(authorizerLogRetention);
      }

      const alarm = new cloudwatch.Alarm(this, `AuthAlarm-${signal.id}`, {
        alarmName: `${config.stackPrefix}-${signal.alarmSuffix}`,
        metric: metricFilter.metric({
          statistic: "Sum",
          period: Duration.minutes(5),
        }),
        threshold: 0,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: signal.description,
      });
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
    }
  }

  /**
   * Dedicated CloudTrail trail that records `lambda:Invoke` DATA events for the
   * given privileged operator functions ONLY, delivered to CloudWatch Logs
   * (queryable) and S3 (CloudTrail requires an S3 destination; file-integrity
   * validation is on).
   *
   * Why a trail: Lambda does not pass the IAM caller to the function, so the
   * function's own logs cannot say who invoked it. Invoke is a CloudTrail data
   * event, which is off by default, and the account's Control Tower baseline
   * trail is owned by the management account and has no data selectors.
   * Each record carries `userIdentity` (role/session ARN), `sourceIPAddress`,
   * and `eventTime` — never the invoke payload.
   * https://docs.aws.amazon.com/lambda/latest/dg/logging-using-cloudtrail.html
   *
   * Scope/cost: management events are excluded and the selector names exact
   * function ARNs, so volume is one record per operator invoke.
   */
  private addPrivilegedInvokeTrail(
    config: AppConfig,
    isProd: boolean,
    functionNames: readonly string[],
  ): void {
    const bucket = new s3.Bucket(this, "PrivilegedInvokeTrailBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      lifecycleRules: [
        {
          id: "ExpirePrivilegedInvokeTrail",
          expiration: Duration.days(isProd ? 365 : 90),
          noncurrentVersionExpiration: Duration.days(30),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
      // Audit evidence: never destroyed with the stack.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const logGroup = new logs.LogGroup(this, "PrivilegedInvokeTrailLogs", {
      logGroupName: `/aws/cloudtrail/${config.stackPrefix}-privileged-invokes`,
      // 24 hours (the CloudWatch Logs minimum) in every environment. The S3
      // copy delivered by the trail is the longer-lived record.
      retention: logs.RetentionDays.ONE_DAY,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const trailName = `${config.stackPrefix}-privileged-invokes`;
    // Confused-deputy guard: CDK's generated CloudTrail bucket-policy grants
    // carry no aws:SourceArn, so deny CloudTrail writes from any other trail.
    // https://docs.aws.amazon.com/awscloudtrail/latest/userguide/create-s3-bucket-policy-for-cloudtrail.html
    bucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: "DenyOtherTrails",
      effect: iam.Effect.DENY,
      principals: [new iam.ServicePrincipal("cloudtrail.amazonaws.com")],
      actions: ["s3:PutObject"],
      resources: [bucket.arnForObjects("*")],
      conditions: {
        StringNotEquals: {
          "aws:SourceArn": `arn:${this.partition}:cloudtrail:${this.region}:${this.account}:trail/${trailName}`,
        },
      },
    }));

    const trail = new cloudtrail.Trail(this, "PrivilegedInvokeTrail", {
      trailName,
      bucket,
      s3KeyPrefix: "privileged-invokes",
      sendToCloudWatchLogs: true,
      cloudWatchLogGroup: logGroup,
      // Functions are regional; nothing global to capture.
      isMultiRegionTrail: false,
      includeGlobalServiceEvents: false,
      // Data events only — the Control Tower baseline already covers management events.
      managementEvents: cloudtrail.ReadWriteType.NONE,
      enableFileValidation: true,
    });

    const functions = functionNames.map((name, i) =>
      lambda.Function.fromFunctionName(this, `PrivilegedInvokeFn${i}`, name),
    );
    trail.addLambdaEventSelector(functions, {
      includeManagementEvents: false,
      readWriteType: cloudtrail.ReadWriteType.ALL,
    });
  }

  /**
   * Security metric filters + alarms. Turns the structured log
   * lines the application now emits into countable metrics and alarms:
   *
   *   - Authentication failures  — authorizer `event: "auth_failure"`.
   *   - Authorization denials    — admin `event: "authz_denial"`.
   *   - Unauthorized API responses (401/403) — API Gateway access log.
   *   - Privileged document deletions — DELETE on the access log.
   *   - Audit-write failures     — admin/document `event: "audit_write_failed"`
   *     (a privileged action that could NOT be recorded — a security gap).
   *
   * Volume-based signals (auth failures, denials, 401/403, privileged deletes)
   * use non-zero thresholds so routine activity (an expired token, a single
   * legitimate delete) stays quiet and only anomalous bursts page. Audit-write
   * failures should never happen, so any occurrence alarms. All wire to
   * {@link alarmTopic} and use NOT_BREACHING so absent data reads healthy.
   */
  private addSecurityObservability(
    config: AppConfig,
    logRetentions: Map<string, logs.LogRetention>,
    apiAccessLogGroupName: string | undefined,
  ): void {
    const securityNamespace = `${config.stackPrefix}/Security`;
    const authorizerName = `${config.stackPrefix}-authorizer`;
    const adminName = `${config.stackPrefix}-admin`;
    const documentName = `${config.stackPrefix}-document`;

    // Create one metric filter (log pattern -> metric) plus an alarm on it.
    const addLogSignal = (opts: {
      id: string;
      logGroupName: string;
      dependency?: logs.LogRetention;
      metricName: string;
      pattern: logs.IFilterPattern;
      alarmSuffix: string;
      threshold: number;
      description: string;
    }): void => {
      const logGroup = logs.LogGroup.fromLogGroupName(
        this,
        `SecLogGroupRef-${opts.id}`,
        opts.logGroupName,
      );
      const metricFilter = new logs.MetricFilter(this, `SecMetricFilter-${opts.id}`, {
        logGroup,
        metricNamespace: securityNamespace,
        metricName: opts.metricName,
        filterPattern: opts.pattern,
        metricValue: "1",
        defaultValue: 0,
      });
      if (opts.dependency) {
        metricFilter.node.addDependency(opts.dependency);
      }
      const alarm = new cloudwatch.Alarm(this, `SecAlarm-${opts.id}`, {
        alarmName: `${config.stackPrefix}-${opts.alarmSuffix}`,
        metric: metricFilter.metric({
          statistic: "Sum",
          period: Duration.minutes(5),
        }),
        threshold: opts.threshold,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: opts.description,
      });
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
    };

    // ---- Authentication failures (authorizer log) --------------------------
    // Routine at low volume (expired tokens); a burst suggests credential
    // stuffing / a broken client. Alarm above 25 failures in a 5-min window.
    addLogSignal({
      id: "AuthFailures",
      logGroupName: `/aws/lambda/${authorizerName}`,
      dependency: logRetentions.get(authorizerName),
      metricName: "AuthenticationFailures",
      pattern: logs.FilterPattern.literal('{ $.event = "auth_failure" }'),
      alarmSuffix: "auth-failures",
      threshold: 25,
      description:
        "Elevated authentication failures at the authorizer (>25 / 5 min). " +
        "Possible credential stuffing or a misconfigured client.",
    });

    // ---- Authorization denials (admin log) ---------------------------------
    // A denied capability for a legitimate user is rare; a spike suggests
    // privilege probing. Alarm above 10 denials in a 5-min window.
    addLogSignal({
      id: "AuthzDenials",
      logGroupName: `/aws/lambda/${adminName}`,
      dependency: logRetentions.get(adminName),
      metricName: "AuthorizationDenials",
      pattern: logs.FilterPattern.literal('{ $.event = "authz_denial" }'),
      alarmSuffix: "authz-denials",
      threshold: 10,
      description:
        "Elevated authorization denials in the Admin service (>10 / 5 min). " +
        "Possible privilege probing — review the denied actors and capabilities.",
    });

    // ---- Audit-write failures (admin + document logs) ----------------------
    // A privileged action succeeded but its audit record could NOT be written
    // (e.g. a missing GRANT). This must never happen, so ANY occurrence alarms.
    for (const [svc, fnName] of [
      ["Admin", adminName],
      ["Document", documentName],
    ] as const) {
      addLogSignal({
        id: `AuditWriteFailures-${svc}`,
        logGroupName: `/aws/lambda/${fnName}`,
        dependency: logRetentions.get(fnName),
        metricName: "AuditWriteFailures",
        pattern: logs.FilterPattern.literal('{ $.event = "audit_write_failed" }'),
        alarmSuffix: `audit-write-failures-${svc.toLowerCase()}`,
        threshold: 0,
        description:
          `A privileged action in the ${svc} service could not be audited ` +
          "(audit_write_failed). The retention/audit contract is at risk — " +
          "check the wren_document/wren_admin GRANT on activity_event.",
      });
    }

    // ---- Prompt-injection guardrail skipped (admin log) --------------------
    // The admin prompt-injection scan fails closed when PROMPT_GUARDRAIL_ID is
    // unset and logs `prompt_guardrail_skipped`. Deployed
    // environments always have the id and never set the dev bypass, so ANY
    // occurrence alarms.
    addLogSignal({
      id: "PromptGuardrailSkipped",
      logGroupName: `/aws/lambda/${adminName}`,
      dependency: logRetentions.get(adminName),
      metricName: "PromptGuardrailSkipped",
      pattern: logs.FilterPattern.literal('{ $.event = "prompt_guardrail_skipped" }'),
      alarmSuffix: "prompt-guardrail-skipped",
      threshold: 0,
      description:
        "Admin prompt-injection guardrail scan was skipped (guardrail unconfigured " +
        "or dev bypass). Any occurrence in a deployed environment indicates " +
        "misconfiguration — check PROMPT_GUARDRAIL_ID on the Admin Lambda.",
    });

    // ---- API Gateway access-log signals ------------------------------------
    // Only when the access log group name is wired in (skipped in unit tests
    // that synth this stack in isolation).
    if (apiAccessLogGroupName) {
      // Unauthorized responses (401/403) across ALL services — complements the
      // authorizer/admin log filters by also catching 403s from other services.
      addLogSignal({
        id: "ApiUnauthorized",
        logGroupName: apiAccessLogGroupName,
        metricName: "ApiUnauthorizedResponses",
        pattern: logs.FilterPattern.literal("{ $.status = 401 || $.status = 403 }"),
        alarmSuffix: "api-unauthorized",
        threshold: 25,
        description:
          "Elevated 401/403 responses at API Gateway (>25 / 5 min) — possible " +
          "unauthorized-access attempts across services.",
      });

      // Privileged document deletions — destructive, permanent removal of
      // student work. A single delete is legitimate; a burst is suspicious.
      addLogSignal({
        id: "PrivilegedDocumentDeletes",
        logGroupName: apiAccessLogGroupName,
        metricName: "PrivilegedDocumentDeletes",
        pattern: logs.FilterPattern.literal(
          '{ ($.httpMethod = "DELETE") && ($.resourcePath = "/v1/documents/{documentId}") }',
        ),
        alarmSuffix: "privileged-document-deletes",
        threshold: 10,
        description:
          "Elevated document deletions (>10 / 5 min). Deletion permanently " +
          "destroys student work and attached feedback — review the actors.",
      });
    }
  }

  /**
   * Build the prompt-cache dashboard and alarms. Kept in a helper to keep the
   * constructor readable; all resources are wired to {@link alarmTopic} exactly
   * like the surrounding alarms.
   */
  private addCacheObservability(
    config: AppConfig,
    overrides: CacheAlarmThresholds | undefined,
  ): void {
    const t: Required<CacheAlarmThresholds> = {
      ...DEFAULT_CACHE_ALARM_THRESHOLDS,
      ...(overrides ?? {}),
    };
    const period = Duration.minutes(5);

    // Account-wide (all workloads) cache metrics. No dimensions => CloudWatch
    // aggregates across every workload/modelId, matching the plan's summary.
    const bedrockMetric = (metricName: string, statistic = "Sum"): cloudwatch.Metric =>
      new cloudwatch.Metric({
        namespace: WREN_BEDROCK_NAMESPACE,
        metricName,
        statistic,
        period,
      });

    const invocations = bedrockMetric("Invocations");
    const cacheWrite = bedrockMetric("CacheWriteInputTokens");
    const cacheRead = bedrockMetric("CacheReadInputTokens");
    const cacheFallbacks = bedrockMetric("CacheFallbacks");
    const estimatedCost = bedrockMetric("EstimatedCostUsd");
    const estimatedSavings = bedrockMetric("EstimatedSavingsUsd");
    const latencyAvg = bedrockMetric("InvocationLatency", "Average");
    const latencyP99 = bedrockMetric("InvocationLatency", "p99");

    // ---- Dashboard ---------------------------------------------------------
    const dashboard = new cloudwatch.Dashboard(this, "CacheDashboard", {
      dashboardName: `${config.stackPrefix}-prompt-cache`,
    });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Cache read vs write tokens",
        left: [cacheWrite, cacheRead],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Cache fallbacks & invocations",
        left: [cacheFallbacks, invocations],
        width: 12,
      }),
    );
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Estimated cost vs savings (USD)",
        left: [estimatedCost, estimatedSavings],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: "Invocation latency (avg / p99)",
        left: [latencyAvg, latencyP99],
        width: 12,
      }),
    );
    // Per-workload latency breakdown (plan §16: "latency by workload").
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Latency by workload (avg)",
        left: CACHE_WORKLOADS.map(
          (workload) =>
            new cloudwatch.Metric({
              namespace: WREN_BEDROCK_NAMESPACE,
              metricName: "InvocationLatency",
              dimensionsMap: { workload, modelId: config.bedrockModelId },
              statistic: "Average",
              period,
              label: workload,
            }),
        ),
        width: 24,
      }),
    );

    // ---- Alarm (a): write-without-read waste --------------------------------
    // Sustained cache writes while reads are ~0 means we pay the 1.25x write
    // premium and never amortize it. Metric math yields 1 only when writes are
    // meaningful AND reads are at/below the floor; otherwise 0. treatMissingData
    // NOT_BREACHING keeps it quiet when no cache metrics exist at all (observe).
    const writeWithoutRead = new cloudwatch.MathExpression({
      // 1 only when writes exceed the threshold AND reads are at/below the floor.
      expression: `IF(w > ${t.writeWithoutReadWriteTokens} AND r <= ${t.writeWithoutReadReadFloor}, 1, 0)`,
      usingMetrics: { w: cacheWrite, r: cacheRead },
      period,
      label: "CacheWriteWithoutRead",
    });
    const writeWithoutReadAlarm = new cloudwatch.Alarm(this, "CacheWriteWithoutReadAlarm", {
      alarmName: `${config.stackPrefix}-cache-write-without-read`,
      metric: writeWithoutRead,
      threshold: 0,
      evaluationPeriods: t.writeWithoutReadPeriods,
      datapointsToAlarm: t.writeWithoutReadPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Sustained cache writes with ~0 cache reads — write premium is not being amortized.",
    });
    writeWithoutReadAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // ---- Alarm (b): elevated cache fallbacks --------------------------------
    const fallbacksAlarm = new cloudwatch.Alarm(this, "CacheFallbacksAlarm", {
      alarmName: `${config.stackPrefix}-cache-fallbacks`,
      metric: cacheFallbacks,
      threshold: t.fallbacksThreshold,
      evaluationPeriods: t.fallbacksPeriods,
      datapointsToAlarm: t.fallbacksPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Elevated Bedrock cache fallbacks — cache path is degrading to uncached invocations.",
    });
    fallbacksAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

    // ---- Alarm (c): cost regression -----------------------------------------
    // Fires when caching is ACTIVELY writing (w > threshold) yet net savings are
    // non-positive OR estimated cost is materially high. Gating on writes keeps
    // it silent under observe (no writes => expression is 0). Value is 1 on
    // regression, 0 otherwise.
    const costRegression = new cloudwatch.MathExpression({
      expression: `IF(w > ${t.writeWithoutReadWriteTokens} AND (s <= 0 OR c > ${t.costRegressionUsd}), 1, 0)`,
      usingMetrics: { w: cacheWrite, s: estimatedSavings, c: estimatedCost },
      period,
      label: "CacheCostRegression",
    });
    const costRegressionAlarm = new cloudwatch.Alarm(this, "CacheCostRegressionAlarm", {
      alarmName: `${config.stackPrefix}-cache-cost-regression`,
      metric: costRegression,
      threshold: 0,
      evaluationPeriods: t.costRegressionPeriods,
      datapointsToAlarm: t.costRegressionPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription:
        "Cache writes are occurring but net savings are non-positive (or cost is materially high) — economic regression.",
    });
    costRegressionAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
  }

  /** Alarm when any message is visible on a DLQ (threshold 0, one 5-min period). */
  private addDlqVisibleAlarm(
    id: string,
    queueName: string,
    alarmDescription: string,
  ): void {
    const metric = new cloudwatch.Metric({
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensionsMap: { QueueName: queueName },
      statistic: "Maximum",
      period: Duration.minutes(5),
    });
    const alarm = new cloudwatch.Alarm(this, id, {
      alarmName: `${queueName}-messages`,
      metric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription,
    });
    alarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
  }
}
