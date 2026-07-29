import { Stack, type StackProps, Duration } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import { ssmParameterNames, type AppConfig } from "../config.js";

export interface CognitoStackProps extends StackProps {
  readonly config: AppConfig;
}

/**
 * `${StackPrefix}-Cognito` — Amazon Cognito user authentication.
 *
 * Instantiates a User Pool (email sign-in, SRP + password auth, self-signup enabled)
 * and a User Pool Client (public client for SPA, no secret). Both are published to
 * SSM Parameter Store so downstream Lambdas and the frontend can resolve them.
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
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
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
        userPassword: true,
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    this.userPoolId = this.userPool.userPoolId;
    this.userPoolClientId = this.userPoolClient.userPoolClientId;

    // -----------------------------------------------------------------------
    // Cognito Groups
    // -----------------------------------------------------------------------
    // SystemAdmin group: adding an existing user here before their first login
    // seeds them as TechnicalAdmin in the DB. After that the DB is the
    // sole source of truth — Cognito group membership is never re-consulted.
    new cognito.CfnUserPoolGroup(this, 'SystemAdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'SystemAdmin',
      description: 'Bootstrap group: members are provisioned as TechnicalAdmin on first login.',
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
