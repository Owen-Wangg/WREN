import { Stack, type StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
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
 *   - Feedback DLQ messages (poison messages — needs investigation)
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
    this.alarmTopic = new sns.Topic(this, "AlarmTopic", {
      topicName: `${config.stackPrefix}-alarms`,
      displayName: `${config.stackPrefix} Alarms`,
    });
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
    for (let i = 0; i < functionNames.length; i++) {
      const functionName = functionNames[i]!;
      new logs.LogRetention(this, `LogRetention${i}`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: retentionDays,
        removalPolicy: RemovalPolicy.RETAIN,
      });
    }

    // -------------------------------------------------------------------
    // Lambda Error Alarms
    // -------------------------------------------------------------------
    for (let i = 0; i < functionNames.length; i++) {
      const functionName = functionNames[i]!;
      const errorMetric = new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Errors",
        dimensionsMap: { FunctionName: functionName },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

      const errorAlarm = new cloudwatch.Alarm(this, `ErrorAlarm${i}`, {
        alarmName: `${config.stackPrefix}-${functionName}-errors`,
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
    for (let i = 0; i < functionNames.length; i++) {
      const functionName = functionNames[i]!;
      const throttleMetric = new cloudwatch.Metric({
        namespace: "AWS/Lambda",
        metricName: "Throttles",
        dimensionsMap: { FunctionName: functionName },
        statistic: "Sum",
        period: Duration.minutes(5),
      });

      const throttleAlarm = new cloudwatch.Alarm(this, `ThrottleAlarm${i}`, {
        alarmName: `${config.stackPrefix}-${functionName}-throttles`,
        metric: throttleMetric,
        threshold: 1,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `Lambda throttled for ${functionName}`,
      });
      throttleAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));
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
    // Feedback DLQ Alarm (poison messages — needs investigation)
    // -------------------------------------------------------------------
    const dlqMetric = new cloudwatch.Metric({
      namespace: "AWS/SQS",
      metricName: "ApproximateNumberOfMessagesVisible",
      dimensionsMap: { QueueName: props.feedbackDlqName },
      statistic: "Maximum",
      period: Duration.minutes(5),
    });

    const dlqAlarm = new cloudwatch.Alarm(this, "FeedbackDlqAlarm", {
      alarmName: `${config.stackPrefix}-feedback-dlq-messages`,
      metric: dlqMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: "Messages in feedback DLQ — poison messages detected",
    });
    dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alarmTopic));

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
}
