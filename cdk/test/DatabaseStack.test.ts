import { Match, Template } from "aws-cdk-lib/assertions";
import { synthStacks } from "./helpers";

/**
 * Security-posture and snapshot tests for `${StackPrefix}-Database`.
 *
 * Validates the at-rest / in-transit protection the persistence base must
 * enforce (Requirements 39.2, 46.3):
 *   - storage encrypted at rest;
 *   - TLS required for all client connections (`rds.force_ssl = 1` + proxy
 *     `RequireTLS`);
 *   - deletion protection on and RETAIN removal/replace policies, so personal
 *     data is never silently destroyed;
 *   - the instance is not publicly accessible.
 */
describe("DatabaseStack", () => {
  const { databaseStack } = synthStacks();
  const template = Template.fromStack(databaseStack);

  it("encrypts RDS storage at rest (REQ 39.2)", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      StorageEncrypted: true,
    });
  });

  it("enforces TLS via rds.force_ssl on the parameter group (REQ 39.2)", () => {
    template.hasResourceProperties("AWS::RDS::DBParameterGroup", {
      Parameters: Match.objectLike({ "rds.force_ssl": "1" }),
    });
  });

  it("requires TLS on the RDS Proxy (REQ 39.2)", () => {
    template.hasResourceProperties("AWS::RDS::DBProxy", {
      RequireTLS: true,
    });
  });

  it("enables deletion protection on the instance", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      DeletionProtection: true,
    });
  });

  it("retains the database instance on stack removal/replacement", () => {
    template.hasResource("AWS::RDS::DBInstance", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("does not expose the instance publicly", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      PubliclyAccessible: false,
    });
  });

  it("exports PostgreSQL engine + upgrade logs to CloudWatch (gap 3.3)", () => {
    template.hasResourceProperties("AWS::RDS::DBInstance", {
      EnableCloudwatchLogsExports: Match.arrayWith(["postgresql", "upgrade"]),
    });
  });

  it("bounds the RDS engine log group with a retention (30 days in non-prod)", () => {
    // cloudwatchLogsRetention makes CDK emit a LogRetention custom resource for
    // the auto-created /aws/rds/instance/{id}/postgresql (and upgrade) groups.
    const retentions = template.findResources("Custom::LogRetention");
    const rdsRetentions = Object.values(retentions).filter((r) =>
      JSON.stringify(r.Properties?.LogGroupName ?? "").includes("/aws/rds/instance/"),
    );
    expect(rdsRetentions.length).toBeGreaterThan(0);
    for (const retention of rdsRetentions) {
      expect(retention.Properties?.RetentionInDays).toBe(30);
    }
  });

  it("keeps exporting the RDS admin secret while Compute still imports it", () => {
    const outputs = template.findOutputs("*");
    const exported = Object.values(outputs).some((output) => {
      const exportName = (output as { Export?: { Name?: unknown } }).Export?.Name;
      return (
        typeof exportName === "string" &&
        exportName.includes("DatabaseInstanceSecretAttachment")
      );
    });
    expect(exported).toBe(true);
  });

  it("generates DB credentials into Secrets Manager (never inlined)", () => {
    // dbadmin + 7 app roles + the TRANSITIONAL retired wren_audit secret
    // (drop to 8 when RETIRED_APP_DB_ROLES is removed).
    template.resourceCountIs("AWS::SecretsManager::Secret", 9);
    const proxies = template.findResources("AWS::RDS::DBProxy");
    const auth = Object.values(proxies)[0]?.Properties?.Auth as unknown[];
    // dbadmin + 7 app roles; the retired wren_audit secret is NOT attached.
    expect(auth).toHaveLength(8);
    // The instance's MasterUserPassword must resolve from the secret, not a
    // plaintext literal — regardless of whether CDK emits a resolve token
    // string or an intrinsic Join.
    const instances = template.findResources("AWS::RDS::DBInstance");
    for (const instance of Object.values(instances)) {
      const password = instance.Properties?.MasterUserPassword;
      expect(JSON.stringify(password)).toContain("secretsmanager");
    }
  });

  it("keeps the retired wren_audit secret off the proxy, password sync and SSM, but still exported (TRANSITIONAL)", () => {
    const json = template.toJSON();
    // Same logical id as before, so CloudFormation keeps the deployed secret.
    expect(json.Resources.DatabaseAppUserSecretWrenAudit745C8337?.Type).toBe(
      "AWS::SecretsManager::Secret",
    );
    // Export name the deployed Compute stack imports.
    const exportNames = Object.values(json.Outputs ?? {}).map(
      (o: any) => o.Export?.Name as string | undefined,
    );
    expect(exportNames).toContain(
      `${databaseStack.stackName}:ExportsOutputRefDatabaseAppUserSecretWrenAudit745C83379CA2BA61`,
    );
    const proxy = Object.values(template.findResources("AWS::RDS::DBProxy"))[0];
    expect(JSON.stringify(proxy?.Properties?.Auth)).not.toContain("WrenAudit");
    expect(JSON.stringify(json.Resources)).not.toContain("/database/wren_audit/secret-arn");
    for (const res of Object.values(json.Resources) as any[]) {
      if (res.Type === "AWS::CloudFormation::CustomResource" || res.Type?.startsWith("Custom::")) {
        expect(JSON.stringify(res.Properties)).not.toContain("WrenAudit");
      }
    }
  });

  it("matches the synthesized template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
