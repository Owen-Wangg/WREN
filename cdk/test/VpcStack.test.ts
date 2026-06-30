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

  it("matches the synthesized template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
