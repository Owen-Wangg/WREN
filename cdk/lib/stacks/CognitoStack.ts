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
