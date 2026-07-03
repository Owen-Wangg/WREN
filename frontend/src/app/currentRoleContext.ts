/**
 * The React context backing current-user role state, plus the `useCurrentRole`
 * hook. Split from `RoleProvider` (`RoleContext.tsx`) so this module has no
 * component export — see `RoleContext.tsx` for the full rationale.
 */
import { createContext, useContext } from 'react';

import type { Role } from '@wren/types';

export const currentRoleContext = createContext<Role | null>(null);

/** The current user's role, or `null` if unauthenticated/unknown. */
export function useCurrentRole(): Role | null {
  return useContext(currentRoleContext);
}
