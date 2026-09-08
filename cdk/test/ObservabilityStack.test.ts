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
    // 5 baseline alarms + 3 prompt-cache alarms (write-without-read, fallbacks,
    // cost-regression).
    template.resourceCountIs("AWS::CloudWatch::Alarm", 8);
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
