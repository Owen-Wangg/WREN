import { RetentionDays } from "aws-cdk-lib/aws-logs";

import { resolveLogRetention } from "../lib/config.js";
import { testConfig } from "./helpers.js";

/**
 * Unit tests for the shared CloudWatch Logs retention policy
 * ({@link resolveLogRetention}). This is the single source of truth every
 * newly-bounded log group (AppSync API logs, API Gateway execution + access
 * logs, WAF request logs, RDS engine logs) reads from, so it must track the
 * project convention: 90 days in production, 30 days otherwise.
 */
describe("resolveLogRetention", () => {
  it("uses 90 days (THREE_MONTHS) in production", () => {
    expect(resolveLogRetention(testConfig({ environmentName: "prod" }))).toBe(
      RetentionDays.THREE_MONTHS,
    );
  });

  it("uses 30 days (ONE_MONTH) in non-production environments", () => {
    expect(resolveLogRetention(testConfig({ environmentName: "dev" }))).toBe(
      RetentionDays.ONE_MONTH,
    );
    expect(resolveLogRetention(testConfig({ environmentName: "test" }))).toBe(
      RetentionDays.ONE_MONTH,
    );
  });
});
