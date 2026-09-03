import type { Role } from '@wren/types';
import type { OrganizationAccess } from './dashboardTypes';

export interface DepartmentVisibilityViewer {
  readonly roles: readonly Role[];
  readonly administeredDepartmentIds: readonly string[];
}

/**
 * Selects Departments that may appear in student-facing creation catalogs.
 *
 * `viewerCanDiscover` is the backend's actor-aware decision, including active
 * explicit grants. Database roles are retained as client-side administrative
 * bypasses; the UI persona (`activeRole`) must never narrow these capabilities.
 * This selector is intentionally not applied to existing-document views.
 */
export function selectStudentFacingDepartments(
  departments: readonly OrganizationAccess[],
  viewer: DepartmentVisibilityViewer,
): OrganizationAccess[] {
  const isTechnicalAdmin = viewer.roles.includes('TechnicalAdmin');
  const isDepartmentAdmin = viewer.roles.includes('DepartmentAdmin');

  return departments.filter(
    (department) =>
      department.viewerCanDiscover ||
      isTechnicalAdmin ||
      (isDepartmentAdmin && viewer.administeredDepartmentIds.includes(department.id)),
  );
}
