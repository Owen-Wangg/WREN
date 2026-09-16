export type AdminStep =
  | "signup"
  | "confirm"
  | "add-group"
  | "arm-bootstrap"
  | "complete";

export interface AdminGateState {
  readonly exists: boolean;
  readonly confirmed: boolean;
  readonly inSystemAdmin: boolean;
  readonly exactSubjectArmed: boolean;
}

export function nextAdminStep(state: AdminGateState): AdminStep {
  if (!state.exists) return "signup";
  if (!state.confirmed) return "confirm";
  if (!state.inSystemAdmin) return "add-group";
  if (!state.exactSubjectArmed) return "arm-bootstrap";
  return "complete";
}
