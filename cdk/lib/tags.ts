import { Tags } from "aws-cdk-lib";
import type { IConstruct } from "constructs";
import type { AppConfig } from "./config.js";

/**
 * Apply the standard cost-allocation / governance tags to a scope.
 *
 * Applied at the `App` scope, these propagate to every stack and resource, so
 * each stack is tagged for cost allocation per the CDK steering:
 *   cdk.Tags.of(stack).add("Project", StackPrefix)
 *
 * Can also be called against an individual stack when per-stack tagging is
 * preferred.
 */
export function applyStandardTags(scope: IConstruct, config: AppConfig): void {
  const tags = Tags.of(scope);
  tags.add("Project", config.stackPrefix);
  tags.add("Application", config.appName);
  tags.add("Environment", config.environmentName);
  tags.add("ManagedBy", "cdk");
}
