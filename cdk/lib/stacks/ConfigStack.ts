import { Stack } from "aws-cdk-lib";
import type { StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { AppConfig } from "../config.js";
import { AppConfigParameters } from "../constructs/AppConfigParameters.js";

export interface ConfigStackProps extends StackProps {
  readonly config: AppConfig;
}

/**
 * `${StackPrefix}-Config` — the single runtime home for cross-cutting
 * application configuration that must be resolvable by backend Lambdas without
 * any source literal:
 *
 *   - application/display name (REQ-NFR-APPNAME-01)
 *   - Bedrock model identifier (REQ-NFR-MODEL-01)
 *
 * Both are published as SSM parameters via {@link AppConfigParameters}. The
 * configurable defaults live in exactly one place (`lib/config.ts`), so a
 * rebrand or model swap is a configuration edit, never a code change.
 */
export class ConfigStack extends Stack {
  public readonly parameters: AppConfigParameters;

  constructor(scope: Construct, id: string, props: ConfigStackProps) {
    super(scope, id, props);

    this.parameters = new AppConfigParameters(this, "AppConfig", {
      config: props.config,
    });
  }
}
