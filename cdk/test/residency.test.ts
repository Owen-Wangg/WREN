import { Match, Template } from "aws-cdk-lib/assertions";
import { synthStacks, TEST_ACCOUNT, TEST_REGION } from "./helpers";

/**
 * Cross-cutting data-residency guards for the foundational stacks.
 *
 * Validates:
 *   - Requirement 46.1 — RDS / S3 / DynamoDB are provisioned in `ca-central-1`.
 *   - Requirement 46.3 — all at-rest personal data stays within `ca-central-1`:
 *     no persistent store declares a cross-region copy (S3 replication,
 *     DynamoDB global-table replicas, or an RDS cross-region read replica).
 *   - Requirement 39.2 — encryption at rest is in force on every persistent
 *     store (asserted in detail in the per-stack suites).
 */
describe("foundational stacks — data residency (REQ 46.1, 46.3)", () => {
  const { configStack, vpcStack, databaseStack, storageStack } = synthStacks();
  const allStacks = { configStack, vpcStack, databaseStack, storageStack };

  it("places every foundational stack in ca-central-1", () => {
    for (const stack of Object.values(allStacks)) {
      expect(stack.region).toBe(TEST_REGION);
      expect(stack.account).toBe(TEST_ACCOUNT);
    }
  });

  describe("no cross-region persistent store", () => {
    it("declares no DynamoDB global-table replicas", () => {
      const template = Template.fromStack(storageStack);

      // A regional table must not carry cross-region replicas, and there must
      // be no global-table resource at all.
      template.hasResourceProperties("AWS::DynamoDB::Table", {
        Replicas: Match.absent(),
      });
      template.resourceCountIs("AWS::DynamoDB::GlobalTable", 0);
    });

    it("declares no S3 cross-region replication", () => {
      const template = Template.fromStack(storageStack);

      const buckets = template.findResources("AWS::S3::Bucket");
      expect(Object.keys(buckets).length).toBeGreaterThan(0);
      for (const bucket of Object.values(buckets)) {
        expect(bucket.Properties?.ReplicationConfiguration).toBeUndefined();
      }
    });

    it("declares no RDS cross-region replica (no SourceRegion / SourceDBInstance)", () => {
      const template = Template.fromStack(databaseStack);

      const instances = template.findResources("AWS::RDS::DBInstance");
      expect(Object.keys(instances).length).toBeGreaterThan(0);
      for (const instance of Object.values(instances)) {
        expect(instance.Properties?.SourceRegion).toBeUndefined();
        expect(instance.Properties?.SourceDBInstanceIdentifier).toBeUndefined();
      }
    });
  });
});
