import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as logs from "aws-cdk-lib/aws-logs";

import {
  DEFAULT_API_RATE_LIMIT_PER_FIVE_MINUTES,
  RegionalApiWafConstruct,
} from "../lib/constructs/RegionalApiWafConstruct.js";
import { TEST_ACCOUNT, TEST_REGION } from "./helpers.js";

const RESOURCE_ARN = `arn:aws:apigateway:${TEST_REGION}::/restapis/abc123/stages/test`;

function synth(rateLimitPerFiveMinutes?: number) {
  const stack = new Stack(new App(), "WafTest", {
    env: { account: TEST_ACCOUNT, region: TEST_REGION },
  });
  new RegionalApiWafConstruct(stack, "ApiWaf", {
    stackPrefix: "wren-test",
    resourceArn: RESOURCE_ARN,
    logRetention: logs.RetentionDays.ONE_MONTH,
    ...(rateLimitPerFiveMinutes !== undefined ? { rateLimitPerFiveMinutes } : {}),
  });
  return Template.fromStack(stack);
}

describe("RegionalApiWafConstruct", () => {
  it("creates a REGIONAL WebACL with managed rules and the per-IP rate rule in order", () => {
    const template = synth();
    template.resourceCountIs("AWS::WAFv2::WebACL", 1);
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Name: "wren-test-api-web-acl",
      Scope: "REGIONAL",
      DefaultAction: { Allow: {} },
      Rules: [
        Match.objectLike({
          Name: "AWSManagedRulesCommonRuleSet",
          Priority: 1,
          OverrideAction: { None: {} },
        }),
        Match.objectLike({ Name: "AWSManagedRulesKnownBadInputsRuleSet", Priority: 2 }),
        Match.objectLike({ Name: "AWSManagedRulesAmazonIpReputationList", Priority: 3 }),
        Match.objectLike({
          Name: "RateLimitPerIP",
          Priority: 4,
          Action: { Block: {} },
          Statement: {
            RateBasedStatement: {
              Limit: DEFAULT_API_RATE_LIMIT_PER_FIVE_MINUTES,
              AggregateKeyType: "IP",
            },
          },
        }),
      ],
    });
    expect(DEFAULT_API_RATE_LIMIT_PER_FIVE_MINUTES).toBe(2000);
  });

  it("counts (rather than blocks) the Common rule set's 8 KB body-size rule", () => {
    const template = synth();
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: "AWSManagedRulesCommonRuleSet",
          Statement: {
            ManagedRuleGroupStatement: Match.objectLike({
              VendorName: "AWS",
              Name: "AWSManagedRulesCommonRuleSet",
              RuleActionOverrides: [
                { Name: "SizeRestrictions_BODY", ActionToUse: { Count: {} } },
              ],
            }),
          },
        }),
      ]),
    });
  });

  it("does not override rules in the other managed groups", () => {
    const template = synth();
    const acls = template.findResources("AWS::WAFv2::WebACL");
    const rules = Object.values(acls)[0]?.Properties?.Rules as Array<{
      Name: string;
      Statement: { ManagedRuleGroupStatement?: { RuleActionOverrides?: unknown } };
    }>;
    for (const rule of rules.filter((r) => r.Name !== "AWSManagedRulesCommonRuleSet")) {
      expect(rule.Statement.ManagedRuleGroupStatement?.RuleActionOverrides).toBeUndefined();
    }
  });

  it("honours a custom rate limit", () => {
    const template = synth(500);
    template.hasResourceProperties("AWS::WAFv2::WebACL", {
      Rules: Match.arrayWith([
        Match.objectLike({
          Name: "RateLimitPerIP",
          Statement: { RateBasedStatement: { Limit: 500, AggregateKeyType: "IP" } },
        }),
      ]),
    });
  });

  it("associates the WebACL with the given resource", () => {
    const template = synth();
    template.resourceCountIs("AWS::WAFv2::WebACLAssociation", 1);
    template.hasResourceProperties("AWS::WAFv2::WebACLAssociation", {
      ResourceArn: RESOURCE_ARN,
      WebACLArn: { "Fn::GetAtt": [Match.stringLikeRegexp("ApiWafWebAcl"), "Arn"] },
    });
  });

  it("delivers request logs to a retained aws-waf-logs-* group", () => {
    const template = synth();
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: { LogGroupName: "aws-waf-logs-wren-test-api", RetentionInDays: 30 },
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });

    const configs = template.findResources("AWS::WAFv2::LoggingConfiguration");
    expect(Object.keys(configs)).toHaveLength(1);
    const destinations = JSON.stringify(
      Object.values(configs)[0]?.Properties?.LogDestinationConfigs,
    );
    const logGroupId = Object.keys(template.findResources("AWS::Logs::LogGroup"))[0];
    expect(destinations).toContain(":log-group:");
    expect(destinations).toContain(`{"Ref":"${logGroupId}"}`);
    expect(destinations).not.toContain(":*");
  });

  it("redacts the Authorization and Cookie headers from WAF request logs", () => {
    const template = synth();
    template.hasResourceProperties("AWS::WAFv2::LoggingConfiguration", {
      RedactedFields: [
        { SingleHeader: { Name: "authorization" } },
        { SingleHeader: { Name: "cookie" } },
      ],
    });
  });
});
