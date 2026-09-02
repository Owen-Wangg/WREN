import { assertAdminProbeSafe, nextAdminStep, type AdminGateState } from "../scripts/operations/adminState.js";

const ready: AdminGateState = {
  exists: true,
  confirmed: true,
  inSystemAdmin: true,
  exactSubjectArmed: true,
  hasAccessToken: true,
};

describe("TechnicalAdmin deployment state machine", () => {
  it.each([
    [{ ...ready, exists: false }, "signup"],
    [{ ...ready, confirmed: false }, "confirm"],
    [{ ...ready, inSystemAdmin: false }, "add-group"],
    [{ ...ready, exactSubjectArmed: false }, "arm-bootstrap"],
    [{ ...ready, hasAccessToken: false }, "await-token"],
    [ready, "probe"],
  ] as const)("selects %s -> %s", (state, expected) => {
    expect(nextAdminStep(state)).toBe(expected);
  });

  it("never permits an authenticated probe before every irreversible bootstrap gate is ready", () => {
    expect(() => assertAdminProbeSafe({ ...ready, exactSubjectArmed: false })).toThrow("Refusing");
    expect(() => assertAdminProbeSafe(ready)).not.toThrow();
  });
});
