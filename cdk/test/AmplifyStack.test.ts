import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { AmplifyStack } from "../lib/stacks/AmplifyStack.js";
import { testConfig } from "./helpers.js";

describe("AmplifyStack configured branch", () => {
  it("uses the configured source branch for production and outputs its URL", () => {
    const config = testConfig();
    const stack = new AmplifyStack(new App(), "Amplify", {
      env: config.env,
      config,
      repositoryOwner: "owner",
      repositoryName: "repo",
      branch: "release",
      apiEndpoint: "https://api.example.test/",
      cognitoUserPoolId: "ca-central-1_pool",
      cognitoClientId: "client",
      appSyncGraphqlUrl: "https://example.appsync-api.ca-central-1.amazonaws.com/graphql",
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Amplify::Branch", {
      BranchName: "release",
      Stage: "PRODUCTION",
      EnableAutoBuild: true,
    });
    template.hasOutput("AmplifyDefaultDomain", {
      Value: Match.objectLike({ "Fn::Join": Match.anyValue() }),
    });
  });

  it("provisions main (production) and development branches with default config", () => {
    const config = testConfig();
    const stack = new AmplifyStack(new App(), "Amplify", {
      env: config.env,
      config,
      repositoryOwner: "owner",
      repositoryName: "repo",
      branch: "main",
      apiEndpoint: "https://api.example.test/",
      cognitoUserPoolId: "ca-central-1_pool",
      cognitoClientId: "client",
      appSyncGraphqlUrl: "https://example.appsync-api.ca-central-1.amazonaws.com/graphql",
    });
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Amplify::Branch", 2);
    template.hasResourceProperties("AWS::Amplify::Branch", {
      BranchName: "main",
      Stage: "PRODUCTION",
      EnableAutoBuild: true,
    });
    template.hasResourceProperties("AWS::Amplify::Branch", {
      BranchName: "development",
      Stage: "DEVELOPMENT",
      EnableAutoBuild: true,
    });
  });

  it("sets the repository URL on the app without an access token", () => {
    const config = testConfig();
    const stack = new AmplifyStack(new App(), "Amplify", {
      env: config.env,
      config,
      repositoryOwner: "owner",
      repositoryName: "repo",
      branch: "main",
      apiEndpoint: "https://api.example.test/",
      cognitoUserPoolId: "ca-central-1_pool",
      cognitoClientId: "client",
      appSyncGraphqlUrl: "https://example.appsync-api.ca-central-1.amazonaws.com/graphql",
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Amplify::App", {
      Repository: "https://github.com/owner/repo",
    });
    // AccessToken must be absent — GitHub App connection handles auth.
    const apps = template.findResources("AWS::Amplify::App");
    const appProps = (Object.values(apps)[0] as { Properties: Record<string, unknown> }).Properties;
    expect(appProps).not.toHaveProperty("AccessToken");
    expect(appProps).not.toHaveProperty("OauthToken");
  });
});

describe("AmplifyStack custom domain", () => {
  const baseProps = (config: ReturnType<typeof testConfig>) => ({
    env: config.env,
    config,
    repositoryOwner: "owner",
    repositoryName: "repo",
    branch: "main",
    apiEndpoint: "https://api.example.test/",
    cognitoUserPoolId: "ca-central-1_pool",
    cognitoClientId: "client",
    appSyncGraphqlUrl: "https://example.appsync-api.ca-central-1.amazonaws.com/graphql",
  });

  it("maps the production branch to the domain root and www when a custom domain is set", () => {
    const config = testConfig({ customDomain: "cloud-inov.com" });
    const stack = new AmplifyStack(new App(), "Amplify", baseProps(config));
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Amplify::Domain", 1);
    template.hasResourceProperties("AWS::Amplify::Domain", {
      DomainName: "cloud-inov.com",
      SubDomainSettings: Match.arrayWith([
        Match.objectLike({ BranchName: Match.anyValue(), Prefix: "" }),
        Match.objectLike({ BranchName: Match.anyValue(), Prefix: "www" }),
      ]),
    });
    template.hasOutput("CustomDomainUrl", {
      Value: "https://cloud-inov.com",
    });
  });

  it("synthesizes no domain association or custom-domain output when unset (regression guard)", () => {
    const config = testConfig();
    const stack = new AmplifyStack(new App(), "Amplify", baseProps(config));
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::Amplify::Domain", 0);
    expect(Object.keys(template.findOutputs("CustomDomainUrl"))).toHaveLength(0);
  });

  it("injects VITE_ALLOWED_EMAIL_DOMAINS from app config", () => {
    const config = testConfig({ allowedEmailDomains: ["ubc.ca"] });
    const stack = new AmplifyStack(new App(), "Amplify", baseProps(config));
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Amplify::App", {
      EnvironmentVariables: Match.arrayWith([
        Match.objectLike({
          Name: "VITE_ALLOWED_EMAIL_DOMAINS",
          Value: "ubc.ca",
        }),
      ]),
    });
  });
});
