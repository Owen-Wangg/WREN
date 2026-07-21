import * as ec2 from "aws-cdk-lib/aws-ec2";
import { Stack } from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import type { IVpc } from "aws-cdk-lib/aws-ec2";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { ssmParameterNames, type AppConfig } from "../config.js";
import { DatabaseResources } from "../constructs/DatabaseResources.js";
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
  }
}
