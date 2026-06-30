import { Template } from "aws-cdk-lib/assertions";
import { synthStacks } from "./helpers";

/**
 * Snapshot test for `${StackPrefix}-Config`.
 *
 * The Config stack publishes the single-source application name and Bedrock
 * model id to SSM. It holds no persistent personal data, so the snapshot is the
 * primary regression guard here (plus a count of the two published parameters).
 */
describe("ConfigStack", () => {
  const { configStack } = synthStacks();
  const template = Template.fromStack(configStack);

  it("publishes the app-name and model-id SSM parameters", () => {
    template.resourceCountIs("AWS::SSM::Parameter", 2);
  });

  it("matches the synthesized template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
