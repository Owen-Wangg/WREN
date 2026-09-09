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
    auditFunctionArn: lambdaArn("audit"),
    notificationFunctionArn: lambdaArn("notification"),
  });
  return Template.fromStack(stack);
}

describe("ApiStack CORS", () => {
  it("does not publish Access-Control-Allow-Origin: * on OPTIONS or gateway errors", () => {
    const template = JSON.stringify(synthApi().toJSON());
    expect(template).not.toContain("Access-Control-Allow-Origin\": \"'*'\"");
    expect(template).not.toContain("Access-Control-Allow-Origin\":\"'*'\"");
  });

  it("OPTIONS MOCK VTL allowlists localhost and Amplify default hosts", () => {
    const template = JSON.stringify(synthApi().toJSON());
    expect(template).toContain("$origin == \\\"http://localhost:5173\\\"");
    expect(template).toContain("amplifyapp");
    expect(template).toContain("responseOverride.header.Access-Control-Allow-Origin");
  });

  it("includes the custom domain in OPTIONS VTL when configured", () => {
    const template = JSON.stringify(synthApi({ customDomain: "coach.example.com" }).toJSON());
    expect(template).toContain("$origin == \\\"https://coach.example.com\\\"");
    expect(template).toContain("$origin == \\\"https://www.coach.example.com\\\"");
  });

  it("echoes the request Origin on gateway-generated errors instead of *", () => {
    const template = synthApi();
    template.hasResourceProperties("AWS::ApiGateway::GatewayResponse", {
      ResponseParameters: Match.objectLike({
        "gatewayresponse.header.Access-Control-Allow-Origin": "method.request.header.Origin",
      }),
    });
  });
});
