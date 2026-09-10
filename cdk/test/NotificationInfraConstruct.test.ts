import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { NotificationInfraConstruct } from "../lib/constructs/NotificationInfraConstruct.js";

describe("NotificationInfraConstruct", () => {
  it("sets notification-queue visibility timeout to 6× the 30s Lambda timeout", () => {
    const stack = new Stack(new App(), "NotificationInfraTest");
    new NotificationInfraConstruct(stack, "NotificationInfra", {
      stackPrefix: "wren-test",
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::SQS::Queue", {
      QueueName: "wren-test-notification-queue",
      VisibilityTimeout: 180,
    });
  });
});
