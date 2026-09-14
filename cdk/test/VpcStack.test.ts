import { Template } from "aws-cdk-lib/assertions";
import { synthStacks } from "./helpers";

/**
 * Snapshot + traceability tests for `${StackPrefix}-Vpc`.
 *
 * The VPC carries no persistent personal data, but it is part of the
 * data-residency boundary: all data-plane compute runs inside this regional
 * VPC, and flow logs provide the traceability the security steering requires.
 */
describe("VpcStack", () => {
  const { vpcStack } = synthStacks();
  const template = Template.fromStack(vpcStack);

  it("provisions a single regional VPC", () => {
    template.resourceCountIs("AWS::EC2::VPC", 1);
  });

  it("enables VPC flow logs for traceability", () => {
    template.resourceCountIs("AWS::EC2::FlowLog", 1);
  });

  it("retains only the cost-justified endpoint allowlist", () => {
    const endpointResources = Object.values(template.findResources("AWS::EC2::VPCEndpoint")) as Array<{
      Properties?: {
        VpcEndpointType?: string;
        PrivateDnsEnabled?: boolean;
        SubnetIds?: unknown[];
        ServiceName?: unknown;
      };
    }>;
    const interfaceEndpoints = endpointResources.filter(
      (endpoint) => endpoint.Properties?.VpcEndpointType === "Interface",
    );
    const gatewayEndpoints = endpointResources.filter(
      (endpoint) => endpoint.Properties?.VpcEndpointType === "Gateway",
    );
    const renderedInterfaces = JSON.stringify(interfaceEndpoints);
    const renderedGateways = JSON.stringify(gatewayEndpoints);

    expect(interfaceEndpoints).toHaveLength(3);
    expect(gatewayEndpoints).toHaveLength(2);
    expect(renderedInterfaces).toContain("secretsmanager");
    expect(renderedInterfaces).toContain("ssm");
    expect(renderedInterfaces).toContain("bedrock-runtime");
    expect(renderedInterfaces).not.toContain("execute-api");
    expect(renderedInterfaces).not.toContain(".rds");
    expect(renderedGateways).toContain("dynamodb");
    expect(renderedGateways).toContain("s3");
    for (const endpoint of interfaceEndpoints) {
      expect(endpoint.Properties?.PrivateDnsEnabled).toBe(true);
      expect(endpoint.Properties?.SubnetIds).toHaveLength(2);
    }
  });

  it("matches the synthesized template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
