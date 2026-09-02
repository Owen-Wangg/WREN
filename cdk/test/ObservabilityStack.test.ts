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
    template.resourceCountIs("AWS::CloudWatch::Alarm", 5);
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
