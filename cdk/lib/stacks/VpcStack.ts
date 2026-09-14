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

  /**
   * Deterministic, region-derived availability zones.
   *
   * The VPC uses `maxAzs: 2`, which forces the CDK to know the account's real
   * AZ names. Left to its default, the framework resolves them via an
   * `availability-zones` context lookup against the live account and caches the
   * result in `cdk.context.json`. Because that file is committed, every new
   * adopter account appends a fresh entry, dirtying the working tree and
   * tripping the deploy workflow's clean-tree guard (which builds the Feedback
   * Engine image from a `git archive` snapshot).
   *
   * Overriding `availabilityZones` to two fixed, region-derived zones removes
   * the lookup entirely: synthesis is deterministic, offline-capable, and never
   * writes to `cdk.context.json` — in any account. Two zones match `maxAzs: 2`
   * and the two-AZ subnet layout the endpoints depend on.
   */
  public get availabilityZones(): string[] {
    return [`${this.region}a`, `${this.region}b`];
  }

  constructor(scope: Construct, id: string, props: VpcStackProps) {
    super(scope, id, props);

    const network = new NetworkResources(this, "Network", {
      config: props.config,
    });
    this.vpc = network.vpc;

    new StringParameter(this, "VpcIdParameter", {
      parameterName: ssmParameterNames.vpcId(props.config),
      stringValue: network.vpc.vpcId,
      description:
        "VPC id for the platform network (published for downstream stacks).",
    });
  }
}
