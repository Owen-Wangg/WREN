import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ObservabilityStack } from "../lib/stacks/ObservabilityStack.js";
import { testConfig } from "./helpers.js";

function synthObservability(alarmEmail?: string): Template {
  const app = new App();
  const stack = new ObservabilityStack(app, "wren-test-Observability", {
    env: testConfig().env,
    config: testConfig(alarmEmail ? { alarmEmail } : {}),
    functionNames: ["wren-test-feedback-engine"],
    feedbackQueueName: "wren-test-feedback-queue",
    feedbackDlqName: "wren-test-feedback-dlq",
  });
  return Template.fromStack(stack);
}

describe("ObservabilityStack", () => {
  it("keeps alarm resources while not creating a subscription without a configured recipient", () => {
    const template = synthObservability();

    template.resourceCountIs("AWS::SNS::Topic", 1);
    template.resourceCountIs("AWS::SNS::Subscription", 0);
    // 5 baseline alarms + 3 prompt-cache alarms + 1 account-concurrency
    // saturation alarm + 4 authorizer DB/auth-failure alarms (Runtime.ExitError,
    // DB guard open, Postgres 28P01, Postgres 42501).
    template.resourceCountIs("AWS::CloudWatch::Alarm", 13);
  });

  it("creates an email subscription only when an alarm recipient is configured", () => {
    const template = synthObservability("oncall@example.test");

    template.resourceCountIs("AWS::SNS::Subscription", 1);
    template.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "oncall@example.test",
      TopicArn: Match.anyValue(),
    });
  });
});

describe("ObservabilityStack — prompt-cache observability (plan §16/§17)", () => {
  it("creates a prompt-cache dashboard summarizing cache metrics", () => {
    const template = synthObservability();

    template.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    template.hasResourceProperties("AWS::CloudWatch::Dashboard", {
      DashboardName: "wren-test-prompt-cache",
    });
  });

  it("creates all three cache alarm categories wired to the alarm topic", () => {
    const template = synthObservability();

    // Resolve the SNS topic logical id so we can assert alarm wiring.
    const topics = template.findResources("AWS::SNS::Topic");
    const topicLogicalId = Object.keys(topics)[0]!;

    for (const alarmName of [
      "wren-test-cache-write-without-read",
      "wren-test-cache-fallbacks",
      "wren-test-cache-cost-regression",
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
        AlarmActions: Match.arrayWith([{ Ref: topicLogicalId }]),
        // Cache alarms must never breach on missing data (observe posture).
        TreatMissingData: "notBreaching",
      });
    }
  });

  it("the elevated-fallbacks alarm references the WREN/Bedrock CacheFallbacks metric", () => {
    const template = synthObservability();

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "wren-test-cache-fallbacks",
      Namespace: "WREN/Bedrock",
      MetricName: "CacheFallbacks",
    });
  });

  it("the write-without-read and cost-regression alarms use metric math over WREN/Bedrock metrics", () => {
    const template = synthObservability();

    // Metric-math alarms carry a Metrics array (no top-level MetricName). Both
    // must reference the WREN/Bedrock namespace via their sourced metrics.
    for (const alarmName of [
      "wren-test-cache-write-without-read",
      "wren-test-cache-cost-regression",
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
        Metrics: Match.arrayWith([
          Match.objectLike({
            MetricStat: Match.objectLike({
              Metric: Match.objectLike({ Namespace: "WREN/Bedrock" }),
            }),
          }),
        ]),
      });
    }
  });

  it("honors configurable thresholds", () => {
    const app = new App();
    const stack = new ObservabilityStack(app, "wren-test-Observability", {
      env: testConfig().env,
      config: testConfig(),
      functionNames: ["wren-test-feedback-engine"],
      feedbackQueueName: "wren-test-feedback-queue",
      feedbackDlqName: "wren-test-feedback-dlq",
      cacheAlarmThresholds: { fallbacksThreshold: 42 },
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "wren-test-cache-fallbacks",
      MetricName: "CacheFallbacks",
      Threshold: 42,
    });
  });
});

describe("ObservabilityStack — authorizer throttling remediation (Task 6)", () => {
  function synth(): Template {
    const app = new App();
    const stack = new ObservabilityStack(app, "wren-test-Observability", {
      env: testConfig().env,
      config: testConfig(),
      functionNames: ["wren-test-authorizer", "wren-test-feedback-engine"],
      feedbackQueueName: "wren-test-feedback-queue",
      feedbackDlqName: "wren-test-feedback-dlq",
      authorizerFunctionName: "wren-test-authorizer",
    });
    return Template.fromStack(stack);
  }

  it("fires the throttle alarm on ANY throttle in a single 5-min window", () => {
    const template = synth();
    // The fix: threshold 0, one datapoint, one period — no longer requires two
    // consecutive periods (which sporadic throttles never satisfied).
    // NOTE: alarm names embed the (already-prefixed) function name, so the
    // stackPrefix appears twice — matching the deployed
    // `wren-dev-wren-dev-authorizer-throttles` name from the incident.
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "wren-test-wren-test-authorizer-throttles",
      MetricName: "Throttles",
      Namespace: "AWS/Lambda",
      Dimensions: Match.arrayWith([
        { Name: "FunctionName", Value: "wren-test-authorizer" },
      ]),
      Threshold: 0,
      EvaluationPeriods: 1,
      DatapointsToAlarm: 1,
      TreatMissingData: "notBreaching",
    });
  });

  it("alarms on account concurrency nearing the configured limit (80%)", () => {
    const template = synth();
    // Default accountLimit is 200 -> 80% = 160. No FunctionName dimension
    // (account-wide ConcurrentExecutions).
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "wren-test-account-concurrency-saturation",
      MetricName: "ConcurrentExecutions",
      Namespace: "AWS/Lambda",
      Threshold: 160,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
    });
  });

  it("creates metric filters on the authorizer log group for the failure signatures", () => {
    const template = synth();
    template.resourceCountIs("AWS::Logs::MetricFilter", 4);
    for (const metricName of [
      "RuntimeExitErrors",
      "DbConnectionGuardOpen",
      "PostgresInvalidPassword",
      "PostgresPermissionDenied",
    ]) {
      template.hasResourceProperties("AWS::Logs::MetricFilter", {
        LogGroupName: "/aws/lambda/wren-test-authorizer",
        MetricTransformations: Match.arrayWith([
          Match.objectLike({ MetricName: metricName, MetricNamespace: "wren-test/Authorizer" }),
        ]),
      });
    }
  });

  it("creates the four authorizer DB/auth-failure alarms wired to the topic", () => {
    const template = synth();
    const topics = template.findResources("AWS::SNS::Topic");
    const topicLogicalId = Object.keys(topics)[0]!;

    for (const alarmName of [
      "wren-test-authorizer-runtime-exit",
      "wren-test-authorizer-db-guard-open",
      "wren-test-authorizer-db-invalid-password",
      "wren-test-authorizer-db-permission-denied",
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
        AlarmActions: Match.arrayWith([{ Ref: topicLogicalId }]),
        TreatMissingData: "notBreaching",
      });
    }
  });
});

describe("ObservabilityStack — DLQ coverage", () => {
  it("does not add notification or ingest DLQ alarms when those names are omitted", () => {
    const template = synthObservability();
    const alarms = Object.values(template.findResources("AWS::CloudWatch::Alarm"));
    const names = alarms.map((alarm) => alarm.Properties?.AlarmName as string);
    expect(names).toContain("wren-test-feedback-dlq-messages");
    expect(names).not.toContain("wren-test-notification-dlq-messages");
    expect(names).not.toContain("wren-test-document-ingest-dlq-messages");
  });

  it("alarms when any message is visible on the notification or document-ingest DLQ", () => {
    const app = new App();
    const stack = new ObservabilityStack(app, "wren-test-Observability", {
      env: testConfig().env,
      config: testConfig(),
      functionNames: ["wren-test-feedback-engine"],
      feedbackQueueName: "wren-test-feedback-queue",
      feedbackDlqName: "wren-test-feedback-dlq",
      notificationDlqName: "wren-test-notification-dlq",
      documentIngestDlqName: "wren-test-document-ingest-dlq",
    });
    const template = Template.fromStack(stack);
    const topics = template.findResources("AWS::SNS::Topic");
    const topicLogicalId = Object.keys(topics)[0]!;

    for (const alarmName of [
      "wren-test-feedback-dlq-messages",
      "wren-test-notification-dlq-messages",
      "wren-test-document-ingest-dlq-messages",
    ]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        AlarmName: alarmName,
        MetricName: "ApproximateNumberOfMessagesVisible",
        Namespace: "AWS/SQS",
        Threshold: 0,
        EvaluationPeriods: 1,
        TreatMissingData: "notBreaching",
        AlarmActions: Match.arrayWith([{ Ref: topicLogicalId }]),
      });
    }
  });
});
