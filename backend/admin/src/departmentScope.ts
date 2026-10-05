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

/**
 * Whether the actor may read a Department's Feedback-Engine `prompt` field.
 *
 * TechnicalAdmins see every department's prompt. DepartmentAdmins see it for
 * the departments they administer (they can also edit it there, via the
 * `department.managePrompt` capability in `updateDepartmentPrompt`). Everyone
 * else, including DepartmentAdmins looking at a foreign department, gets it
 * stripped.
 */
export function canReadDepartmentPrompt(actor: AuthContext, departmentId: string): boolean {
  if (isTechnicalAdmin(actor)) return true;
  return isDepartmentAdmin(actor) && actor.administeredDepartmentIds.includes(departmentId);
}

/** Strip `prompt` from a Department DTO when the actor may not read it. */
export function redactDepartmentPrompt<T extends { id: string }>(
  actor: AuthContext,
  department: T,
): T {
  return canReadDepartmentPrompt(actor, department.id)
    ? department
    : { ...department, prompt: undefined };
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
