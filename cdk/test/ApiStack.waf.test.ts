import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { ApiStack } from "../lib/stacks/ApiStack.js";
import { testConfig, TEST_ACCOUNT, TEST_REGION } from "./helpers.js";

const lambdaArn = (name: string): string =>
  `arn:aws:lambda:${TEST_REGION}:${TEST_ACCOUNT}:function:wren-test-${name}`;

function synthApi() {
  const config = testConfig();
  const stack = new ApiStack(new App(), `${config.stackPrefix}-Api`, {
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

describe("ApiStack WAF", () => {
  it("creates a REGIONAL WebACL with the per-IP rate rule", () => {
    const { config, template } = synthApi();
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Name: `${config.stackPrefix}-api-web-acl`,
      Scope: "REGIONAL",
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: "RateLimitPerIP",
          Action: { Block: {} },
          Statement: { RateBasedStatement: { Limit: 2000, AggregateKeyType: "IP" } },
        }),
      ]),
    });
  });

  it("associates the WebACL with the deployed API stage", () => {
    const { template } = synthApi();
    template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);

    const stages = template.findResources("AWS::ApiGateway::Stage");
    const stageIds = Object.keys(stages);
    expect(stageIds).toHaveLength(1);

    const associations = template.findResources("AWS::WAFv2::WebACLAssociation");
    const resourceArn = JSON.stringify(Object.values(associations)[0]?.Properties?.ResourceArn);
    // The ARN references the Stage resource (follows stage replacement) and
    // the RestApi, in the apigateway stage ARN shape.
    expect(resourceArn).toContain(`{"Ref":"${stageIds[0]}"}`);
    expect(resourceArn).toContain("/restapis/");
    expect(resourceArn).toContain("/stages/");
    expect(resourceArn).toContain(":apigateway:");
  });

  it("leaves stage throttling unchanged", () => {
    const { template } = synthApi();
    template.hasResourceProperties("AWS::ApiGateway::Stage", {
      MethodSettings: Match.arrayWith([
        Match.objectLike({ ThrottlingRateLimit: 100, ThrottlingBurstLimit: 200 }),
      ]),
    });
  });

  it("outputs the WebACL ARN", () => {
    const { template } = synthApi();
    template.hasOutput("ApiWebAclArn", {
      Value: { "Fn::GetAtt": [Match.stringLikeRegexp("ApiWafWebAcl"), "Arn"] },
    });
  });
});
