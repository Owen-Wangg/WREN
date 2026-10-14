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
  const { user, refreshUser } = useAuth();
  const userId = user?.userId ?? '';
  const administeredIdsKey = (user?.administeredDepartmentIds ?? []).join(',');

  // The signed-in identity is fetched once at login; Department Admin
  // appointments made since then would otherwise be invisible here until a
  // full reload. Re-sync on entering the Department Admin area.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  const { data: allDepartments = [], isLoading } = useQuery({
    queryKey: ['dept-admin-departments'],
    queryFn: () => listDepartments(),
    // Departments created or re-scoped elsewhere (System Admin) must show up
    // as soon as the Department Admin area is opened.
    refetchOnMount: 'always',
  });

  // The Department Admin area only ever shows departments the user is
  // appointed to as DepartmentAdmin. `/v1/departments` returns the full
  // catalog (Students need it to self-select), so this filter is what keeps
  // foreign departments out of this area. TechnicalAdmins are not exempt:
  // platform-wide department management lives in the System Admin area.
  // No appointments means no departments, never "fall back to everything".
  const departments = useMemo(() => {
    const allowed = new Set(administeredIdsKey ? administeredIdsKey.split(',') : []);
    return allDepartments.filter((d) => allowed.has(d.id));
  }, [allDepartments, administeredIdsKey]);

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
