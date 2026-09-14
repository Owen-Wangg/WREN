import { Match, Template } from "aws-cdk-lib/assertions";
import { synthStacks, testConfig } from "./helpers";

/**
 * Security-posture and snapshot tests for `${StackPrefix}-Storage`.
 *
 * Validates the object / key-value persistence base (Requirements 39.2, 46.3):
 *   - both S3 buckets block all public access;
 *   - both buckets enforce SSL (TLS in transit) and KMS encryption at rest;
 *   - the DynamoDB conversation table is encrypted with a customer-managed KMS
 *     key and retained on teardown;
 *   - the shared KMS key has rotation enabled.
 */
describe("StorageStack", () => {
  const { storageStack } = synthStacks();
  const template = Template.fromStack(storageStack);

  it("provisions exactly the documents + reference buckets", () => {
    template.resourceCountIs("AWS::S3::Bucket", 2);
  });

  it("blocks all public access on every S3 bucket (REQ 46.3)", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    for (const bucket of Object.values(buckets)) {
      expect(bucket.Properties?.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
  });

  it("encrypts every S3 bucket with KMS (REQ 39.2)", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    for (const bucket of Object.values(buckets)) {
      const rules =
        bucket.Properties?.BucketEncryption?.ServerSideEncryptionConfiguration;
      expect(Array.isArray(rules)).toBe(true);
      expect(
        rules[0]?.ServerSideEncryptionByDefault?.SSEAlgorithm,
      ).toBe("aws:kms");
    }
  });

  it("enforces SSL on every S3 bucket via a deny-insecure-transport policy (REQ 39.2)", () => {
    const policies = template.findResources("AWS::S3::BucketPolicy");
    expect(Object.keys(policies).length).toBe(2);
    for (const policy of Object.values(policies)) {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      const denyInsecure = statements.some(
        (s: {
          Effect?: string;
          Condition?: { Bool?: Record<string, unknown> };
        }) =>
          s.Effect === "Deny" &&
          s.Condition?.Bool?.["aws:SecureTransport"] === "false",
      );
      expect(denyInsecure).toBe(true);
    }
  });

  it("encrypts the DynamoDB table with a customer-managed KMS key (REQ 39.2)", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      SSESpecification: Match.objectLike({
        SSEEnabled: true,
        SSEType: "KMS",
      }),
    });
  });

  it("retains the DynamoDB table on stack removal", () => {
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("names the conversation table from StackPrefix with no brand literal", () => {
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      TableName: "wren-test-ConversationHistory",
    });
  });

  it("enables rotation on the storage KMS key", () => {
    template.hasResourceProperties("AWS::KMS::Key", {
      EnableKeyRotation: true,
    });
  });

  it("scopes documents-bucket CORS to frontend origins and leaves the reference bucket without CORS", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    const withCors = Object.values(buckets).filter(
      (bucket) => bucket.Properties?.CorsConfiguration,
    );
    const withoutCors = Object.values(buckets).filter(
      (bucket) => !bucket.Properties?.CorsConfiguration,
    );
    expect(withCors).toHaveLength(1);
    expect(withoutCors).toHaveLength(1);

    const corsRule = withCors[0]?.Properties?.CorsConfiguration?.CorsRules?.[0];
    const origins = corsRule?.AllowedOrigins ?? [];
    expect(origins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://*.amplifyapp.com",
    ]);
    expect(origins).not.toContain("*");
  });

  it("adds the custom domain to documents-bucket CORS when configured", () => {
    const { storageStack } = synthStacks(testConfig({ customDomain: "coach.example.com" }));
    const customTemplate = Template.fromStack(storageStack);
    const buckets = customTemplate.findResources("AWS::S3::Bucket");
    const withCors = Object.values(buckets).find(
      (bucket) => bucket.Properties?.CorsConfiguration,
    );
    const origins = withCors?.Properties?.CorsConfiguration?.CorsRules?.[0]?.AllowedOrigins ?? [];
    expect(origins).toEqual(expect.arrayContaining([
      "https://coach.example.com",
      "https://www.coach.example.com",
      "https://*.amplifyapp.com",
    ]));
    expect(origins).not.toContain("*");
  });

  it("matches the synthesized template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
