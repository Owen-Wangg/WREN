import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Stack } from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import type { IVpc } from "aws-cdk-lib/aws-ec2";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { ssmParameterNames, type AppConfig } from "../config.js";
import { APP_DB_ROLES, appDbRolePascal, type AppDbRole } from "../appDbRoles.js";
import { DatabaseResources } from "../constructs/DatabaseResources.js";
import { DbPasswordSync } from "../constructs/DbPasswordSync.js";
import { MigrationRunner } from "../constructs/MigrationRunner.js";

export interface DatabaseStackProps extends StackProps {
  readonly config: AppConfig;
  /** Concrete VPC imported/created by the `Vpc` stack. */
  readonly vpc: IVpc;
}

/**
 * `${StackPrefix}-Database` — relational persistence.
 *
 * Instantiates {@link DatabaseResources} (RDS PostgreSQL 16 + RDS Proxy with
 * TLS enforced, isolated subnets, encryption, deletion protection, RETAIN) and
 * publishes the proxy endpoint and credentials-secret ARN to SSM for downstream
 * data-access layers.
 */
export class DatabaseStack extends Stack {
  public readonly database: DatabaseResources;
  /** RDS Proxy endpoint hostname — passed to the Compute stack for Lambda DB access. */
  public readonly proxyEndpoint: string;
  /** ARN of the Secrets Manager secret holding DB admin credentials. */
  public readonly databaseSecretArn: string;
  /** Per-app-role secret ARNs for Compute Lambdas (not dbadmin). */
  public readonly appDbSecretArns: Record<AppDbRole, string>;
  /** Migration runner custom resource. */
  public readonly migrations: MigrationRunner;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    this.database = new DatabaseResources(this, "Database", {
      config: props.config,
      vpc: props.vpc,
    });

    this.proxyEndpoint = this.database.proxy.endpoint;
    this.databaseSecretArn = this.database.credentialsSecret.secretArn;
    this.appDbSecretArns = Object.fromEntries(
      APP_DB_ROLES.map((role) => [role, this.database.appUserSecrets[role].secretArn]),
    ) as Record<AppDbRole, string>;

    // Compute previously imported this ARN across stacks. CloudFormation refuses
    // to delete an in-use export, so keep publishing it until Compute has been
    // deployed once on per-role secrets; then remove this call and redeploy.
    this.exportValue(this.database.credentialsSecret.secretArn);

    new StringParameter(this, "ProxyEndpointParameter", {
      parameterName: ssmParameterNames.databaseProxyEndpoint(props.config),
      stringValue: this.database.proxy.endpoint,
      description: "RDS Proxy endpoint hostname (TLS-enforced PostgreSQL access).",
    });

    new StringParameter(this, "SecretArnParameter", {
      parameterName: ssmParameterNames.databaseSecretArn(props.config),
      stringValue: this.database.credentialsSecret.secretArn,
      description: "ARN of the Secrets Manager secret holding DB admin credentials.",
    });

    for (const role of APP_DB_ROLES) {
      new StringParameter(this, `SecretArnParameter${appDbRolePascal(role)}`, {
        parameterName: ssmParameterNames.databaseRoleSecretArn(props.config, role),
        stringValue: this.database.appUserSecrets[role].secretArn,
        description: `ARN of the Secrets Manager secret for Postgres role ${role}.`,
      });
    }

    // Run migrations after the database is ready
    const privateSubnets = props.vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    });

    this.migrations = new MigrationRunner(this, "Migrations", {
      databaseProxyEndpoint: this.database.proxy.endpoint,
      databaseSecretArn: this.database.credentialsSecret.secretArn,
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      stackPrefix: props.config.stackPrefix,
    });

    // The migration custom resource must wait for the proxy target group to be
    // fully registered — otherwise the proxy has no backend and resets connections.
    // The target group is a child construct of the proxy created by CDK's addProxy().
    const proxyTargetGroup = this.database.proxy.node.findChild("ProxyTargetGroup");
    this.migrations.node.addDependency(proxyTargetGroup);

    const passwordSync = new DbPasswordSync(this, "DbPasswordSync", {
      databaseProxyEndpoint: this.database.proxy.endpoint,
      databaseSecretArn: this.database.credentialsSecret.secretArn,
      appUserSecrets: this.database.appUserSecrets,
      vpc: props.vpc,
      vpcSubnets: privateSubnets,
      stackPrefix: props.config.stackPrefix,
    });
    // Roles must exist (0027) before ALTER ROLE … PASSWORD.
    passwordSync.node.addDependency(this.migrations);
  }
}
