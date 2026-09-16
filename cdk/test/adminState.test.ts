import { nextAdminStep, type AdminGateState } from "../scripts/operations/adminState.js";

const ready: AdminGateState = {
  exists: true,
  confirmed: true,
  inSystemAdmin: true,
  exactSubjectArmed: true,
};

describe("TechnicalAdmin deployment state machine", () => {
  it.each([
    [{ ...ready, exists: false }, "signup"],
    [{ ...ready, confirmed: false }, "confirm"],
    [{ ...ready, inSystemAdmin: false }, "add-group"],
    [{ ...ready, exactSubjectArmed: false }, "arm-bootstrap"],
    [ready, "complete"],
  ] as const)("selects %s -> %s", (state, expected) => {
    expect(nextAdminStep(state)).toBe(expected);
  });
});
