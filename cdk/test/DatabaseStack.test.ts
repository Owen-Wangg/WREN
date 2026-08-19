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

  it("generates DB credentials into Secrets Manager (never inlined)", () => {
    template.resourceCountIs("AWS::SecretsManager::Secret", 9);
    const proxies = template.findResources("AWS::RDS::DBProxy");
    const auth = Object.values(proxies)[0]?.Properties?.Auth as unknown[];
    expect(auth).toHaveLength(9);
    // The instance's MasterUserPassword must resolve from the secret, not a
    // plaintext literal — regardless of whether CDK emits a resolve token
    // string or an intrinsic Join.
    const instances = template.findResources("AWS::RDS::DBInstance");
    for (const instance of Object.values(instances)) {
      const password = instance.Properties?.MasterUserPassword;
      expect(JSON.stringify(password)).toContain("secretsmanager");
    }
  });

  it("matches the synthesized template snapshot", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
