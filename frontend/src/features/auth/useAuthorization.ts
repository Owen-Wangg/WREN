/**
 * Task 2.3: Authorization enforcement hooks.
 *
 * Enforces capability matrix at frontend:
 * - DepartmentAdmin cannot view/modify DocumentTypes outside administered Departments
 * - TechnicalAdmin cannot edit DocumentType prompt content
 * - Student cannot create/modify DocumentTypes
 * - Access management only for TechnicalAdmin
 */
import { useAuth } from './AuthContext';

/**
 * Check if user can view/list document types in a specific department.
 */
export function useCanViewDocumentTypes(departmentId: string): boolean {
  const { user } = useAuth();

  if (!user) return false;
  if (user.roles.includes('TechnicalAdmin')) return true;
  if (user.roles.includes('DepartmentAdmin')) {
    return user.administeredDepartmentIds.includes(departmentId);
  }
  return false;
}

/**
 * Check if user can modify document type configuration.
 * DepartmentAdmins can modify if they administer the department.
 * TechnicalAdmins can modify, but not prompt content (REQ-ROLE-TECHADMIN-01.4).
 */
export function useCanModifyDocumentType(departmentId: string): {
  canModify: boolean;
  canEditPrompt: boolean;
} {
  const { user } = useAuth();

  if (!user) return { canModify: false, canEditPrompt: false };

  const isDeptAdmin = user.roles.includes('DepartmentAdmin') &&
    user.administeredDepartmentIds.includes(departmentId);
  const isTechAdmin = user.roles.includes('TechnicalAdmin');

  return {
    canModify: isDeptAdmin || isTechAdmin,
    canEditPrompt: isDeptAdmin, // Only DeptAdmin can edit prompt
  };
}

/**
 * Check if user can create document types.
 * Only TechnicalAdmin can create (REQ-ROLE-MATRIX-01.1).
 */
export function useCanCreateDocumentType(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return user.roles.includes('TechnicalAdmin');
}

/**
 * Check if user can manage access grants.
 * Only TechnicalAdmin can manage (access management only for system admin).
 */
export function useCanManageAccessGrants(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return user.roles.includes('TechnicalAdmin');
}

/**
 * Check if user can assign roles.
 * Only TechnicalAdmin can assign roles.
 */
export function useCanAssignRoles(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return user.roles.includes('TechnicalAdmin');
}

/**
 * Check if user can search users in a scope.
 * DepartmentAdmins can search their departments only.
 * TechnicalAdmins can search globally.
 */
export function useCanSearchUsers(departmentId?: string): boolean {
  const { user } = useAuth();

  if (!user) return false;
  if (user.roles.includes('TechnicalAdmin')) return true;
  if (departmentId && user.roles.includes('DepartmentAdmin')) {
    return user.administeredDepartmentIds.includes(departmentId);
  }
  return false;
}

/**
 * Get scoped departments for the current user.
 * DepartmentAdmins see only administered departments.
 * TechnicalAdmins see all.
 */
export function useScopedDepartments(): {
  isFiltered: boolean;
  departmentIds: string[];
} {
  const { user } = useAuth();

  if (!user) return { isFiltered: true, departmentIds: [] };

  if (user.roles.includes('TechnicalAdmin')) {
    return { isFiltered: false, departmentIds: [] };
  }

  if (user.roles.includes('DepartmentAdmin')) {
    return { isFiltered: true, departmentIds: user.administeredDepartmentIds };
  }

  return { isFiltered: true, departmentIds: [] };
}
