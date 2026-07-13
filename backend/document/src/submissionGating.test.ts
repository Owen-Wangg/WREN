/**
 * Unit tests for submission access-gating (REQ-DOC-SUBMIT-01 / Requirement 6.8,
 * building on REQ-DOMAIN-ACCESS-01 / Requirement 4).
 *
 * Covers the pure decision mapping ({@link decideSubmissionGate}) and the
 * resolver-backed entry point ({@link gateSubmission}) using an injected fake
 * {@link AccessResolver}: OPEN -> permitted (self-select); GRANTED -> permitted;
 * DENIED (LOCKED without a grant) -> requires-access-request, surfacing the
 * `documentTypeId` for the access-request flow.
 *
 * V4 simplification: no INHERIT state, no Organization-level resolution. Each
 * Document Type is directly OPEN or LOCKED. AccessGrant has a flat
 * `documentTypeId` field.
 */
import type { AccessDecision } from '@wren/types';

import {
  decideSubmissionGate,
  gateSubmission,
  type AccessResolver,
} from './submissionGating';

/**
 * A fake {@link AccessResolver} that returns a fixed decision and records the
 * `(userId, documentTypeId)` it was asked about — enough to assert the gate
 * consults the seam without any `@wren/auth` or database wiring.
 */
class FakeAccessResolver implements AccessResolver {
  public lastArgs: { userId: string; documentTypeId: string } | undefined;

  constructor(private readonly decision: AccessDecision) {}

  async resolveAccess(userId: string, documentTypeId: string): Promise<AccessDecision> {
    this.lastArgs = { userId, documentTypeId };
    return this.decision;
  }
}

describe('decideSubmissionGate (pure mapping)', () => {
  it('permits an OPEN Document Type (self-select, no grant needed)', () => {
    expect(decideSubmissionGate('OPEN', 'dt-1')).toEqual({
      status: 'permitted',
      decision: 'OPEN',
    });
  });

  it('permits a GRANTED (LOCKED with an applicable Access Grant) submission', () => {
    expect(decideSubmissionGate('GRANTED', 'dt-1')).toEqual({
      status: 'permitted',
      decision: 'GRANTED',
    });
  });

  it('requires the access-request flow for a DENIED (LOCKED, no grant) decision', () => {
    expect(decideSubmissionGate('DENIED', 'dt-42')).toEqual({
      status: 'requires-access-request',
      documentTypeId: 'dt-42',
    });
  });

  it('surfaces the target documentTypeId on a denied result', () => {
    const result = decideSubmissionGate('DENIED', 'dt-legal-memo');
    expect(result.status).toBe('requires-access-request');
    if (result.status === 'requires-access-request') {
      expect(result.documentTypeId).toBe('dt-legal-memo');
    }
  });
});

describe('gateSubmission (resolver-backed)', () => {
  it('resolves via the injected resolver and permits an OPEN Document Type', async () => {
    const resolver = new FakeAccessResolver('OPEN');
    const result = await gateSubmission(resolver, 'user-1', 'dt-1');
    expect(result).toEqual({ status: 'permitted', decision: 'OPEN' });
    expect(resolver.lastArgs).toEqual({ userId: 'user-1', documentTypeId: 'dt-1' });
  });

  it('permits when the resolver reports GRANTED', async () => {
    const resolver = new FakeAccessResolver('GRANTED');
    const result = await gateSubmission(resolver, 'user-2', 'dt-9');
    expect(result).toEqual({ status: 'permitted', decision: 'GRANTED' });
  });

  it('requires an access request when the resolver reports DENIED', async () => {
    const resolver = new FakeAccessResolver('DENIED');
    const result = await gateSubmission(resolver, 'user-3', 'dt-locked');
    expect(result).toEqual({
      status: 'requires-access-request',
      documentTypeId: 'dt-locked',
    });
    expect(resolver.lastArgs).toEqual({ userId: 'user-3', documentTypeId: 'dt-locked' });
  });
});
