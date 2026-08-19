/**
 * Custom resource that ALTERs each app Postgres role's password from Secrets Manager.
 *
 * Must run after {@link MigrationRunner} (roles exist) and before Compute
 * Lambdas switch to per-role `DB_SECRET_ARN`. RDS Proxy already lists the
 * secrets; auth succeeds once passwords match.
 */
import * as path from "path";
import { Duration, CustomResource, Fn } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import type * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Provider } from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";

import { APP_DB_ROLES, type AppDbRole } from "../appDbRoles.js";

export interface DbPasswordSyncProps {
  readonly databaseProxyEndpoint: string;
  readonly databaseSecretArn: string;
  readonly appUserSecrets: Record<AppDbRole, secretsmanager.ISecret>;
  readonly vpc: ec2.IVpc;
  readonly vpcSubnets: ec2.SubnetSelection;
  readonly stackPrefix: string;
}

export class DbPasswordSync extends CustomResource {
  public readonly syncFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: DbPasswordSyncProps) {
    const secretArns = APP_DB_ROLES.map((role) => props.appUserSecrets[role].secretArn);

    const syncFunction = new lambdaNodejs.NodejsFunction(scope, `${id}Fn`, {
      functionName: `${props.stackPrefix}-sync-db-passwords`,
      entry: path.join(__dirname, "../../lambda/sync-db-passwords/handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.minutes(2),
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      environment: {
        DB_PROXY_HOST: props.databaseProxyEndpoint,
        DB_SECRET_ARN: props.databaseSecretArn,
        APP_DB_SECRET_ARNS: Fn.join(",", secretArns),
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
      },
    });

    syncFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [props.databaseSecretArn, ...secretArns],
      }),
    );

    const provider = new Provider(scope, `${id}Provider`, {
      onEventHandler: syncFunction,
    });

    super(scope, id, {
      serviceToken: provider.serviceToken,
      properties: {
        databaseProxyEndpoint: props.databaseProxyEndpoint,
        databaseSecretArn: props.databaseSecretArn,
        // Re-run when the set of app-user secrets changes (new role or rotation replace).
        appSecretArns: secretArns,
      },
    });

    this.syncFunction = syncFunction;
  }
}
