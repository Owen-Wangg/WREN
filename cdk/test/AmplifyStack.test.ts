import { App, Fn } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import YAML from "js-yaml";
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
      githubTokenSecretName: "wren-test/github/token",
      apiEndpoint: "https://api.example.test/",
      cognitoUserPoolId: "ca-central-1_pool",
      cognitoClientId: "client",
      appSyncGraphqlUrl: "https://example.appsync-api.ca-central-1.amazonaws.com/graphql",
      documentsBucketName: "wren-test-documents",
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
      githubTokenSecretName: "wren-test/github/token",
      apiEndpoint: "https://api.example.test/",
      cognitoUserPoolId: "ca-central-1_pool",
      cognitoClientId: "client",
      appSyncGraphqlUrl: "https://example.appsync-api.ca-central-1.amazonaws.com/graphql",
      documentsBucketName: "wren-test-documents",
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

  it("sets the repository URL and resolves the access token from Secrets Manager", () => {
    const config = testConfig();
    const stack = new AmplifyStack(new App(), "Amplify", {
      env: config.env,
      config,
      repositoryOwner: "owner",
      repositoryName: "repo",
      branch: "main",
      githubTokenSecretName: "wren-test/github/token",
      apiEndpoint: "https://api.example.test/",
      cognitoUserPoolId: "ca-central-1_pool",
      cognitoClientId: "client",
      appSyncGraphqlUrl: "https://example.appsync-api.ca-central-1.amazonaws.com/graphql",
      documentsBucketName: "wren-test-documents",
    });
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Amplify::App", {
      Repository: "https://github.com/owner/repo",
    });
    // AccessToken must resolve the secret dynamically — this app's GitHub
    // connection predates the Amplify GitHub App connector and requires a
    // token on every create/update.
    const apps = template.findResources("AWS::Amplify::App");
    const appProps = (Object.values(apps)[0] as { Properties: Record<string, unknown> }).Properties;
    expect(appProps.AccessToken).toEqual(expect.stringContaining("wren-test/github/token"));
  });
});

describe("AmplifyStack custom domain", () => {
  const baseProps = (config: ReturnType<typeof testConfig>) => ({
    env: config.env,
    config,
    repositoryOwner: "owner",
    repositoryName: "repo",
    branch: "main",
    githubTokenSecretName: "wren-test/github/token",
    apiEndpoint: "https://api.example.test/",
    cognitoUserPoolId: "ca-central-1_pool",
    cognitoClientId: "client",
    appSyncGraphqlUrl: "https://example.appsync-api.ca-central-1.amazonaws.com/graphql",
    documentsBucketName: "wren-test-documents",
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

describe("AmplifyStack security headers", () => {
  const props = (config: ReturnType<typeof testConfig>) => ({
    env: config.env,
    config,
    repositoryOwner: "owner",
    repositoryName: "repo",
    branch: "main",
    githubTokenSecretName: "wren-test/github/token",
    apiEndpoint: "https://abc123.execute-api.ca-central-1.amazonaws.com/test/",
    cognitoUserPoolId: "ca-central-1_pool",
    cognitoClientId: "client",
    appSyncGraphqlUrl: "https://gql123.appsync-api.ca-central-1.amazonaws.com/graphql",
    documentsBucketName: "wren-test-documents",
  });

  function customHeaders(template: Template): {
    customHeaders: Array<{ pattern: string; headers: Array<{ key: string; value: string }> }>;
  } {
    const apps = template.findResources("AWS::Amplify::App");
    const raw = (Object.values(apps)[0] as { Properties: { CustomHeaders?: unknown } })
      .Properties.CustomHeaders;
    expect(typeof raw).toBe("string");
    return YAML.load(raw as string) as ReturnType<typeof customHeaders>;
  }

  it("serves HSTS, X-Frame-Options, nosniff, Referrer-Policy, and CSP on every path", () => {
    const config = testConfig();
    const template = Template.fromStack(new AmplifyStack(new App(), "Amplify", props(config)));
    const parsed = customHeaders(template);

    expect(parsed.customHeaders).toHaveLength(1);
    expect(parsed.customHeaders[0]?.pattern).toBe("**");
    const headers = Object.fromEntries(
      (parsed.customHeaders[0]?.headers ?? []).map((h) => [h.key, h.value]),
    );
    expect(headers["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");

    const csp = headers["Content-Security-Policy"] ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("script-src 'self'");
    const connectSrc = csp.split("; ").find((d) => d.startsWith("connect-src ")) ?? "";
    expect(connectSrc.split(" ").slice(1)).toEqual([
      "'self'",
      "https://abc123.execute-api.ca-central-1.amazonaws.com",
      "https://cognito-idp.ca-central-1.amazonaws.com",
      "https://gql123.appsync-api.ca-central-1.amazonaws.com",
      "wss://gql123.appsync-realtime-api.ca-central-1.amazonaws.com",
      "https://wren-test-documents.s3.ca-central-1.amazonaws.com",
    ]);
    expect(connectSrc).not.toMatch(/ (https|wss):( |$)/);
  });

  it("resolves the CSP hosts from deploy-time tokens", () => {
    const config = testConfig();
    const stack = new AmplifyStack(new App(), "Amplify", {
      ...props(config),
      apiEndpoint: `https://${Fn.importValue("api-id")}.execute-api.ca-central-1.amazonaws.com/test/`,
      appSyncGraphqlUrl: Fn.importValue("appsync-url"),
      documentsBucketName: Fn.importValue("documents-bucket"),
    });
    const template = Template.fromStack(stack);
    const apps = template.findResources("AWS::Amplify::App");
    const raw = JSON.stringify(
      (Object.values(apps)[0] as { Properties: { CustomHeaders?: unknown } }).Properties
        .CustomHeaders,
    );
    expect(raw).toContain("Fn::Join");
    expect(raw).toContain('{"Fn::ImportValue":"api-id"}');
    expect(raw).toContain('{"Fn::ImportValue":"appsync-url"}');
    expect(raw).toContain('{"Fn::ImportValue":"documents-bucket"}');
    expect(raw).toContain("appsync-realtime-api");
    expect(raw).toContain("Fn::Split");
  });
});
