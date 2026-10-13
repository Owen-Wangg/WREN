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

  it("provisions the documents + reference buckets and the audit log bucket", () => {
    // Documents + Reference (PII) + the dedicated CloudTrail log bucket (S-5).
    template.resourceCountIs("AWS::S3::Bucket", 3);
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

  it("encrypts the two PII buckets with KMS and the audit log bucket with S3-managed keys (REQ 39.2)", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    const algorithms = Object.values(buckets).map(
      (bucket) =>
        bucket.Properties?.BucketEncryption
          ?.ServerSideEncryptionConfiguration?.[0]
          ?.ServerSideEncryptionByDefault?.SSEAlgorithm,
    );
    // The two PII buckets (Documents + Reference) use the customer-managed CMK.
    expect(algorithms.filter((a) => a === "aws:kms")).toHaveLength(2);
    // The CloudTrail log bucket uses S3-managed encryption (SSE-S3): matches
    // the CloudFront access-log precedent and avoids coupling the CloudTrail
    // delivery path to the storage CMK's key policy, while still encrypting
    // the audit logs at rest (finding S-5).
    expect(algorithms.filter((a) => a === "AES256")).toHaveLength(1);
  });

  it("enforces SSL on every S3 bucket via a deny-insecure-transport policy (REQ 39.2)", () => {
    const policies = template.findResources("AWS::S3::BucketPolicy");
    // Documents + Reference + the audit log bucket (whose policy also carries
    // the CloudTrail delivery statements) — each still enforces TLS.
    expect(Object.keys(policies).length).toBe(3);
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

  it("denies non-SSE-KMS PutObject on the documents bucket (finding S-4)", () => {
    const policies = template.findResources("AWS::S3::BucketPolicy");
    const denyUnencrypted = Object.values(policies).some((policy) => {
      const statements = policy.Properties?.PolicyDocument?.Statement ?? [];
      return statements.some(
        (s: {
          Effect?: string;
          Action?: string | string[];
          Condition?: { StringNotEquals?: Record<string, unknown> };
        }) => {
          const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
          return (
            s.Effect === "Deny" &&
            actions.includes("s3:PutObject") &&
            s.Condition?.StringNotEquals?.[
              "s3:x-amz-server-side-encryption"
            ] === "aws:kms"
          );
        },
      );
    });
    expect(denyUnencrypted).toBe(true);
  });

  it("logs object-level data events on the PII buckets via a single-region CloudTrail (finding S-5)", () => {
    const trails = template.findResources("AWS::CloudTrail::Trail");
    expect(Object.keys(trails).length).toBe(1);

    const trail = Object.values(trails)[0]!;
    expect(trail.Properties?.EnableLogFileValidation).toBe(true);
    expect(trail.Properties?.IsMultiRegionTrail).toBe(false);
    expect(trail.Properties?.IncludeGlobalServiceEvents).toBe(false);

    const selectors = trail.Properties?.EventSelectors ?? [];
    const dataEventSelector = selectors.find(
      (s: {
        ReadWriteType?: string;
        IncludeManagementEvents?: boolean;
        DataResources?: { Type?: string }[];
      }) =>
        s.ReadWriteType === "All" &&
        s.IncludeManagementEvents === false &&
        (s.DataResources ?? []).some((d) => d.Type === "AWS::S3::Object"),
    );
    expect(dataEventSelector).toBeDefined();
    // No management events are logged (data-events-only trail).
    for (const s of selectors) {
      expect(s.IncludeManagementEvents).toBe(false);
    }
  });

  it("expires the audit log bucket's records after 90 days (finding S-5)", () => {
    const buckets = template.findResources("AWS::S3::Bucket");
    const auditBucket = Object.values(buckets).find((bucket) =>
      (
        bucket.Properties?.LifecycleConfiguration?.Rules ?? []
      ).some((r: { Id?: string }) => r.Id === "ExpireObjectAccessLogs"),
    );
    expect(auditBucket).toBeDefined();
    const rule = auditBucket!.Properties.LifecycleConfiguration.Rules.find(
      (r: { Id?: string }) => r.Id === "ExpireObjectAccessLogs",
    );
    expect(rule.ExpirationInDays).toBe(90);
    expect(rule.Status).toBe("Enabled");
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
    // Only the Documents bucket has CORS; the Reference and audit-log buckets
    // do not (finding S-5 added the audit-log bucket).
    expect(withCors).toHaveLength(1);
    expect(withoutCors).toHaveLength(2);

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
    // A configured custom domain pins the bucket to exact origins; the shared
    // *.amplifyapp.com wildcard is dropped (finding S-7).
    expect(origins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "https://coach.example.com",
      "https://www.coach.example.com",
    ]);
    expect(origins).not.toContain("https://*.amplifyapp.com");
    expect(origins).not.toContain("*");
  });

  it("matches the synthesized template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
