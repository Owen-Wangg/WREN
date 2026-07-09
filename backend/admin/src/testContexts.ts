/**
 * {@link AuthContext} builders for Admin_Service unit tests. These mirror the
 * shapes the Auth_Service resolves from Postgres (roles + administered
 * Departments), so the capability re-checks under test run against realistic
 * actor contexts.
 */
import type { AuthContext } from '@wren/types';

const BASE: Omit<AuthContext, 'roles' | 'administeredDepartmentIds'> = {
  userId: 'user-actor',
  idpSubject: 'sub-actor',
  email: 'actor@example.com',
  grants: [],
};

/** A `Student` — no privileged capability. */
export function studentContext(): AuthContext {
  return { ...BASE, roles: ['Student'], administeredDepartmentIds: [] };
}

/** A `DepartmentAdmin` who administers the given Departments. */
export function deptAdminContext(departmentIds: string[]): AuthContext {
  return {
    ...BASE,
    roles: ['DepartmentAdmin'],
    administeredDepartmentIds: departmentIds,
  };
}

/** A `TechnicalAdmin` — system-wide technical operations. */
export function techAdminContext(): AuthContext {
  return { ...BASE, roles: ['TechnicalAdmin'], administeredDepartmentIds: [] };
}
