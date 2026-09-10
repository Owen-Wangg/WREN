export type AdminStep =
  | "signup"
  | "confirm"
  | "add-group"
  | "arm-bootstrap"
  | "await-token"
  | "probe";

export interface AdminGateState {
  readonly exists: boolean;
  readonly confirmed: boolean;
  readonly inSystemAdmin: boolean;
  readonly exactSubjectArmed: boolean;
  readonly hasAccessToken: boolean;
}

export function nextAdminStep(state: AdminGateState): AdminStep {
  if (!state.exists) return "signup";
  if (!state.confirmed) return "confirm";
  if (!state.inSystemAdmin) return "add-group";
  if (!state.exactSubjectArmed) return "arm-bootstrap";
  if (!state.hasAccessToken) return "await-token";
  return "probe";
}

export function assertAdminProbeSafe(state: AdminGateState): void {
  if (nextAdminStep(state) !== "probe") {
    throw new Error("Refusing authenticated administrator probe before confirmation, SystemAdmin membership, exact-subject arming, and token availability.");
  }
}
