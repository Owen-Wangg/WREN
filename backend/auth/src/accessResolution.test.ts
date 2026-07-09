/**
 * Unit tests for access resolution and submission-permission logic
 * (REQ-DOMAIN-ACCESS-01 / Requirements 4.1, 4.2, 4.3, 4.5, 4.7, 6.8, 28.3, 28.4).
 *
 * V4 simplified model:
 *   - A Document Type has its own OPEN or LOCKED access state directly — there
 *     is no INHERIT logic and no Organization access state.
 *   - Access Grants match by documentTypeId only (flat, no scope union).
 *
 * Decision truth table:
 *   - OPEN                                → permit (no grant needed)
 *   - LOCKED + matching grant             → permit (GRANTED)
 *   - LOCKED + no / mismatched grant      → deny + offer access request
 *   - Revoked grants never yield GRANTED
 */
import type { AccessGrant, DocumentType } from '@wren/types';

import {
  hasApplicableGrant,
  isSubmissionPermitted,
  resolveAccess,
  shouldOfferAccessRequest,
  type DocumentTypeAccessInput,
} from './accessResolution';

const DOCUMENT_TYPE_ID = 'dt-law';

function documentType(
  accessState: DocumentType['accessState'],
): DocumentTypeAccessInput {
  return { id: DOCUMENT_TYPE_ID, accessState };
}

function grant(
  documentTypeId: string,
  overrides: Partial<AccessGrant> = {},
): AccessGrant {
  return {
    id: 'grant-1',
    userId: 'user-1',
    documentTypeId,
    grantedBy: 'admin-1',
    grantedAt: '2024-01-02T03:04:05.000Z',
    ...overrides,
  };
}

describe('resolveAccess — OPEN access state (Requirement 4.2)', () => {
  it('permits submission with no grant when Document Type is OPEN', () => {
    const decision = resolveAccess({
      documentType: documentType('OPEN'),
      grants: [],
    });
    expect(decision).toBe('OPEN');
    expect(isSubmissionPermitted(decision)).toBe(true);
    expect(shouldOfferAccessRequest(decision)).toBe(false);
  });

  it('permits submission even when grants exist (OPEN overrides everything)', () => {
    const decision = resolveAccess({
      documentType: documentType('OPEN'),
      grants: [grant(DOCUMENT_TYPE_ID)],
    });
    expect(decision).toBe('OPEN');
    expect(isSubmissionPermitted(decision)).toBe(true);
  });
});

describe('resolveAccess — LOCKED with a matching grant (Requirements 4.3, 4.5)', () => {
  it('permits (GRANTED) when a grant matches the Document Type id', () => {
    const decision = resolveAccess({
      documentType: documentType('LOCKED'),
      grants: [grant(DOCUMENT_TYPE_ID)],
    });
    expect(decision).toBe('GRANTED');
    expect(isSubmissionPermitted(decision)).toBe(true);
    expect(shouldOfferAccessRequest(decision)).toBe(false);
  });

  it('permits (GRANTED) when one of several grants matches', () => {
    const decision = resolveAccess({
      documentType: documentType('LOCKED'),
      grants: [
        grant('dt-other'),
        grant(DOCUMENT_TYPE_ID),
        grant('dt-decoy'),
      ],
    });
    expect(decision).toBe('GRANTED');
    expect(isSubmissionPermitted(decision)).toBe(true);
  });
});

describe('resolveAccess — LOCKED denied (Requirements 4.3, 4.6, 6.8)', () => {
  it('denies and offers the access-request flow when no grant is held', () => {
    const decision = resolveAccess({
      documentType: documentType('LOCKED'),
      grants: [],
    });
    expect(decision).toBe('DENIED');
    expect(isSubmissionPermitted(decision)).toBe(false);
    expect(shouldOfferAccessRequest(decision)).toBe(true);
  });

  it('denies when a grant targets a different Document Type', () => {
    const decision = resolveAccess({
      documentType: documentType('LOCKED'),
      grants: [grant('dt-other')],
    });
    expect(decision).toBe('DENIED');
  });

  it('denies when the only matching grant has been revoked', () => {
    const decision = resolveAccess({
      documentType: documentType('LOCKED'),
      grants: [
        grant(DOCUMENT_TYPE_ID, { revokedAt: '2024-02-01T00:00:00.000Z' }),
      ],
    });
    expect(decision).toBe('DENIED');
  });

  it('denies when ALL matching grants are revoked', () => {
    const decision = resolveAccess({
      documentType: documentType('LOCKED'),
      grants: [
        grant(DOCUMENT_TYPE_ID, { id: 'g1', revokedAt: '2024-02-01T00:00:00.000Z' }),
        grant(DOCUMENT_TYPE_ID, { id: 'g2', revokedAt: '2024-03-01T00:00:00.000Z' }),
      ],
    });
    expect(decision).toBe('DENIED');
  });
});

describe('hasApplicableGrant', () => {
  it('matches a grant by documentTypeId', () => {
    expect(
      hasApplicableGrant([grant(DOCUMENT_TYPE_ID)], documentType('LOCKED')),
    ).toBe(true);
  });

  it('does not match a grant for a different Document Type', () => {
    expect(
      hasApplicableGrant([grant('dt-other')], documentType('LOCKED')),
    ).toBe(false);
  });

  it('does not match a revoked grant', () => {
    expect(
      hasApplicableGrant(
        [grant(DOCUMENT_TYPE_ID, { revokedAt: '2024-02-01T00:00:00.000Z' })],
        documentType('LOCKED'),
      ),
    ).toBe(false);
  });

  it('returns false for an empty grants array', () => {
    expect(hasApplicableGrant([], documentType('LOCKED'))).toBe(false);
  });
});

describe('isSubmissionPermitted and shouldOfferAccessRequest', () => {
  it('OPEN permits and does not offer access request', () => {
    expect(isSubmissionPermitted('OPEN')).toBe(true);
    expect(shouldOfferAccessRequest('OPEN')).toBe(false);
  });

  it('GRANTED permits and does not offer access request', () => {
    expect(isSubmissionPermitted('GRANTED')).toBe(true);
    expect(shouldOfferAccessRequest('GRANTED')).toBe(false);
  });

  it('DENIED does not permit and offers access request', () => {
    expect(isSubmissionPermitted('DENIED')).toBe(false);
    expect(shouldOfferAccessRequest('DENIED')).toBe(true);
  });
});
