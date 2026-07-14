import { Stack, type StackProps, CfnOutput, SecretValue } from "aws-cdk-lib";
import * as amplify from "@aws-cdk/aws-amplify-alpha";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import type { Construct } from "constructs";

import type { AppConfig } from "../config";

/**
 * Props for the Amplify stack.
 */
export interface AmplifyStackProps extends StackProps {
  readonly config: AppConfig;
  /** GitHub repository owner (e.g. "Jovank99"). */
  readonly repositoryOwner: string;
  /** GitHub repository name (e.g. "WREN"). */
  readonly repositoryName: string;
  /** GitHub OAuth token secret name in Secrets Manager. */
  readonly githubTokenSecretName: string;
  /** The API endpoint URL for the frontend to connect to. */
  readonly apiEndpoint: string;
  /** Cognito User Pool ID. */
  readonly cognitoUserPoolId: string;
  /** Cognito User Pool Client ID. */
  readonly cognitoClientId: string;
}

/**
 * `${StackPrefix}-Amplify` — Frontend hosting via AWS Amplify.
 *
 * - Per-branch builds (`npm ci && npm run build`, Vite → `dist/`).
 * - Auto-build on push to main and feature branches.
 * - Environment variables injected for API endpoint and app name.
 * - Node 22 build image for Vite compatibility.
 *
 * The frontend is a React 19 / Vite / Tailwind / shadcn/ui SPA per the
 * frontend.md steering. Amplify serves the built static assets and handles
 * SPA routing (rewrites all paths to index.html).
 */
export class AmplifyStack extends Stack {
  public readonly amplifyApp: amplify.App;
  public readonly mainBranch: amplify.Branch;

  constructor(scope: Construct, id: string, props: AmplifyStackProps) {
    super(scope, id, props);

    const { config } = props;

    // -------------------------------------------------------------------
    // Amplify App
    // -------------------------------------------------------------------
    this.amplifyApp = new amplify.App(this, "AmplifyApp", {
      appName: `${config.stackPrefix}-frontend`,
      sourceCodeProvider: new amplify.GitHubSourceCodeProvider({
        owner: props.repositoryOwner,
        repository: props.repositoryName,
        oauthToken: SecretValue.secretsManager(props.githubTokenSecretName),
      }),
      buildSpec: codebuild.BuildSpec.fromObjectToYaml({
        version: "1.0",
        applications: [
          {
            appRoot: "frontend",
            frontend: {
              phases: {
                preBuild: {
                  commands: ["npm ci"],
                },
                build: {
                  commands: ["npm run build"],
                },
              },
              artifacts: {
                baseDirectory: "dist",
                files: ["**/*"],
              },
              cache: {
                paths: ["node_modules/**/*"],
              },
            },
          },
        ],
      }),
      environmentVariables: {
        // Frontend config (frontend/src/config/env.ts reads these)
        VITE_API_BASE_URL: props.apiEndpoint,
        VITE_APP_NAME: config.appName,
        VITE_ENVIRONMENT: config.environmentName,
        VITE_USE_LIVE_API: "true",
        VITE_COGNITO_USER_POOL_ID: props.cognitoUserPoolId,
        VITE_COGNITO_CLIENT_ID: props.cognitoClientId,
        VITE_AWS_REGION: config.env.region || "ca-central-1",
        // Build config
        NODE_VERSION: "22",
      },
    });

    // SPA rewrite rule: all paths → index.html (except /api/* and assets).
    this.amplifyApp.addCustomRule(amplify.CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT);

    // -------------------------------------------------------------------
    // Branch: main (auto-build on push)
    // -------------------------------------------------------------------
    this.mainBranch = this.amplifyApp.addBranch("main", {
      autoBuild: true,
      stage: "PRODUCTION",
    });

    // Feature branches: auto-build for PR previews.
    this.amplifyApp.addBranch("develop", {
      autoBuild: true,
      stage: "DEVELOPMENT",
    });

    // -------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------
    new CfnOutput(this, "AmplifyAppId", {
      value: this.amplifyApp.appId,
      description: "Amplify App ID",
    });
    new CfnOutput(this, "AmplifyDefaultDomain", {
      value: `main.${this.amplifyApp.defaultDomain}`,
      description: "Amplify default domain for the main branch",
    });
  }
}
