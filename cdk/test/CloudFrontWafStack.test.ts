import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { CloudFrontWafStack } from "../lib/stacks/CloudFrontWafStack.js";
import { testConfig } from "./helpers.js";

function synthCloudFront() {
  const config = testConfig();
  const stack = new CloudFrontWafStack(new App(), `${config.stackPrefix}-CloudFrontWaf`, {
    env: { account: config.env.account, region: "us-east-1" },
    config,
    apiEndpoint: "https://abc123.execute-api.ca-central-1.amazonaws.com/prod/",
  });
  return { config, template: Template.fromStack(stack) };
}

describe("CloudFrontWafStack observability", () => {
  it("enables distribution access logging to an S3 bucket that expires objects after 30 days", () => {
    const { template } = synthCloudFront();

    template.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Status: "Enabled",
            ExpirationInDays: 30,
          }),
        ]),
      },
    });

    const buckets = Object.keys(template.findResources("AWS::S3::Bucket"));
    expect(buckets.length).toBeGreaterThan(0);
    const logging = template.findResources("AWS::CloudFront::Distribution");
    const dist = Object.values(logging)[0];
    expect(dist?.Properties?.DistributionConfig?.Logging).toEqual(
      expect.objectContaining({
        Prefix: "cloudfront/",
      }),
    );
  });

  it("publishes additional CloudFront metrics", () => {
    const { template } = synthCloudFront();
    template.hasResourceProperties("AWS::CloudFront::MonitoringSubscription", {
      MonitoringSubscription: {
        RealtimeMetricsSubscriptionConfig: Match.objectLike({
          RealtimeMetricsSubscriptionStatus: "Enabled",
        }),
      },
    });
  });

  it("alarms on elevated 5xx and 4xx error rates", () => {
    const { config, template } = synthCloudFront();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: `${config.stackPrefix}-cloudfront-5xx`,
      Namespace: "AWS/CloudFront",
      MetricName: "5xxErrorRate",
      Threshold: 5,
    });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: `${config.stackPrefix}-cloudfront-4xx`,
      Namespace: "AWS/CloudFront",
      MetricName: "4xxErrorRate",
      Threshold: 50,
    });
  });
});

/**
 * WAF request logging (logging review gap 3.2). visibilityConfig only emits
 * aggregate metrics + a sampled subset; full per-request logs must be delivered
 * to a dedicated, retention-bound `aws-waf-logs-*` CloudWatch Logs group so a
 * specific blocked/allowed request can be investigated.
 */
describe("CloudFrontWafStack WAF request logging", () => {
  it("creates a retention-bound aws-waf-logs-* CloudWatch log group", () => {
    const { config, template } = synthCloudFront();
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      // WAF -> CloudWatch requires the group name to start with aws-waf-logs-.
      LogGroupName: `aws-waf-logs-${config.stackPrefix}-cloudfront`,
      // Non-prod test config -> 30-day retention.
      RetentionInDays: 30,
    });
  });

  it("retains the WAF log group on stack teardown", () => {
    const { template } = synthCloudFront();
    template.hasResource("AWS::Logs::LogGroup", {
      Properties: Match.objectLike({
        LogGroupName: Match.stringLikeRegexp("^aws-waf-logs-.*"),
      }),
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("delivers WebACL request logs to the log group (ARN without :* wildcard)", () => {
    const { template } = synthCloudFront();
    const configs = template.findResources("AWS::WAFv2::LoggingConfiguration");
    const entries = Object.values(configs);
    expect(entries).toHaveLength(1);

    const logging = entries[0]!;
    // The destination must be the log-group ARN with a colon separator and NO
    // trailing ":*" — WAF rejects the wildcard form CDK's logGroupArn produces.
    const destinations = logging.Properties?.LogDestinationConfigs as unknown[];
    expect(destinations).toHaveLength(1);

    // The destination is the log-group ARN (built via formatArn) referencing
    // the aws-waf-logs group. Its name is emitted as a Ref, so assert on the
    // ARN shape + group reference rather than a literal name.
    const logGroups = template.findResources("AWS::Logs::LogGroup");
    const wafLogGroupId = Object.entries(logGroups).find(([, r]) =>
      JSON.stringify(r.Properties?.LogGroupName ?? "").includes("aws-waf-logs-"),
    )?.[0];
    expect(wafLogGroupId).toBeDefined();

    const destJson = JSON.stringify(destinations[0]);
    expect(destJson).toContain(":log-group:");
    expect(destJson).toContain(wafLogGroupId!);
    // WAF rejects the ":*" wildcard suffix that logGroup.logGroupArn produces.
    expect(destJson).not.toContain(":*");
  });

  it("associates the logging configuration with the CloudFront WebACL", () => {
    const { template } = synthCloudFront();
    const webAcls = template.findResources("AWS::WAFv2::WebACL");
    const webAclLogicalId = Object.keys(webAcls)[0]!;
    const configs = template.findResources("AWS::WAFv2::LoggingConfiguration");
    const resourceArn = JSON.stringify(
      Object.values(configs)[0]?.Properties?.ResourceArn,
    );
    // ResourceArn is an intrinsic referencing the WebACL's Arn attribute.
    expect(resourceArn).toContain(webAclLogicalId);
  });
});
