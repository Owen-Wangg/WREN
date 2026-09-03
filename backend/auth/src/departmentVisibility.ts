import type { AuthContext, DepartmentVisibilityState } from '@wren/types';

export interface DepartmentVisibilityInput {
  readonly actor: AuthContext;
  readonly departmentId: string;
  readonly visibilityState: DepartmentVisibilityState;
  readonly hasActiveGrant: boolean;
  readonly archivedAt?: string | null;
}

/**
 * Resolve whether an authenticated viewer may discover a Department in student
 * catalog UI. This decision is intentionally independent from OPEN/LOCKED
 * submission access.
 */
export function canDiscoverDepartment(input: DepartmentVisibilityInput): boolean {
  if (input.archivedAt) return false;
  if (input.visibilityState === 'VISIBLE') return true;
  if (input.actor.roles.includes('TechnicalAdmin')) return true;
  if (input.actor.administeredDepartmentIds.includes(input.departmentId)) return true;
  return input.hasActiveGrant;
}
