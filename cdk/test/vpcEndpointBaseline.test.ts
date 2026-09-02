import baselineFixture from "./__fixtures__/vpc-endpoint-baseline.json";
import {
  type VpcEndpointBaselineReport,
  parseAwsJson,
  validateBaseline,
} from "../scripts/vpcEndpointBaseline.js";

function fixture(): VpcEndpointBaselineReport {
  return structuredClone(baselineFixture) as VpcEndpointBaselineReport;
}

describe("VPC endpoint baseline validation", () => {
  it("accepts the captured five-interface-endpoint baseline and excludes the unrelated PrivateLink service", () => {
    const result = validateBaseline(fixture());

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(
      "Excluded 1 non-AWS-service PrivateLink endpoint(s) from managed endpoint validation.",
    );
  });

  it("accepts the three retained interface endpoints after removal", () => {
    const report = fixture();
    const endpoints = report.endpoints.filter(
      (endpoint) => !["com.amazonaws.ca-central-1.rds", "com.amazonaws.ca-central-1.execute-api"].includes(endpoint.Service),
    );

    const result = validateBaseline({ ...report, phase: "post-removal", endpoints });

    expect(result.errors).toEqual([]);
  });

  it("rejects either removed service after the post-removal phase", () => {
    const report = fixture();
    const result = validateBaseline({ ...report, phase: "post-removal" });

    expect(result.errors).toContain("Unexpected managed interface endpoint: com.amazonaws.ca-central-1.rds.");
    expect(result.errors).toContain("Unexpected managed interface endpoint: com.amazonaws.ca-central-1.execute-api.");
  });

  it("rejects a missing required interface endpoint", () => {
    const report = fixture();
    const endpoints = report.endpoints.filter(
      (endpoint) => endpoint.Service !== "com.amazonaws.ca-central-1.bedrock-runtime",
    );

    const result = validateBaseline({ ...report, endpoints });

    expect(result.errors).toContain(
      "Missing required interface endpoint: com.amazonaws.ca-central-1.bedrock-runtime.",
    );
  });

  it("rejects an unexpected managed interface endpoint", () => {
    const report = fixture();
    const endpoints = [
      ...report.endpoints,
      {
        Service: "com.amazonaws.ca-central-1.logs",
        State: "available",
        PrivateDns: true,
        Subnets: ["subnet-private-a", "subnet-private-b"],
        RouteTables: [],
      },
    ];

    const result = validateBaseline({ ...report, endpoints });

    expect(result.errors).toContain(
      "Unexpected managed interface endpoint: com.amazonaws.ca-central-1.logs.",
    );
  });

  it("rejects unavailable or detached gateway endpoints", () => {
    const report = fixture();
    const endpoints = report.endpoints.map((endpoint) =>
      endpoint.Service === "com.amazonaws.ca-central-1.s3"
        ? { ...endpoint, State: "pending", RouteTables: [] }
        : endpoint,
    );

    const result = validateBaseline({ ...report, endpoints });

    expect(result.errors).toContain("Gateway endpoint com.amazonaws.ca-central-1.s3 is pending, not available.");
    expect(result.errors).toContain("Gateway endpoint com.amazonaws.ca-central-1.s3 has no route-table associations.");
  });

  it("rejects a missing successful all-traffic VPC Flow Log", () => {
    const report = fixture();
    const result = validateBaseline({ ...report, flowLogs: [] });

    expect(result.errors).toContain(
      "No successful ALL-traffic VPC Flow Log with a CloudWatch Logs destination was found.",
    );
  });

  it("reports unavailable Cost Explorer data as a warning rather than hiding the evidence gap", () => {
    const report = fixture();
    const result = validateBaseline({
      ...report,
      costExplorer: { status: "unavailable", message: "AccessDeniedException" },
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("Cost Explorer data is unavailable: AccessDeniedException");
  });

  it("parses AWS CLI JSON and fails clearly for malformed output", () => {
    expect(parseAwsJson('{"VpcId":"vpc-123"}', "fixture")).toEqual({ VpcId: "vpc-123" });
    expect(() => parseAwsJson("not-json", "fixture")).toThrow("fixture returned invalid JSON");
  });
});
