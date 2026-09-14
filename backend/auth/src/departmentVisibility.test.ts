import type { AuthContext, DepartmentVisibilityState } from '@wren/types';

import { canDiscoverDepartment } from './departmentVisibility';

const DEPARTMENT_ID = 'dept-1';

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    idpSubject: 'sub-1',
    email: 'user@example.com',
    roles: ['Student'],
    administeredDepartmentIds: [],
    grants: [],
    ...overrides,
  };
}

function discoverable(
  visibilityState: DepartmentVisibilityState,
  overrides: Partial<Parameters<typeof canDiscoverDepartment>[0]> = {},
): boolean {
  return canDiscoverDepartment({
    actor: actor(),
    departmentId: DEPARTMENT_ID,
    visibilityState,
    hasActiveGrant: false,
    archivedAt: null,
    ...overrides,
  });
}

describe('canDiscoverDepartment', () => {
  it('allows every authenticated viewer to discover a visible Department', () => {
    expect(discoverable('VISIBLE')).toBe(true);
  });

  it('hides a permitted-only Department from an ordinary unpermitted viewer', () => {
    expect(discoverable('PERMITTED_ONLY')).toBe(false);
  });

  it('allows an active explicit visibility grant', () => {
    expect(discoverable('PERMITTED_ONLY', { hasActiveGrant: true })).toBe(true);
  });

  it('allows TechnicalAdmin regardless of active student persona concerns', () => {
    expect(
      discoverable('PERMITTED_ONLY', {
        actor: actor({ roles: ['Student', 'TechnicalAdmin'] }),
      }),
    ).toBe(true);
  });

  it('allows a DepartmentAdmin only for an appointed Department', () => {
    const departmentAdmin = actor({
      roles: ['DepartmentAdmin'],
      administeredDepartmentIds: [DEPARTMENT_ID],
    });
    expect(discoverable('PERMITTED_ONLY', { actor: departmentAdmin })).toBe(true);
    expect(
      discoverable('PERMITTED_ONLY', {
        actor: departmentAdmin,
        departmentId: 'dept-other',
      }),
    ).toBe(false);
  });

  it('excludes archived Departments for every viewer and grant state', () => {
    expect(
      discoverable('VISIBLE', {
        actor: actor({ roles: ['TechnicalAdmin'] }),
        hasActiveGrant: true,
        archivedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});
