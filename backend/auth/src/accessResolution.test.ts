/**
 * Unit tests for access resolution and submission-permission logic
 * (REQ-DOMAIN-ACCESS-01 / Requirements 4.1, 4.2, 4.3, 4.5, 4.7, 6.8, 28.3, 28.4).
 *
 * These cover the full decision truth table:
 *   - OPEN                          → permit (no grant needed)
 *   - LOCKED + writing-type grant    → permit (GRANTED)
 *   - LOCKED + org-scoped grant      → permit (GRANTED)
 *   - LOCKED + no / mismatched grant → deny + offer access request
 *   - INHERIT resolves to the Organization state (OPEN and LOCKED)
 *   - an explicit Writing-Type state overrides the Organization default
 */
import type { AccessGrant, WritingType } from '@wren/types';

import {
  hasApplicableGrant,
  isSubmissionPermitted,
  resolveAccess,
  resolveEffectiveAccessState,
  shouldOfferAccessRequest,
  type WritingTypeAccessInput,
} from './accessResolution';

const WRITING_TYPE_ID = 'wt-law';
const ORG_ID = 'org-allard';

function writingType(
  accessState: WritingType['accessState'],
): WritingTypeAccessInput {
  return { id: WRITING_TYPE_ID, organizationId: ORG_ID, accessState };
}

function grant(
  scope: AccessGrant['scope'],
  overrides: Partial<AccessGrant> = {},
): AccessGrant {
  return {
    id: 'grant-1',
    userId: 'user-1',
    scope,
    grantedBy: 'admin-1',
    grantedAt: '2024-01-02T03:04:05.000Z',
    ...overrides,
  };
}

describe('resolveEffectiveAccessState (Requirement 4.1 / 28.4)', () => {
  it('uses an explicit OPEN state regardless of the organization default', () => {
    expect(resolveEffectiveAccessState('OPEN', 'LOCKED')).toBe('OPEN');
  });

  it('uses an explicit LOCKED state regardless of the organization default', () => {
    expect(resolveEffectiveAccessState('LOCKED', 'OPEN')).toBe('LOCKED');
  });

  it('inherits an OPEN organization state when the writing type is INHERIT', () => {
    expect(resolveEffectiveAccessState('INHERIT', 'OPEN')).toBe('OPEN');
  });

  it('inherits a LOCKED organization state when the writing type is INHERIT', () => {
    expect(resolveEffectiveAccessState('INHERIT', 'LOCKED')).toBe('LOCKED');
  });
});

describe('resolveAccess — OPEN effective access (Requirement 4.2)', () => {
  it('permits submission with no grant when explicitly OPEN', () => {
    const decision = resolveAccess({
      writingType: writingType('OPEN'),
      organizationAccessState: 'LOCKED',
      grants: [],
    });
    expect(decision).toBe('OPEN');
    expect(isSubmissionPermitted(decision)).toBe(true);
    expect(shouldOfferAccessRequest(decision)).toBe(false);
  });

  it('permits submission when INHERIT resolves to an OPEN organization', () => {
    const decision = resolveAccess({
      writingType: writingType('INHERIT'),
      organizationAccessState: 'OPEN',
      grants: [],
    });
    expect(decision).toBe('OPEN');
    expect(isSubmissionPermitted(decision)).toBe(true);
  });
});

describe('resolveAccess — LOCKED effective access with a grant (Requirements 4.3, 4.5)', () => {
  it('permits (GRANTED) when a writing-type-scoped grant matches', () => {
    const decision = resolveAccess({
      writingType: writingType('LOCKED'),
      organizationAccessState: 'OPEN',
      grants: [grant({ writingTypeId: WRITING_TYPE_ID })],
    });
    expect(decision).toBe('GRANTED');
    expect(isSubmissionPermitted(decision)).toBe(true);
    expect(shouldOfferAccessRequest(decision)).toBe(false);
  });

  it('permits (GRANTED) when an organization-scoped grant matches', () => {
    const decision = resolveAccess({
      writingType: writingType('LOCKED'),
      organizationAccessState: 'OPEN',
      grants: [grant({ organizationId: ORG_ID })],
    });
    expect(decision).toBe('GRANTED');
    expect(isSubmissionPermitted(decision)).toBe(true);
  });

  it('permits (GRANTED) when INHERIT resolves LOCKED and an org grant matches', () => {
    const decision = resolveAccess({
      writingType: writingType('INHERIT'),
      organizationAccessState: 'LOCKED',
      grants: [grant({ organizationId: ORG_ID })],
    });
    expect(decision).toBe('GRANTED');
  });
});

describe('resolveAccess — LOCKED effective access denied (Requirements 4.3, 4.6, 6.8)', () => {
  it('denies and offers the access-request flow when no grant is held', () => {
    const decision = resolveAccess({
      writingType: writingType('LOCKED'),
      organizationAccessState: 'OPEN',
      grants: [],
    });
    expect(decision).toBe('DENIED');
    expect(isSubmissionPermitted(decision)).toBe(false);
    expect(shouldOfferAccessRequest(decision)).toBe(true);
  });

  it('denies when a grant targets a different writing type', () => {
    const decision = resolveAccess({
      writingType: writingType('LOCKED'),
      organizationAccessState: 'LOCKED',
      grants: [grant({ writingTypeId: 'wt-other' })],
    });
    expect(decision).toBe('DENIED');
  });

  it('denies when a grant targets a different organization', () => {
    const decision = resolveAccess({
      writingType: writingType('LOCKED'),
      organizationAccessState: 'LOCKED',
      grants: [grant({ organizationId: 'org-other' })],
    });
    expect(decision).toBe('DENIED');
  });

  it('denies when the only matching grant has been revoked', () => {
    const decision = resolveAccess({
      writingType: writingType('LOCKED'),
      organizationAccessState: 'OPEN',
      grants: [
        grant(
          { writingTypeId: WRITING_TYPE_ID },
          { revokedAt: '2024-02-01T00:00:00.000Z' },
        ),
      ],
    });
    expect(decision).toBe('DENIED');
  });
});

describe('resolveAccess — explicit writing-type state overrides the org default (Requirement 4.1)', () => {
  it('an explicit LOCKED type denies even when its organization is OPEN', () => {
    const decision = resolveAccess({
      writingType: writingType('LOCKED'),
      organizationAccessState: 'OPEN',
      grants: [],
    });
    expect(decision).toBe('DENIED');
  });

  it('an explicit OPEN type permits even when its organization is LOCKED', () => {
    const decision = resolveAccess({
      writingType: writingType('OPEN'),
      organizationAccessState: 'LOCKED',
      grants: [],
    });
    expect(decision).toBe('OPEN');
  });
});

describe('hasApplicableGrant', () => {
  it('matches a writing-type-scoped grant', () => {
    expect(
      hasApplicableGrant([grant({ writingTypeId: WRITING_TYPE_ID })], writingType('LOCKED')),
    ).toBe(true);
  });

  it('matches an organization-scoped grant', () => {
    expect(
      hasApplicableGrant([grant({ organizationId: ORG_ID })], writingType('LOCKED')),
    ).toBe(true);
  });

  it('does not match unrelated or revoked grants', () => {
    expect(hasApplicableGrant([], writingType('LOCKED'))).toBe(false);
    expect(
      hasApplicableGrant([grant({ writingTypeId: 'wt-other' })], writingType('LOCKED')),
    ).toBe(false);
    expect(
      hasApplicableGrant(
        [grant({ organizationId: ORG_ID }, { revokedAt: '2024-02-01T00:00:00.000Z' })],
        writingType('LOCKED'),
      ),
    ).toBe(false);
  });
});
