/**
 * {@link AuthContext} builders for Admin_Service unit tests. These mirror the
 * shapes the Auth_Service resolves from Postgres (roles + owned Organizations +
 * assigned Writing Types), so the capability re-checks under test run against
 * realistic actor contexts.
 */
import type { AuthContext } from '@wren/types';

const BASE: Omit<AuthContext, 'roles' | 'ownedOrganizationIds' | 'assignedWritingTypeIds'> = {
  userId: 'user-actor',
  idpSubject: 'sub-actor',
  email: 'actor@example.com',
  grants: [],
};

/** A technical `Admin` — every capability, every scope. */
export function adminContext(): AuthContext {
  return { ...BASE, roles: ['Admin'], ownedOrganizationIds: [], assignedWritingTypeIds: [] };
}

/** An `Org Owner` of the given Organizations (business management within them). */
export function orgOwnerContext(...ownedOrganizationIds: string[]): AuthContext {
  return {
    ...BASE,
    roles: ['Org Owner'],
    ownedOrganizationIds,
    assignedWritingTypeIds: [],
  };
}

/** A `Field Expert` assigned to the given Writing Types (no catalog authority). */
export function fieldExpertContext(...assignedWritingTypeIds: string[]): AuthContext {
  return {
    ...BASE,
    roles: ['Field Expert'],
    ownedOrganizationIds: [],
    assignedWritingTypeIds,
  };
}

/** A plain global `User` — no privileged capability. */
export function userContext(): AuthContext {
  return { ...BASE, roles: ['User'], ownedOrganizationIds: [], assignedWritingTypeIds: [] };
}
