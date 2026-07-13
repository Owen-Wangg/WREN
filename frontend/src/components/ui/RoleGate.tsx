/**
 * `<RoleGate>` — the shared primitive for role-aware rendering (Requirement
 * 1.2; frontend steering §2, §11).
 *
 * Every component that touches document content or feedback must ask "does
 * this need a role check?" instead of assuming the current user is a Student
 * (steering §2, §11: "Don't hardcode role assumptions ... in shared
 * components"). `<RoleGate>` centralizes that check against the roles defined
 * in the shared domain contract (`Role` from `@wren/types`: `User`,
 * `Field Expert`, `Org Owner`, `Admin`) so no shared component branches on role
 * inline, and Student/User, Field Expert, and Org Admin/Instructor personas are
 * supported uniformly (frontend steering §2).
 *
 * Reads the current role from `RoleContext` (`src/app/RoleContext.tsx`) by
 * default, or accepts an explicit `role` override for tests/Storybook-style
 * usage. Renders nothing (not even a fallback DOM node) when the role is
 * unknown or not permitted, unless `fallback` is supplied.
 */
import type { ReactNode } from 'react';

import { useCurrentRole } from '@/app/currentRoleContext';

import type { Role } from '@wren/types';

export interface RoleGateProps {
  /** Roles permitted to see `children`. */
  readonly allow: readonly Role[];
  readonly children: ReactNode;
  /** Rendered instead of `children` when the role check fails. Defaults to nothing. */
  readonly fallback?: ReactNode;
  /** Overrides the role read from `RoleContext` (primarily for tests). */
  readonly role?: Role | null;
}

export function RoleGate({
  allow,
  children,
  fallback = null,
  role,
}: RoleGateProps) {
  const contextRole = useCurrentRole();
  const effectiveRole = role !== undefined ? role : contextRole;

  if (effectiveRole !== null && allow.includes(effectiveRole)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
