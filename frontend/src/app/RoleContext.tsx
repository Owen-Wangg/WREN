/**
 * Current-user role context.
 *
 * Shared components must never hardcode "the current user is a Student"
 * (frontend steering §2, §11). This context is the single place role state
 * flows through the app; `<RoleGate>` (`src/components/ui/RoleGate.tsx`) reads
 * it so any component touching document content/feedback can ask "does this
 * need a role check?" without prop-drilling role through every layer.
 *
 * `null` means "unknown / not yet authenticated" — the concrete provider value
 * is wired from the Cognito session in the auth task (17.3); until then
 * features can wrap subtrees in `<RoleProvider role={...}>` directly (e.g. in
 * tests, or a mocked dashboard).
 */
import type { ReactNode } from 'react';

import { currentRoleContext } from './currentRoleContext';

import type { Role } from '@wren/types';

export interface RoleProviderProps {
  readonly role: Role | null;
  readonly children: ReactNode;
}

export function RoleProvider({ role, children }: RoleProviderProps) {
  return (
    <currentRoleContext.Provider value={role}>
      {children}
    </currentRoleContext.Provider>
  );
}
