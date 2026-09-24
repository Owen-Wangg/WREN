import { readFileSync } from "node:fs";
import * as path from "node:path";

import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { load } from "js-yaml";

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

  it("generates an authorizer-bypassing OPTIONS for every path in the spec", () => {
    const template = synthApi();
    const apis = Object.values(template.findResources("AWS::ApiGateway::RestApi"));
    expect(apis).toHaveLength(1);
    const { paths } = (apis[0]!.Properties as {
      Body: { paths: Record<string, Record<string, any>> };
    }).Body;
    expect(Object.keys(paths).length).toBeGreaterThan(0);
    for (const methods of Object.values(paths)) {
      expect(methods.options?.security).toEqual([]);
      expect(
        methods.options?.["x-amazon-apigateway-integration"]?.requestTemplates,
      ).toBeDefined();
    }
  });
});

// The spec must not declare CORS itself: ApiStack.ts overwrites every `options`
// method at synth, so anything here is dead weight that misleads readers who
// treat the spec as the source of truth (and reappears the moment the overwrite
// is ever made conditional).
describe("openapi.yaml CORS declarations", () => {
  const specText = readFileSync(
    path.join(__dirname, "..", "lib", "openapi.yaml"),
    "utf8",
  );
  const spec = load(specText) as {
    paths: Record<string, Record<string, unknown>>;
    "x-amazon-apigateway-cors"?: unknown;
  };

  it("declares no options methods", () => {
    const withOptions = Object.entries(spec.paths)
      .filter(([, methods]) => "options" in methods)
      .map(([route]) => route);
    expect(withOptions).toEqual([]);
  });

  it("declares no Access-Control headers or x-amazon-apigateway-cors block", () => {
    expect(spec["x-amazon-apigateway-cors"]).toBeUndefined();
    expect(specText).not.toContain("Access-Control");
  });
});
