import { Stack, type StackProps, Duration } from "aws-cdk-lib";
import * as path from "path";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import { allowedEmailDomainsEnv } from "../signupEmailDomains.js";
import { ssmParameterNames, type AppConfig } from "../config.js";

export interface CognitoStackProps extends StackProps {
  readonly config: AppConfig;
}

/**
 * `${StackPrefix}-Cognito` — Amazon Cognito user authentication.
 *
 * Instantiates a User Pool (email sign-in, SRP auth, self-signup enabled)
 * and a User Pool Client (public client for SPA, no secret, OAuth hosted-UI
 * disabled). A PreSignUp Lambda enforces an exact email-domain allowlist for
 * new accounts only; an empty list denies every new signup. Admin
 * USER_PASSWORD_AUTH / `AdminInitiateAuth` is not enabled on this client.
 * Pool and client IDs are published to SSM for Lambdas and the frontend.
 */
export class CognitoStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  constructor(scope: Construct, id: string, props: CognitoStackProps) {
    super(scope, id, props);

    const { config } = props;

    // -----------------------------------------------------------------------
    // Cognito User Pool
    // -----------------------------------------------------------------------
    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${config.stackPrefix}-pool`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      // Explicit (matches the CDK default for an email alias): email must be
      // verified by code. Required by `keepOriginal` below.
      autoVerify: { email: true },
      // A changed email does not take effect (and `email_verified` stays true
      // for the original) until the user verifies the new address. Without
      // this, UpdateUserAttributes immediately stores an unverified email,
      // including one already used by another app identity.
      keepOriginal: { email: true },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.OPTIONAL,

      // Verification email sent when a user signs up (contains the 6-digit code).
      userVerification: {
        emailSubject: `Your ${config.appName} verification code`,
        emailBody: [
          `<p>Hi,</p>`,
          `<p>Thanks for signing up for <strong>${config.appName}</strong> — the AI-powered writing coach.</p>`,
          `<p>Your verification code is:</p>`,
          `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;">{####}</p>`,
          `<p>Enter this code on the verification screen to activate your account. The code expires in 24 hours.</p>`,
          `<p>If you didn't create an account, you can safely ignore this email.</p>`,
          `<p>— The ${config.appName} Team</p>`,
        ].join("\n"),
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },

      // Password reset email sent when a user requests a reset code.
      userInvitation: {
        emailSubject: `Your ${config.appName} password reset code`,
        emailBody: [
          `<p>Hi {username},</p>`,
          `<p>We received a request to reset the password for your <strong>${config.appName}</strong> account.</p>`,
          `<p>Your reset code is:</p>`,
          `<p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;">{####}</p>`,
          `<p>Enter this code along with your new password to complete the reset. The code expires shortly.</p>`,
          `<p>If you didn't request a password reset, you can safely ignore this email — your account is secure.</p>`,
          `<p>— The ${config.appName} Team</p>`,
        ].join("\n"),
      },
    });

    // -----------------------------------------------------------------------
    // Cognito User Pool Client (public client for SPA)
    // -----------------------------------------------------------------------
    this.userPoolClient = this.userPool.addClient("SpaClient", {
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: false,
        adminUserPassword: false,
      },
      disableOAuth: true,
      // Least privilege: the SPA only writes these at SignUp (see
      // cognitoAuthService.signUp). Without an explicit list Cognito lets users
      // UpdateUserAttributes on every standard attribute. `email` stays
      // writable for signup; changes are gated by `keepOriginal` above.
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        givenName: true,
        familyName: true,
      }),
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    this.userPoolId = this.userPool.userPoolId;
    this.userPoolClientId = this.userPoolClient.userPoolClientId;

    // -----------------------------------------------------------------------
    // PreSignUp email-domain allowlist (new accounts only)
    // -----------------------------------------------------------------------
    // Always attached so changing the list is an env change rather than adding
    // or removing the trigger. Fail closed: an empty ALLOWED_EMAIL_DOMAINS
    // denies every new signup. `npm run deploy` refuses to run without a list.
    // No VPC or database: this is a hostname check only.
    const monorepoRoot = path.join(__dirname, "../../..");
    const preSignUp = new lambdaNodejs.NodejsFunction(this, "PreSignUpFn", {
      functionName: `${config.stackPrefix}-pre-signup`,
      entry: path.join(monorepoRoot, "backend/auth/src/preSignUp.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 128,
      timeout: Duration.seconds(5),
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      environment: {
        ALLOWED_EMAIL_DOMAINS: allowedEmailDomainsEnv(config.allowedEmailDomains),
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
      },
    });
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUp);

    // -----------------------------------------------------------------------
    // Cognito Groups
    // -----------------------------------------------------------------------
    // SystemAdmin is an eligibility signal, not an authorization grant. The
    // Compute stack must also carry an exact subject allowlist, and only a
    // genuinely new app_user can receive TechnicalAdmin during provisioning.
    // Group membership alone never grants or changes an application role.
    new cognito.CfnUserPoolGroup(this, 'SystemAdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'SystemAdmin',
      description: 'Bootstrap eligibility only; requires an exact configured subject and a genuinely new app user.',
    });

    // -----------------------------------------------------------------------
    // Publish to SSM
    // -----------------------------------------------------------------------
    new StringParameter(this, "UserPoolIdParameter", {
      parameterName: ssmParameterNames.userPoolId(config),
      stringValue: this.userPoolId,
      description: "Cognito User Pool ID for sign-in/sign-up flows",
    });

    new StringParameter(this, "UserPoolClientIdParameter", {
      parameterName: ssmParameterNames.userPoolClientId(config),
      stringValue: this.userPoolClientId,
      description: "Cognito User Pool Client ID (public client for SPA)",
    });
  }
}
