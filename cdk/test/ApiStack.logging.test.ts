import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { ApiStack } from "../lib/stacks/ApiStack.js";
import { testConfig, TEST_ACCOUNT, TEST_REGION } from "./helpers.js";

const lambdaArn = (name: string): string =>
  `arn:aws:lambda:${TEST_REGION}:${TEST_ACCOUNT}:function:wren-test-${name}`;

function synthApi(overrides: Parameters<typeof testConfig>[0] = {}) {
  const config = testConfig(overrides);
  const app = new App();
  const stack = new ApiStack(app, `${config.stackPrefix}-Api`, {
    env: config.env,
    config,
    authorizerFunctionArn: lambdaArn("authorizer"),
    documentFunctionArn: lambdaArn("document"),
    feedbackFunctionArn: lambdaArn("feedback-orchestrator"),
    adminFunctionArn: lambdaArn("admin"),
    notificationFunctionArn: lambdaArn("notification"),
  });
  return { config, template: Template.fromStack(stack) };
}

/**
 * CloudWatch logging tests for `${StackPrefix}-Api` (logging review gaps 2.2
 * and 3.1):
 *   - the API Gateway *execution* log group is bounded by a retention custom
 *     resource (it is service-created at "never expire" otherwise);
 *   - a structured, retention-bound *access* log group receives one JSON
 *     record per request for the edge audit trail.
 */
describe("ApiStack logging", () => {
  it("bounds the service-created API Gateway execution log group (gap 2.2)", () => {
    const { config, template } = synthApi();

    // The LogRetention custom resource targets the execution-log group name
    // API Gateway creates for the stage. 30 days for the non-prod test config.
    const retentions = template.findResources("Custom::LogRetention");
    const match = Object.values(retentions).find((r) => {
      const name = JSON.stringify(r.Properties?.LogGroupName ?? "");
      return name.includes("API-Gateway-Execution-Logs_");
    });
    expect(match).toBeDefined();
    expect(match?.Properties?.RetentionInDays).toBe(30);
    // Stage name is part of the group name.
    expect(JSON.stringify(match?.Properties?.LogGroupName)).toContain(
      config.environmentName,
    );
  });

  it("creates a retention-bound access log group (gap 3.1)", () => {
    const { config, template } = synthApi();
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: `/aws/apigateway/${config.stackPrefix}-api/access`,
      RetentionInDays: 30,
    });
  });

  it("retains the access log group on stack teardown", () => {
    const { template } = synthApi();
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: Match.objectLike({
        LogGroupName: Match.stringLikeRegexp("/aws/apigateway/.*/access"),
      }),
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("wires the stage to the access log group with a structured JSON format", () => {
    const { template } = synthApi();
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      AccessLogSetting: Match.objectLike({
        DestinationArn: Match.anyValue(),
        // The format is a JSON string carrying the review's audit fields.
        Format: Match.stringLikeRegexp('.*requestId.*status.*'),
      }),
    });
  });

  it("access log format includes source IP, method, path, and latency", () => {
    const { template } = synthApi();
    const stages = template.findResources("AWS::ApiGateway::Stage");
    const format = JSON.stringify(
      Object.values(stages)[0]?.Properties?.AccessLogSetting?.Format ?? "",
    );
    expect(format).toContain("sourceIp");
    expect(format).toContain("httpMethod");
    expect(format).toContain("resourcePath");
    expect(format).toContain("responseLatency");
    expect(format).toContain("responseLength");
  });

  it("uses 90-day retention in production", () => {
    const { config, template } = synthApi({
      environmentName: "prod",
      stackPrefix: "wren-prod",
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: `/aws/apigateway/${config.stackPrefix}-api/access`,
      RetentionInDays: 90,
    });
  });
});
