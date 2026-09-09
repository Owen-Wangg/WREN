import {
  INVALID_PASSWORD_SQLSTATE,
  isInvalidPassword,
  verifyRoleWithRetry,
} from "../lib/rotationVerify.js";

/**
 * Safe credential rotation — per-role verification loop (authorizer throttling
 * remediation, Task 4b).
 *
 * The sync handler must VERIFY each role authenticates through the proxy after
 * ALTER ROLE, retry only while the proxy's secret cache catches up (28P01), and
 * FAIL LOUDLY on a persistent mismatch. An injected probe + no-op sleep keep the
 * test deterministic and DB-free.
 */

const noSleep = (): Promise<void> => Promise.resolve();
const invalidPassword = (): Error =>
  Object.assign(new Error("password authentication failed"), {
    code: INVALID_PASSWORD_SQLSTATE,
  });

describe("isInvalidPassword", () => {
  it("recognizes only Postgres 28P01", () => {
    expect(isInvalidPassword({ code: "28P01" })).toBe(true);
    expect(isInvalidPassword({ code: "ECONNREFUSED" })).toBe(false);
    expect(isInvalidPassword(new Error("boom"))).toBe(false);
    expect(isInvalidPassword(undefined)).toBe(false);
  });
});

describe("verifyRoleWithRetry", () => {
  it("succeeds immediately when the first probe authenticates", async () => {
    const probe = jest.fn().mockResolvedValue(undefined);
    await expect(
      verifyRoleWithRetry("wren_authorizer", "pw", probe, { sleepFn: noSleep }),
    ).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("retries on 28P01 while the proxy cache catches up, then succeeds", async () => {
    const probe = jest
      .fn()
      .mockRejectedValueOnce(invalidPassword())
      .mockRejectedValueOnce(invalidPassword())
      .mockResolvedValueOnce(undefined);

    await expect(
      verifyRoleWithRetry("wren_authorizer", "pw", probe, {
        maxAttempts: 5,
        delayMs: 1,
        sleepFn: noSleep,
      }),
    ).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("fails loudly when the mismatch persists past the window", async () => {
    const probe = jest.fn().mockRejectedValue(invalidPassword());

    await expect(
      verifyRoleWithRetry("wren_authorizer", "pw", probe, {
        maxAttempts: 3,
        delayMs: 1,
        sleepFn: noSleep,
      }),
    ).rejects.toThrow(/still fails password authentication[\s\S]*desynced/);
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("fails immediately on a non-credential error (no retry)", async () => {
    const probe = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error("network down"), { code: "ECONNREFUSED" }));

    await expect(
      verifyRoleWithRetry("wren_authorizer", "pw", probe, {
        maxAttempts: 5,
        delayMs: 1,
        sleepFn: noSleep,
      }),
    ).rejects.toThrow(/network down/);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
