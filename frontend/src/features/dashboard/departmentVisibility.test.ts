import { describe, expect, it } from 'vitest';
import type { OrganizationAccess } from './dashboardTypes';
import { selectStudentFacingDepartments } from './departmentVisibility';

const visible: OrganizationAccess = {
  id: 'visible-department',
  name: 'Visible Department',
  accessState: 'OPEN',
  viewerCanDiscover: true,
};
const hiddenAdministered: OrganizationAccess = {
  id: 'administered-department',
  name: 'Administered Department',
  accessState: 'LOCKED',
  viewerCanDiscover: false,
};
const hiddenOther: OrganizationAccess = {
  id: 'other-department',
  name: 'Other Department',
  accessState: 'OPEN',
  viewerCanDiscover: false,
};

describe('selectStudentFacingDepartments', () => {
  it('shows a student only backend-approved departments, including grant decisions', () => {
    expect(
      selectStudentFacingDepartments([visible, hiddenOther], {
        roles: ['Student'],
        administeredDepartmentIds: [],
      }),
    ).toEqual([visible]);
  });

  it('uses the TechnicalAdmin database-role bypass for every department', () => {
    expect(
      selectStudentFacingDepartments([hiddenAdministered, hiddenOther], {
        roles: ['TechnicalAdmin', 'Student'],
        administeredDepartmentIds: [],
      }),
    ).toEqual([hiddenAdministered, hiddenOther]);
  });

  it('bypasses only the DepartmentAdmin appointed department', () => {
    expect(
      selectStudentFacingDepartments([visible, hiddenAdministered, hiddenOther], {
        roles: ['DepartmentAdmin', 'Student'],
        administeredDepartmentIds: [hiddenAdministered.id],
      }),
    ).toEqual([visible, hiddenAdministered]);
  });

  it('preserves input order and does not mutate the source array', () => {
    const source = [hiddenOther, visible, hiddenAdministered];
    const snapshot = [...source];

    expect(
      selectStudentFacingDepartments(source, {
        roles: ['Student'],
        administeredDepartmentIds: [],
      }),
    ).toEqual([visible]);
    expect(source).toEqual(snapshot);
  });
});
