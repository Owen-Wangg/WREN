import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import * as amplify_cfn from "aws-cdk-lib/aws-amplify";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import type { Construct } from "constructs";

import type { AppConfig } from "../config";

/**
 * Props for the Amplify stack.
 *
 * NOTE: `githubTokenSecretName` has been removed. Repository access is now
 * handled by the Amplify GitHub App connection, which is established once
 * through the Amplify console (see README / deployment guide). No OAuth token
 * or Secrets Manager secret is needed.
 */
export interface AmplifyStackProps extends StackProps {
  readonly config: AppConfig;
  /** GitHub repository owner (e.g. "UBC-CIC"). */
  readonly repositoryOwner: string;
  /** GitHub repository name (e.g. "WREN"). */
  readonly repositoryName: string;
  /** Source branch hosted as the production branch. */
  readonly branch: string;
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
 * - Repository access via the Amplify GitHub App (no OAuth token required).
 *
 * The frontend is a React 19 / Vite / Tailwind / shadcn/ui SPA per the
 * frontend.md steering. Amplify serves the built static assets and handles
 * SPA routing (rewrites all paths to index.html).
 */
export class AmplifyStack extends Stack {
  public readonly amplifyApp: amplify_cfn.CfnApp;
  public readonly productionBranch: amplify_cfn.CfnBranch;

  constructor(scope: Construct, id: string, props: AmplifyStackProps) {
    super(scope, id, props);

    const { config } = props;

    // -------------------------------------------------------------------
    // Amplify App — L1 construct so we can omit accessToken entirely.
    // Authentication is delegated to the GitHub App connection established
    // once through the Amplify console; CloudFormation needs only the
    // repository URL.
    // -------------------------------------------------------------------
    this.amplifyApp = new amplify_cfn.CfnApp(this, "AmplifyApp", {
      name: `${config.stackPrefix}-frontend`,
      repository: `https://github.com/${props.repositoryOwner}/${props.repositoryName}`,
      // No accessToken / oauthToken — GitHub App handles auth.
      // No iamServiceRole — only needed when builds access AWS secrets/params;
      // all env vars are passed directly below.
      buildSpec: codebuild.BuildSpec.fromObjectToYaml({
        version: 1,
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
      }).toBuildSpec(),
      environmentVariables: [
        { name: "VITE_API_BASE_URL",           value: props.apiEndpoint },
        { name: "VITE_APP_NAME",               value: config.appName },
        { name: "VITE_ENVIRONMENT",            value: config.environmentName },
        { name: "VITE_USE_LIVE_API",           value: "true" },
        { name: "VITE_COGNITO_USER_POOL_ID",   value: props.cognitoUserPoolId },
        { name: "VITE_COGNITO_CLIENT_ID",      value: props.cognitoClientId },
        { name: "VITE_AWS_REGION",             value: config.env.region || "ca-central-1" },
        { name: "VITE_APPSYNC_URL",            value: props.appSyncGraphqlUrl },
        { name: "VITE_ALLOWED_EMAIL_DOMAINS",  value: config.allowedEmailDomains.join(",") },
        { name: "NODE_VERSION",                value: "22" },
      ],
      // SPA rewrite: all unmatched paths → index.html.
      customRules: [
        { source: "/<*>", target: "/index.html", status: "404-200" },
      ],
    });

    // -------------------------------------------------------------------
    // Production branch follows the configured GitHub source branch.
    // -------------------------------------------------------------------
    this.productionBranch = new amplify_cfn.CfnBranch(this, "ProductionBranch", {
      appId: this.amplifyApp.attrAppId,
      branchName: props.branch,
      enableAutoBuild: true,
      stage: "PRODUCTION",
    });

    // Keep the `development` branch as a DEVELOPMENT stage preview, unless it
    // is already the configured production branch.
    if (props.branch !== "development") {
      new amplify_cfn.CfnBranch(this, "DevelopmentBranch", {
        appId: this.amplifyApp.attrAppId,
        branchName: "development",
        enableAutoBuild: true,
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
      new amplify_cfn.CfnDomain(this, "CustomDomain", {
        appId: this.amplifyApp.attrAppId,
        domainName: config.customDomain,
        subDomainSettings: [
          { branchName: props.branch, prefix: "" },
          { branchName: props.branch, prefix: "www" },
        ],
      });

      new CfnOutput(this, "CustomDomainUrl", {
        value: `https://${config.customDomain}`,
        description: "Custom domain URL for the frontend (root)",
      });
    }

    // -------------------------------------------------------------------
    // Outputs
    // -------------------------------------------------------------------
    new CfnOutput(this, "AmplifyAppId", {
      value: this.amplifyApp.attrAppId,
      description: "Amplify App ID",
    });
    new CfnOutput(this, "AmplifyDefaultDomain", {
      value: `${props.branch}.${this.amplifyApp.attrDefaultDomain}`,
      description: `Amplify default domain for the ${props.branch} branch`,
    });
  }
}
