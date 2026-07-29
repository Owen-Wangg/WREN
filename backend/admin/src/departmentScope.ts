/**
 * Department catalog read-scoping for list/get handlers.
 *
 * TechnicalAdmin — full catalog.
 * DepartmentAdmin (without TechnicalAdmin) — only `administeredDepartmentIds`.
 * Everyone else (e.g. Student) — full catalog for writer self-select.
 *
 * Out-of-scope reads throw {@link NotFoundError} (404) so foreign departments
 * are not confirmed to exist.
 */
import type { AuthContext } from '@wren/types';

import { NotFoundError } from './errors';

export function isTechnicalAdmin(actor: AuthContext): boolean {
  return actor.roles.includes('TechnicalAdmin');
}

export function isDepartmentAdmin(actor: AuthContext): boolean {
  return actor.roles.includes('DepartmentAdmin');
}

/**
 * True when this actor's department catalog reads must be limited to
 * administered departments (DeptAdmin who is not also TechnicalAdmin).
 */
export function mustScopeDepartmentCatalog(actor: AuthContext): boolean {
  return isDepartmentAdmin(actor) && !isTechnicalAdmin(actor);
}

export function canViewDepartment(actor: AuthContext, departmentId: string): boolean {
  if (!mustScopeDepartmentCatalog(actor)) return true;
  return actor.administeredDepartmentIds.includes(departmentId);
}

/** Throw 404 when a scoped actor requests a foreign department. */
export function assertCanViewDepartment(actor: AuthContext, departmentId: string): void {
  if (!canViewDepartment(actor, departmentId)) {
    throw new NotFoundError(`Department '${departmentId}' not found`);
  }
}

export function filterDepartmentsForActor<T extends { id: string }>(
  actor: AuthContext,
  departments: readonly T[],
): T[] {
  if (!mustScopeDepartmentCatalog(actor)) return [...departments];
  const allowed = new Set(actor.administeredDepartmentIds);
  return departments.filter((d) => allowed.has(d.id));
}

export function filterDocumentTypesForActor<T extends { departmentId: string }>(
  actor: AuthContext,
  types: readonly T[],
): T[] {
  if (!mustScopeDepartmentCatalog(actor)) return [...types];
  const allowed = new Set(actor.administeredDepartmentIds);
  return types.filter((t) => allowed.has(t.departmentId));
}
