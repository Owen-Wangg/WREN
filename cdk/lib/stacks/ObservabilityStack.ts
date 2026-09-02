import { Stack, type StackProps, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import type { Construct } from "constructs";

import type { AppConfig } from "../config";

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
}

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
  }
}
