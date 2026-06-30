import { Match, Template } from "aws-cdk-lib/assertions";
import { synthStacks } from "./helpers";

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

  it("matches the synthesized template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
