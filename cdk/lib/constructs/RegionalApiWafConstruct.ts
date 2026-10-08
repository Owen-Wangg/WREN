import { ArnFormat, RemovalPolicy, Stack } from "aws-cdk-lib";
import * as logs from "aws-cdk-lib/aws-logs";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

/** Default per-IP request ceiling for each 5-minute WAF evaluation window. */
export const DEFAULT_API_RATE_LIMIT_PER_FIVE_MINUTES = 2000;

/**
 * Rules inside `AWSManagedRulesCommonRuleSet` that are switched from block to
 * count for the REST API.
 *
 * - `SizeRestrictions_BODY` blocks any body over 8 KB. Draft saves carry TipTap
 *   JSON up to several MB, so this rule would reject normal editor traffic.
 *   Body size is bounded by API Gateway (10 MB) and the TipTap field limit in
 *   `@wren/types` instead.
 *
 * Counted rules still emit metrics and log entries.
 * See https://docs.aws.amazon.com/waf/latest/developerguide/aws-managed-rule-groups-baseline.html
 */
export const COMMON_RULE_SET_COUNT_OVERRIDES: readonly string[] = ["SizeRestrictions_BODY"];

export interface RegionalApiWafProps {
  /** Prefix used for the WebACL, metric, and log group names. */
  readonly stackPrefix: string;
  /** ARN of the regional resource to protect (e.g. an API Gateway stage ARN). */
  readonly resourceArn: string;
  /** Retention for the WAF request log group. */
  readonly logRetention: logs.RetentionDays;
  /** Requests per IP per 5-minute window before the IP is blocked. */
  readonly rateLimitPerFiveMinutes?: number;
}

/**
 * REGIONAL WAFv2 WebACL attached to a regional resource such as a REST API
 * stage.
 *
 * Rules (evaluated in priority order):
 *   1. AWSManagedRulesCommonRuleSet (with {@link COMMON_RULE_SET_COUNT_OVERRIDES})
 *   2. AWSManagedRulesKnownBadInputsRuleSet
 *   3. AWSManagedRulesAmazonIpReputationList
 *   4. RateLimitPerIP — blocks a source IP that exceeds the per-5-minute limit
 *
 * Full per-request WAF logs are delivered to a retained CloudWatch Logs group.
 */
export class RegionalApiWafConstruct extends Construct {
  public readonly webAcl: wafv2.CfnWebACL;
  public readonly logGroup: logs.LogGroup;

  private readonly props: RegionalApiWafProps;

  constructor(scope: Construct, id: string, props: RegionalApiWafProps) {
    super(scope, id);
    this.props = props;

    this.webAcl = this.createWebAcl();
    this.logGroup = this.createLogging(this.webAcl);
    this.createAssociation(this.webAcl);
  }

  protected createWebAcl(): wafv2.CfnWebACL {
    const { stackPrefix } = this.props;
    const rateLimit =
      this.props.rateLimitPerFiveMinutes ?? DEFAULT_API_RATE_LIMIT_PER_FIVE_MINUTES;

    const visibility = (metricName: string): wafv2.CfnWebACL.VisibilityConfigProperty => ({
      cloudWatchMetricsEnabled: true,
      metricName: `${stackPrefix}-api-${metricName}`,
      sampledRequestsEnabled: true,
    });

    const managedRule = (
      name: string,
      priority: number,
      countOverrides: readonly string[] = [],
    ): wafv2.CfnWebACL.RuleProperty => ({
      name,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: "AWS",
          name,
          ...(countOverrides.length > 0
            ? {
                ruleActionOverrides: countOverrides.map((ruleName) => ({
                  name: ruleName,
                  actionToUse: { count: {} },
                })),
              }
            : {}),
        },
      },
      visibilityConfig: visibility(name),
    });

    return new wafv2.CfnWebACL(this, "WebAcl", {
      name: `${stackPrefix}-api-web-acl`,
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: visibility("waf-metric"),
      rules: [
        managedRule("AWSManagedRulesCommonRuleSet", 1, COMMON_RULE_SET_COUNT_OVERRIDES),
        managedRule("AWSManagedRulesKnownBadInputsRuleSet", 2),
        managedRule("AWSManagedRulesAmazonIpReputationList", 3),
        {
          name: "RateLimitPerIP",
          priority: 4,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: rateLimit,
              aggregateKeyType: "IP",
            },
          },
          visibilityConfig: visibility("rate-limit"),
        },
      ],
    });
  }

  /**
   * WAF request logs. The log group name must start with `aws-waf-logs-`, and
   * `logDestinationConfigs` takes the log-group ARN without the trailing `:*`
   * that `logGroup.logGroupArn` appends.
   */
  protected createLogging(webAcl: wafv2.CfnWebACL): logs.LogGroup {
    const logGroup = new logs.LogGroup(this, "Logs", {
      logGroupName: `aws-waf-logs-${this.props.stackPrefix}-api`,
      retention: this.props.logRetention,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const logGroupArn = Stack.of(this).formatArn({
      service: "logs",
      resource: "log-group",
      resourceName: logGroup.logGroupName,
      arnFormat: ArnFormat.COLON_RESOURCE_NAME,
    });

    const logging = new wafv2.CfnLoggingConfiguration(this, "Logging", {
      resourceArn: webAcl.attrArn,
      logDestinationConfigs: [logGroupArn],
      // Mask credential-bearing headers so live Cognito bearer tokens and
      // session cookies are never written to the retained log group. WAF
      // replaces each matched field with `REDACTED` while still logging the
      // rest of the request for rule visibility.
      // CDK maps the outer `singleHeader` key to `SingleHeader` but passes the
      // inner object through verbatim, so the header name must use the
      // CloudFormation casing `Name` (lowercase `name` renders invalid WAF).
      redactedFields: [
        { singleHeader: { Name: "authorization" } },
        { singleHeader: { Name: "cookie" } },
      ] as unknown as wafv2.CfnLoggingConfiguration.FieldToMatchProperty[],
    });
    logging.node.addDependency(logGroup);

    return logGroup;
  }

  protected createAssociation(webAcl: wafv2.CfnWebACL): wafv2.CfnWebACLAssociation {
    return new wafv2.CfnWebACLAssociation(this, "Association", {
      resourceArn: this.props.resourceArn,
      webAclArn: webAcl.attrArn,
    });
  }
}
