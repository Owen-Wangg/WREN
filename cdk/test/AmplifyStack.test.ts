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
      githubTokenSecretName: `${config.stackPrefix}/github/token`,
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
});
