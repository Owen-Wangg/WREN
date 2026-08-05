/**
 * Active department focus for Department Admin surfaces.
 *
 * Allowed departments come from the (already API-scoped) catalog. Selection is
 * persisted in sessionStorage per user so multi-dept admins keep their focus
 * across navigations within the tab.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';

import { useAuth } from '@/features/auth/AuthContext';
import {
  listDepartments,
  type Department,
} from '@/features/department-admin/departmentAdminApi';

const STORAGE_PREFIX = 'wren-active-department:';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function readStoredDepartmentId(userId: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

function writeStoredDepartmentId(userId: string, departmentId: string): void {
  try {
    sessionStorage.setItem(storageKey(userId), departmentId);
  } catch {
    // ignore quota / private mode
  }
}

export interface ActiveDepartmentContextValue {
  readonly departments: Department[];
  readonly activeDepartment: Department | null;
  readonly activeDepartmentId: string | null;
  readonly setActiveDepartmentId: (departmentId: string) => void;
  readonly isLoading: boolean;
}

const ActiveDepartmentContext = createContext<ActiveDepartmentContextValue | null>(null);

export function ActiveDepartmentProvider({ children }: { readonly children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.userId ?? '';
  const isTechnicalAdmin = user?.roles.includes('TechnicalAdmin') ?? false;
  const administeredIds = user?.administeredDepartmentIds ?? [];

  const { data: allDepartments = [], isLoading } = useQuery({
    queryKey: ['dept-admin-departments'],
    queryFn: () => listDepartments(),
  });

  // Defensive client filter — API already scopes DeptAdmins; TechAdmin sees all.
  const departments = useMemo(() => {
    if (isTechnicalAdmin) return allDepartments;
    if (administeredIds.length === 0) return allDepartments;
    return allDepartments.filter((d) => administeredIds.includes(d.id));
  }, [allDepartments, administeredIds, isTechnicalAdmin]);

  const [activeDepartmentId, setActiveIdState] = useState<string | null>(null);

  useEffect(() => {
    if (departments.length === 0) {
      setActiveIdState(null);
      return;
    }
    const stored = userId ? readStoredDepartmentId(userId) : null;
    const allowed = new Set(departments.map((d) => d.id));
    const next =
      (stored && allowed.has(stored) ? stored : null) ??
      (activeDepartmentId && allowed.has(activeDepartmentId) ? activeDepartmentId : null) ??
      departments[0]!.id;
    setActiveIdState((prev) => (prev === next ? prev : next));
  }, [departments, userId, activeDepartmentId]);

  const setActiveDepartmentId = useCallback(
    (departmentId: string) => {
      const allowed = departments.some((d) => d.id === departmentId);
      if (!allowed) return;
      setActiveIdState(departmentId);
      if (userId) writeStoredDepartmentId(userId, departmentId);
    },
    [departments, userId],
  );

  const activeDepartment =
    departments.find((d) => d.id === activeDepartmentId) ?? departments[0] ?? null;

  const value = useMemo<ActiveDepartmentContextValue>(
    () => ({
      departments,
      activeDepartment,
      activeDepartmentId: activeDepartment?.id ?? null,
      setActiveDepartmentId,
      isLoading,
    }),
    [departments, activeDepartment, setActiveDepartmentId, isLoading],
  );

  return (
    <ActiveDepartmentContext.Provider value={value}>{children}</ActiveDepartmentContext.Provider>
  );
}

/** Route wrapper: provides active department to all `/dept-admin` child routes. */
export function DepartmentAdminProviders() {
  return (
    <ActiveDepartmentProvider>
      <Outlet />
    </ActiveDepartmentProvider>
  );
}

export function useActiveDepartment(): ActiveDepartmentContextValue {
  const ctx = useContext(ActiveDepartmentContext);
  if (!ctx) {
    throw new Error('useActiveDepartment must be used within ActiveDepartmentProvider');
  }
  return ctx;
}
