/**
 * Custom resource that runs database migrations on stack deployment.
 *
 * Triggers after DatabaseStack is created, runs migrations via a Lambda,
 * and returns the list of applied migrations. Idempotent: re-running applies
 * only new migrations not yet recorded in schema_migrations table.
 */
import * as path from 'path';
import { Duration, CustomResource } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Provider } from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';

export interface MigrationRunnerProps {
  /** Database proxy endpoint hostname. */
  readonly databaseProxyEndpoint: string;
  /** ARN of Secrets Manager secret holding DB credentials. */
  readonly databaseSecretArn: string;
  /** VPC for the migration Lambda. */
  readonly vpc: ec2.IVpc;
  /** Private subnets for the migration Lambda. */
  readonly vpcSubnets: ec2.SubnetSelection;
  /**
   * Stack prefix used for the Lambda function name so multiple environments
   * (e.g. wren-dev + wren-testing) can coexist in one account.
   */
  readonly stackPrefix: string;
}

/**
 * Custom resource that runs database migrations on stack deployment.
 */
export class MigrationRunner extends CustomResource {
  public readonly migrationFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: MigrationRunnerProps) {
    const migrationFunction = new lambdaNodejs.NodejsFunction(scope, `${id}Fn`, {
      functionName: `${props.stackPrefix}-migrate`,
      entry: path.join(__dirname, '../../lambda/migrations/handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.minutes(5),
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      environment: {
        DB_PROXY_HOST: props.databaseProxyEndpoint,
        DB_SECRET_ARN: props.databaseSecretArn,
        MIGRATIONS_DIR: '/var/task/migrations',
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        commandHooks: {
          beforeBundling(): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            // Copy migration SQL files into the Lambda bundle so they exist at runtime.
            // inputDir is the project root (where cdk.json lives).
            const isWindows = process.platform === 'win32';
            const migrationsSource = path.join(inputDir, '..', 'backend', 'database', 'migrations');
            if (isWindows) {
              return [`xcopy /E /I /Y "${migrationsSource}" "${outputDir}\\migrations"`];
            }
            return [`cp -r "${migrationsSource}" "${outputDir}/migrations"`];
          },
          beforeInstall(): string[] {
            return [];
          },
        },
      },
    });

    // Grant access to the database secret
    migrationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [props.databaseSecretArn],
      }),
    );

    // Create a custom resource provider (onEventHandler-only; no polling)
    const provider = new Provider(scope, `${id}Provider`, {
      onEventHandler: migrationFunction,
    });

    super(scope, id, {
      serviceToken: provider.serviceToken,
      properties: {
        // Trigger re-run on environment changes
        databaseProxyEndpoint: props.databaseProxyEndpoint,
        databaseSecretArn: props.databaseSecretArn,
      },
    });

    this.migrationFunction = migrationFunction;
  }
}
