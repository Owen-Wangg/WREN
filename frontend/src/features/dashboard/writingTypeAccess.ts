/**
 * Effective-access resolution for the writer dashboard (task 19.1;
 * Requirements 4.2, 4.6, 6.8, 28.2).
 *
 * Effective submission control lives at the Writing Type level, with the
 * Organization providing a default the Writing Type inherits unless it sets its
 * own state (a Writing Type's explicit `OPEN`/`LOCKED` wins over the org
 * default — Requirement 4.1). From the writer's perspective this collapses to
 * three states:
 *
 *  - `open`    — effective access is OPEN; any global User may self-select and
 *                start a document here without a grant (Requirement 4.2).
 *  - `granted` — effective access is LOCKED, but the writer holds an applicable,
 *                non-revoked Access Grant, so they may still self-select
 *                (Requirement 6.8 / 28.2 — grant authorizes submission).
 *  - `locked`  — effective access is LOCKED and no grant applies; the writer is
 *                offered an access-request flow rather than being silently
 *                blocked (Requirement 4.6).
 *
 * This module is pure (no I/O, no React) so the branching is unit-testable in
 * isolation from the query/render layers.
 */
import type { AccessGrant, AccessState, WritingType } from '@wren/types';

import type { OrganizationAccess } from './dashboardTypes';

/** Writer-facing access status for a Writing Type. */
export type WritingTypeAccessStatus = 'open' | 'granted' | 'locked';

export interface ResolvedWritingType {
  readonly writingType: WritingType;
  /** The effective OPEN/LOCKED state after resolving `INHERIT` against the org. */
  readonly effectiveAccessState: AccessState;
  readonly status: WritingTypeAccessStatus;
  /** True when the writer may self-select and start a document here. */
  readonly selectable: boolean;
}

/**
 * Resolves a Writing Type's effective OPEN/LOCKED state. An explicit state on
 * the Writing Type wins; `INHERIT` falls back to the owning Organization. When
 * the organization is unknown we fail safe to `LOCKED` — never silently OPEN a
 * type we cannot resolve (Requirement 4.1 default-inheritance semantics).
 */
export function resolveEffectiveAccessState(
  writingType: WritingType,
  organizationsById: ReadonlyMap<string, OrganizationAccess>,
): AccessState {
  if (writingType.accessState !== 'INHERIT') {
    return writingType.accessState;
  }
  return organizationsById.get(writingType.organizationId)?.accessState ?? 'LOCKED';
}

/** True iff `grant` is applicable to `writingType` and has not been revoked. */
function grantAppliesTo(grant: AccessGrant, writingType: WritingType): boolean {
  if (grant.revokedAt !== undefined) {
    return false;
  }
  if ('writingTypeId' in grant.scope) {
    return grant.scope.writingTypeId === writingType.id;
  }
  return grant.scope.organizationId === writingType.organizationId;
}

/** Resolves the writer-facing access status for a single Writing Type. */
export function resolveWritingTypeAccess(
  writingType: WritingType,
  organizationsById: ReadonlyMap<string, OrganizationAccess>,
  grants: readonly AccessGrant[],
): ResolvedWritingType {
  const effectiveAccessState = resolveEffectiveAccessState(
    writingType,
    organizationsById,
  );

  let status: WritingTypeAccessStatus;
  if (effectiveAccessState === 'OPEN') {
    status = 'open';
  } else if (grants.some((grant) => grantAppliesTo(grant, writingType))) {
    status = 'granted';
  } else {
    status = 'locked';
  }

  return {
    writingType,
    effectiveAccessState,
    status,
    selectable: status !== 'locked',
  };
}

/** Convenience: resolve a whole catalog of Writing Types. */
export function resolveWritingTypeCatalog(
  writingTypes: readonly WritingType[],
  organizations: readonly OrganizationAccess[],
  grants: readonly AccessGrant[],
): ResolvedWritingType[] {
  const organizationsById = new Map(organizations.map((org) => [org.id, org]));
  return writingTypes.map((writingType) =>
    resolveWritingTypeAccess(writingType, organizationsById, grants),
  );
}
