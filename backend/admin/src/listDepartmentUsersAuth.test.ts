/**
 * Authorization for GET /v1/departments/{departmentId}/users.
 * Students must not enumerate names/emails; DeptAdmins are scoped to
 * administered departments; TechnicalAdmins may list any department.
 */
import { AuthorizationError } from './errors';
import { assertCanListDepartmentUsers } from './capabilityGuard';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPT = 'dept-1';
const FOREIGN_DEPT = 'dept-other';

describe('assertCanListDepartmentUsers', () => {
  it('allows a TechnicalAdmin to list users in any department', () => {
    expect(() => assertCanListDepartmentUsers(techAdminContext(), DEPT)).not.toThrow();
    expect(() => assertCanListDepartmentUsers(techAdminContext(), FOREIGN_DEPT)).not.toThrow();
  });

  it('allows a DepartmentAdmin to list users in an administered department', () => {
    expect(() =>
      assertCanListDepartmentUsers(deptAdminContext([DEPT]), DEPT),
    ).not.toThrow();
  });

  it('denies a DepartmentAdmin listing users in a foreign department', () => {
    expect(() =>
      assertCanListDepartmentUsers(deptAdminContext([DEPT]), FOREIGN_DEPT),
    ).toThrow(AuthorizationError);
  });

  it('denies a Student', () => {
    expect(() => assertCanListDepartmentUsers(studentContext(), DEPT)).toThrow(
      AuthorizationError,
    );
  });
});
