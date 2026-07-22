/**
 * Shared profile control: switch among personas the account is actually
 * assigned in the database. Students with only Student see no switcher;
 * Department / System admins only see roles they hold.
 */
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/features/auth/AuthContext';

import type { Role } from '@wren/types';

const ROLE_OPTIONS: ReadonlyArray<{ value: Role; label: string; homePath: string }> = [
  { value: 'Student', label: 'Student', homePath: '/dashboard' },
  { value: 'DepartmentAdmin', label: 'Department Admin', homePath: '/dept-admin' },
  { value: 'TechnicalAdmin', label: 'System Admin', homePath: '/system-admin' },
];

export function ProfileRoleSwitcher() {
  const navigate = useNavigate();
  const { activeRole, setActiveRole, dbRoles } = useAuth();

  const availableOptions = ROLE_OPTIONS.filter((option) => dbRoles.includes(option.value));

  // Nothing to switch — only one (or zero) assigned roles.
  if (availableOptions.length <= 1) {
    return null;
  }

  const handleChange = (next: Role) => {
    if (!dbRoles.includes(next)) return;
    setActiveRole(next);
    const home = ROLE_OPTIONS.find((o) => o.value === next)?.homePath ?? '/dashboard';
    navigate(home, { replace: true });
  };

  const selectValue = availableOptions.some((o) => o.value === activeRole)
    ? activeRole
    : availableOptions[0]!.value;

  return (
    <div className="flex flex-col gap-sm">
      <label
        htmlFor="profile-role-select"
        className="text-body font-sans font-semibold text-text-primary"
      >
        View as role
      </label>
      <select
        id="profile-role-select"
        value={selectValue}
        onChange={(e) => handleChange(e.target.value as Role)}
        className="max-w-md rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary"
      >
        {availableOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-bodySmall text-text-muted">
        Only roles assigned to your account are listed.
      </p>
    </div>
  );
}
