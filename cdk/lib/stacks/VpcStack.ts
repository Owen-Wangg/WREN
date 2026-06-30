import { Stack } from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import type { IVpc } from "aws-cdk-lib/aws-ec2";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { ssmParameterNames, type AppConfig } from "../config.js";
import { NetworkResources } from "../constructs/NetworkResources.js";

export interface VpcStackProps extends StackProps {
  readonly config: AppConfig;
}

/**
 * `${StackPrefix}-Vpc` — the foundational network stack.
 *
 * Instantiates {@link NetworkResources} (three-tier VPC, VPC endpoints, flow
 * logs) and publishes the VPC id to SSM so downstream stacks resolve it without
 * a CloudFormation cross-stack export.
 */
export class VpcStack extends Stack {
  public readonly vpc: IVpc;

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    const network = new NetworkResources(this, "Network", {
      config: props.config,
    });
    this.vpc = network.vpc;

    new StringParameter(this, "VpcIdParameter", {
      parameterName: ssmParameterNames.vpcId(props.config),
      stringValue: network.vpc.vpcId,
      description: "VPC id for the platform network (published for downstream stacks).",
    });
  }
}
