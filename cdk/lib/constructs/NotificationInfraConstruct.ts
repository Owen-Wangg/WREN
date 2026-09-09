import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as ssm from "aws-cdk-lib/aws-ssm";

export interface NotificationInfraConstructProps {
  readonly stackPrefix: string;
}

/**
 * Notification infrastructure construct (Wave 7).
 *
 * Creates the messaging backbone for in-app notifications:
 *   - SNS topic for publishing notification events
 *   - SQS queue (with DLQ) for reliable, ordered processing
 *   - SSM Parameters for configurable notification thresholds
 *
 * The construct exposes all created resources as public properties so that
 * downstream constructs (e.g. Lambda consumers, monitoring) can reference them.
 */
export class NotificationInfraConstruct extends Construct {
  public readonly topic: sns.Topic;
  public readonly queue: sqs.Queue;
  public readonly dlq: sqs.Queue;

  public readonly toastDurationMsParam: ssm.StringParameter;
  public readonly toastMaxVisibleParam: ssm.StringParameter;
  public readonly deliveryTargetMsParam: ssm.StringParameter;
  public readonly defaultDedupWindowMinParam: ssm.StringParameter;
  public readonly usageWarningThresholdPctParam: ssm.StringParameter;
  public readonly dlqThresholdParam: ssm.StringParameter;
  public readonly overrideExpiryWarningHoursParam: ssm.StringParameter;

  constructor(scope: Construct, id: string, props: NotificationInfraConstructProps) {
    super(scope, id);

    const { stackPrefix } = props;

    // --- SNS Topic ---
    this.topic = new sns.Topic(this, "NotificationEventsTopic", {
      topicName: `${stackPrefix}-notification-events`,
    });

    // --- Dead Letter Queue ---
    this.dlq = new sqs.Queue(this, "NotificationDLQ", {
      queueName: `${stackPrefix}-notification-dlq`,
      retentionPeriod: Duration.days(14),
    });

    // --- Main SQS Queue ---
    this.queue = new sqs.Queue(this, "NotificationQueue", {
      queueName: `${stackPrefix}-notification-queue`,
      // AWS SQS+Lambda: visibility timeout must be ≥ 6× the function timeout
      // so a throttle/retry cannot redeliver while the original invoke is live.
      // NotificationFn timeout is 30s → 180s.
      visibilityTimeout: Duration.minutes(3),
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: 3,
      },
    });

    // --- SNS → SQS Subscription ---
    this.topic.addSubscription(
      new subscriptions.SqsSubscription(this.queue),
    );

    // --- SSM Parameters (configurable thresholds) ---
    const paramPrefix = `/${stackPrefix}/notifications`;

    this.toastDurationMsParam = new ssm.StringParameter(this, "ToastDurationMs", {
      parameterName: `${paramPrefix}/toast-duration-ms`,
      stringValue: "5000",
      description: "Duration in ms a toast notification remains visible.",
    });

    this.toastMaxVisibleParam = new ssm.StringParameter(this, "ToastMaxVisible", {
      parameterName: `${paramPrefix}/toast-max-visible`,
      stringValue: "3",
      description: "Maximum number of simultaneously visible toast notifications.",
    });

    this.deliveryTargetMsParam = new ssm.StringParameter(this, "DeliveryTargetMs", {
      parameterName: `${paramPrefix}/delivery-target-ms`,
      stringValue: "2000",
      description: "Target delivery latency in ms for notification delivery.",
    });

    this.defaultDedupWindowMinParam = new ssm.StringParameter(this, "DefaultDedupWindowMin", {
      parameterName: `${paramPrefix}/default-dedup-window-min`,
      stringValue: "60",
      description: "Default deduplication window in minutes for repeated notifications.",
    });

    this.usageWarningThresholdPctParam = new ssm.StringParameter(this, "UsageWarningThresholdPct", {
      parameterName: `${paramPrefix}/usage-warning-threshold-pct`,
      stringValue: "80",
      description: "Usage percentage threshold that triggers a warning notification.",
    });

    this.dlqThresholdParam = new ssm.StringParameter(this, "DlqThreshold", {
      parameterName: `${paramPrefix}/dlq-threshold`,
      stringValue: "5",
      description: "Number of messages in DLQ before alerting.",
    });

    this.overrideExpiryWarningHoursParam = new ssm.StringParameter(this, "OverrideExpiryWarningHours", {
      parameterName: `${paramPrefix}/override-expiry-warning-hours`,
      stringValue: "24",
      description: "Hours before override expiry to send a warning notification.",
    });
  }
}
