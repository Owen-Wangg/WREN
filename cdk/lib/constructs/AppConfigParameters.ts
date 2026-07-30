import { aws_bedrock as bedrock } from "aws-cdk-lib";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import type { AppConfig } from "../config.js";
import { appNameParameterName, bedrockModelIdParameterName } from "../config.js";

export interface AppConfigParametersProps {
  readonly config: AppConfig;
}

/**
 * Publishes the single-source application configuration to SSM Parameter Store
 * so backend Lambdas resolve it at runtime rather than via source literals:
 *
 *   - Application name      (REQ-NFR-APPNAME-01) — defaults to the configured
 *     value, set to the display name (e.g. "WREN") purely through configuration.
 *   - Bedrock model id      (REQ-NFR-MODEL-01)   — model-agnostic; changing it
 *     is a configuration edit, never a code change.
 *
 * Parameter paths are scoped to `${StackPrefix}` only (see config.ts helpers)
 * and carry no separate brand literal. The *values* come from {@link AppConfig},
 * which itself derives from CDK context with the defaults defined in config.ts.
 */
export class AppConfigParameters extends Construct {
  public readonly appNameParameter: StringParameter;
  public readonly bedrockModelIdParameter: StringParameter;
  public readonly promptGuardrailIdParameter: StringParameter;
  public readonly promptGuardrailVersionParameter: StringParameter;

  constructor(scope: Construct, id: string, props: AppConfigParametersProps) {
    super(scope, id);

    const { config } = props;

    this.appNameParameter = new StringParameter(this, "AppName", {
      parameterName: appNameParameterName(config),
      stringValue: config.appName,
      description:
        "Configurable application/display name (REQ-NFR-APPNAME-01). Resolved " +
        "from configuration; set to any display name with no backend code change.",
    });

    this.bedrockModelIdParameter = new StringParameter(this, "BedrockModelId", {
      parameterName: bedrockModelIdParameterName(config),
      stringValue: config.bedrockModelId,
      description:
        "Configurable Bedrock model identifier (REQ-NFR-MODEL-01). Resolved at " +
        "runtime; changing it requires configuration only, not code.",
    });

    // Prompt injection guardrail — scans admin-submitted prompt text for
    // prompt attack patterns before they are persisted (MEDIUM sensitivity
    // balances detection against false positives on legitimate instructions).
    const promptGuardrail = new bedrock.CfnGuardrail(this, "PromptInjectionGuardrail", {
      name: `${config.stackPrefix}-prompt-injection`,
      description: "Detects prompt injection attempts in admin-submitted prompt fields.",
      blockedInputMessaging: "Prompt contains disallowed instructions.",
      blockedOutputsMessaging: "Response blocked.",
      contentPolicyConfig: {
        filtersConfig: [
          {
            type: "PROMPT_ATTACK",
            inputStrength: "MEDIUM",
            outputStrength: "NONE",
          },
        ],
      },
    });

    this.promptGuardrailIdParameter = new StringParameter(this, "PromptGuardrailId", {
      parameterName: `/${config.stackPrefix}/config/prompt-guardrail-id`,
      stringValue: promptGuardrail.attrGuardrailId,
      description: "Bedrock Guardrail ID for admin prompt injection detection.",
    });

    this.promptGuardrailVersionParameter = new StringParameter(this, "PromptGuardrailVersion", {
      parameterName: `/${config.stackPrefix}/config/prompt-guardrail-version`,
      stringValue: "DRAFT",
      description: "Bedrock Guardrail version for admin prompt injection detection.",
    });
  }
}
