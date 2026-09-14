import { Stack, type StackProps, CfnOutput, SecretValue } from "aws-cdk-lib";
import * as amplify from "@aws-cdk/aws-amplify-alpha";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from "aws-cdk-lib/aws-iam";
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
  /** Source branch hosted as the production branch. */
  readonly branch: string;
  /** GitHub OAuth token secret name in Secrets Manager. */
  readonly githubTokenSecretName: string;
  /** The API endpoint URL for the frontend to connect to. */
  readonly apiEndpoint: string;
  /** Cognito User Pool ID. */
  readonly cognitoUserPoolId: string;
  /** Cognito User Pool Client ID. */
  readonly cognitoClientId: string;
  /** AppSync GraphQL endpoint for real-time debrief subscriptions. */
  readonly appSyncGraphqlUrl: string;
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
  public readonly productionBranch: amplify.Branch;

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
                  commands: [
                    // Install at monorepo root first so workspace packages
                    // (types, etc.) can resolve their dependencies (e.g. zod)
                    "cd .. && npm ci && cd frontend",
                    "npm ci",
                  ],
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
        VITE_APPSYNC_URL: props.appSyncGraphqlUrl,
        VITE_ALLOWED_EMAIL_DOMAINS: config.allowedEmailDomains.join(","),
        // Build config
        NODE_VERSION: "22",
      },
    });

    // SPA rewrite rule: all paths → index.html (except /api/* and assets).
    this.amplifyApp.addCustomRule(amplify.CustomRule.SINGLE_PAGE_APPLICATION_REDIRECT);

    // Grant the Amplify service role the minimum permissions it needs during builds:
    // - Secrets Manager read for the GitHub OAuth token
    // - CloudWatch Logs write for build logs
    // Without these the role trust policy is correct but the build fails at env setup.
    if (this.amplifyApp.role) {
      this.amplifyApp.role.addToPrincipalPolicy(new iam.PolicyStatement({
        sid: "AmplifySecretsRead",
        actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
        resources: [
          `arn:aws:secretsmanager:${config.env.region || "ca-central-1"}:${this.account}:secret:${props.githubTokenSecretName}*`,
        ],
      }));
      this.amplifyApp.role.addToPrincipalPolicy(new iam.PolicyStatement({
        sid: "AmplifyLogs",
        actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [`arn:aws:logs:${config.env.region || "ca-central-1"}:${this.account}:log-group:/aws/amplify/*`],
      }));
    }

    // -------------------------------------------------------------------
    // Production branch follows the configured GitHub source branch.
    // -------------------------------------------------------------------
    this.productionBranch = this.amplifyApp.addBranch(props.branch, {
      autoBuild: true,
      stage: "PRODUCTION",
    });

    // Keep the `development` branch as a DEVELOPMENT stage preview, unless it
    // is already the configured production branch.
    if (props.branch !== "development") {
      this.amplifyApp.addBranch("development", {
        autoBuild: true,
        stage: "DEVELOPMENT",
      });
    }

    // -------------------------------------------------------------------
    // Optional custom domain.
    //
    // When `config.customDomain` is set, map the production branch to the
    // domain root and its `www` subdomain. Amplify provisions the ACM
    // certificate and — when the domain's hosted zone lives in this AWS
    // account — creates the DNS records automatically; otherwise it surfaces
    // verification records to add manually in whatever DNS provider hosts the
    // zone. No Route 53 or ACM resources are created here, so the feature stays
    // account/provider-agnostic. When unset, the frontend is reachable only via
    // the Amplify default domain and nothing below is synthesized.
    // -------------------------------------------------------------------
    if (config.customDomain) {
      const domain = this.amplifyApp.addDomain(config.customDomain);
      domain.mapRoot(this.productionBranch);
      domain.mapSubDomain(this.productionBranch, "www");

      new CfnOutput(this, "CustomDomainUrl", {
        value: `https://${config.customDomain}`,
        description: "Custom domain URL for the frontend (root)",
      });
    }

    // -------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------
    new CfnOutput(this, "AmplifyAppId", {
      value: this.amplifyApp.appId,
      description: "Amplify App ID",
    });
    new CfnOutput(this, "AmplifyDefaultDomain", {
      value: `${props.branch}.${this.amplifyApp.defaultDomain}`,
      description: `Amplify default domain for the ${props.branch} branch`,
    });
  }
}
