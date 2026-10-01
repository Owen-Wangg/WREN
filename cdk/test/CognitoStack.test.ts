import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { CognitoStack } from "../lib/stacks/CognitoStack.js";
import { testConfig } from "./helpers.js";

describe("CognitoStack app client", () => {
  function synth() {
    const config = testConfig();
    const stack = new CognitoStack(new App(), `${config.stackPrefix}-Cognito`, {
      env: config.env,
      config,
    });
    return Template.fromStack(stack);
  }

  it("allows SRP auth, not public USER_PASSWORD_AUTH or AdminInitiateAuth", () => {
    const template = synth();
    const clients = Object.values(template.findResources("AWS::Cognito::UserPoolClient"));
    const flows = clients[0]?.Properties?.ExplicitAuthFlows as string[];
    expect(flows).toEqual(
      expect.arrayContaining([
        "ALLOW_USER_SRP_AUTH",
        "ALLOW_REFRESH_TOKEN_AUTH",
      ]),
    );
    expect(flows).not.toContain("ALLOW_USER_PASSWORD_AUTH");
    expect(flows).not.toContain("ALLOW_ADMIN_USER_PASSWORD_AUTH");
  });

  it("disables the hosted-UI OAuth client (no example.com callback / implicit grant)", () => {
    const template = synth();
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlowsUserPoolClient: false,
    });
    const clients = Object.values(template.findResources("AWS::Cognito::UserPoolClient"));
    const props = clients[0]?.Properties ?? {};
    expect(props.CallbackURLs ?? []).not.toContain("https://example.com");
    expect(props.AllowedOAuthFlows ?? []).not.toContain("implicit");
  });
});

describe("CognitoStack email attribute integrity (finding f-4531f8e7)", () => {
  function synth() {
    const config = testConfig();
    const stack = new CognitoStack(new App(), `${config.stackPrefix}-Cognito`, {
      env: config.env,
      config,
    });
    return Template.fromStack(stack);
  }

  it("requires verification before an email change takes effect", () => {
    synth().hasResourceProperties("AWS::Cognito::UserPool", {
      AutoVerifiedAttributes: ["email"],
      UserAttributeUpdateSettings: {
        AttributesRequireVerificationBeforeUpdate: ["email"],
      },
    });
  });

  it("limits the SPA client to writing only the attributes signup sets", () => {
    const template = synth();
    const clients = Object.values(template.findResources("AWS::Cognito::UserPoolClient"));
    const writeAttributes = clients[0]?.Properties?.WriteAttributes as string[] | undefined;
    expect(writeAttributes).toBeDefined();
    expect([...writeAttributes!].sort()).toEqual(["email", "family_name", "given_name"]);
    expect(writeAttributes).not.toContain("email_verified");
  });
});

describe("CognitoStack PreSignUp email-domain allowlist", () => {
  function synth(overrides: Parameters<typeof testConfig>[0] = {}) {
    const config = testConfig(overrides);
    const stack = new CognitoStack(new App(), `${config.stackPrefix}-Cognito`, {
      env: config.env,
      config,
    });
    return Template.fromStack(stack);
  }

  it("always attaches a PreSignUp Lambda with an empty allowlist by default", () => {
    const template = synth();
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      LambdaConfig: Match.objectLike({
        PreSignUp: Match.anyValue(),
      }),
    });
    template.resourceCountIs("AWS::Lambda::Function", 1);
    const fns = Object.values(template.findResources("AWS::Lambda::Function"));
    const env = fns[0]?.Properties?.Environment?.Variables as Record<string, string>;
    expect(env.ALLOWED_EMAIL_DOMAINS).toBe("");
  });

  it("passes configured exact domains to the PreSignUp Lambda", () => {
    const template = synth({ allowedEmailDomains: ["ubc.ca", "alumni.ubc.ca"] });
    const fns = Object.values(template.findResources("AWS::Lambda::Function"));
    const env = fns[0]?.Properties?.Environment?.Variables as Record<string, string>;
    expect(env.ALLOWED_EMAIL_DOMAINS).toBe("ubc.ca,alumni.ubc.ca");
  });
});
