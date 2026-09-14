import {
  FlowLogDestination,
  FlowLogTrafficType,
  GatewayVpcEndpointAwsService,
  InterfaceVpcEndpointAwsService,
  IpAddresses,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import type { AppConfig } from "../config.js";

export interface NetworkResourcesProps {
  readonly config: AppConfig;
}

/**
 * Foundational network layer for the platform.
 *
 * Provides a three-tier VPC (public / private-with-egress / isolated), the
 * VPC endpoints that let private/isolated data-plane compute reach AWS APIs
 * without traversing the public internet, and VPC flow logs for traceability
 * (REQ-SEC-PII-01 / AWS Well-Architected Security):
 *
 *   - Gateway endpoints   : S3, DynamoDB (free, route-table based)
 *   - Interface endpoints : Secrets Manager, SSM, Bedrock Runtime
 *
 * RDS control-plane and API Gateway interface endpoints are intentionally not
 * created: application traffic uses RDS Proxy over private PostgreSQL/TLS and
 * a Regional API Gateway, respectively. The private-subnet NAT gateway is the
 * approved fallback path for any future public AWS service calls.
 *
 * The VPC is defined with explicit subnet configuration (not `Vpc.fromLookup`)
 * so the app synthesizes without live AWS account/region context lookups.
 *
 * Per the CDK steering, the incoming props are saved as a private field and all
 * resources are created in protected methods rather than inline in the
 * constructor.
 */
export class NetworkResources extends Construct {
  public readonly vpc: Vpc;
  public readonly flowLogGroup: LogGroup;

  private readonly props: NetworkResourcesProps;

  constructor(scope: Construct, id: string, props: NetworkResourcesProps) {
    super(scope, id);
    this.props = props;

    this.flowLogGroup = this.createFlowLogGroup();
    this.vpc = this.createVpc();
    this.enableFlowLogs();
    this.addGatewayEndpoints();
    this.addInterfaceEndpoints();
  }

  protected createFlowLogGroup(): LogGroup {
    return new LogGroup(this, "FlowLogs", {
      retention: RetentionDays.ONE_MONTH,
      // Flow logs are operational telemetry, not personal data; safe to destroy
      // with the network stack on teardown.
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }

  protected createVpc(): Vpc {
    return new Vpc(this, "Vpc", {
      vpcName: `${this.props.config.stackPrefix}-vpc`,
      ipAddresses: IpAddresses.cidr("10.0.0.0/16"),
      maxAzs: 2,
      // One NAT gateway is sufficient for non-production egress; bump for prod
      // multi-AZ resilience via configuration.
      natGateways: 1,
      subnetConfiguration: [
        { name: "Public", subnetType: SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: "Private",
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 22,
        },
        {
          name: "Isolated",
          subnetType: SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });
  }

  protected enableFlowLogs(): void {
    this.vpc.addFlowLog("FlowLog", {
      destination: FlowLogDestination.toCloudWatchLogs(this.flowLogGroup),
      trafficType: FlowLogTrafficType.ALL,
    });
  }

  protected addGatewayEndpoints(): void {
    this.vpc.addGatewayEndpoint("S3Endpoint", {
      service: GatewayVpcEndpointAwsService.S3,
    });
    this.vpc.addGatewayEndpoint("DynamoDbEndpoint", {
      service: GatewayVpcEndpointAwsService.DYNAMODB,
    });
  }

  protected addInterfaceEndpoints(): void {
    // Interface endpoints are placed in the private-with-egress subnets so all
    // application compute reaches these AWS APIs privately.
    const subnets = { subnetType: SubnetType.PRIVATE_WITH_EGRESS };

    this.vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      subnets,
    });
    this.vpc.addInterfaceEndpoint("SsmEndpoint", {
      service: InterfaceVpcEndpointAwsService.SSM,
      subnets,
    });
    this.vpc.addInterfaceEndpoint("BedrockRuntimeEndpoint", {
      service: InterfaceVpcEndpointAwsService.BEDROCK_RUNTIME,
      subnets,
    });
  }
}
