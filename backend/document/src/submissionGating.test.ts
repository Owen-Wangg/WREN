/**
 * Unit tests for submission access-gating (REQ-DOC-SUBMIT-01 / Requirement 6.8,
 * building on REQ-DOMAIN-ACCESS-01 / Requirement 4).
 *
 * Covers the pure decision mapping ({@link decideSubmissionGate}) and the
 * resolver-backed entry point ({@link gateSubmission}) using an injected fake
 * {@link AccessResolver}: OPEN -> permitted (self-select); GRANTED -> permitted;
 * DENIED (LOCKED without a grant) -> requires-access-request, surfacing the
 * `writingTypeId` for the access-request flow.
 */
import type { AccessDecision } from '@wren/types';

import {
  decideSubmissionGate,
  gateSubmission,
  type AccessResolver,
} from './submissionGating';

/**
 * A fake {@link AccessResolver} that returns a fixed decision and records the
 * `(userId, writingTypeId)` it was asked about — enough to assert the gate
 * consults the seam without any `@wren/auth` or database wiring.
 */
class FakeAccessResolver implements AccessResolver {
  public lastArgs: { userId: string; writingTypeId: string } | undefined;

  constructor(private readonly decision: AccessDecision) {}

  async resolveAccess(userId: string, writingTypeId: string): Promise<AccessDecision> {
    this.lastArgs = { userId, writingTypeId };
    return this.decision;
  }
}

describe('decideSubmissionGate (pure mapping)', () => {
  it('permits an OPEN Writing Domain (self-select, no grant needed)', () => {
    expect(decideSubmissionGate('OPEN', 'wt-1')).toEqual({
      status: 'permitted',
      decision: 'OPEN',
    });
  });

  it('permits a GRANTED (LOCKED with an applicable Access Grant) submission', () => {
    expect(decideSubmissionGate('GRANTED', 'wt-1')).toEqual({
      status: 'permitted',
      decision: 'GRANTED',
    });
  });

  it('requires the access-request flow for a DENIED (LOCKED, no grant) decision', () => {
    expect(decideSubmissionGate('DENIED', 'wt-42')).toEqual({
      status: 'requires-access-request',
      writingTypeId: 'wt-42',
    });
  });

  it('surfaces the target writingTypeId on a denied result', () => {
    const result = decideSubmissionGate('DENIED', 'wt-legal-memo');
    expect(result.status).toBe('requires-access-request');
    if (result.status === 'requires-access-request') {
      expect(result.writingTypeId).toBe('wt-legal-memo');
    }
  });
});

describe('gateSubmission (resolver-backed)', () => {
  it('resolves via the injected resolver and permits an OPEN Writing Domain', async () => {
    const resolver = new FakeAccessResolver('OPEN');
    const result = await gateSubmission(resolver, 'user-1', 'wt-1');
    expect(result).toEqual({ status: 'permitted', decision: 'OPEN' });
    expect(resolver.lastArgs).toEqual({ userId: 'user-1', writingTypeId: 'wt-1' });
  });

  it('permits when the resolver reports GRANTED', async () => {
    const resolver = new FakeAccessResolver('GRANTED');
    const result = await gateSubmission(resolver, 'user-2', 'wt-9');
    expect(result).toEqual({ status: 'permitted', decision: 'GRANTED' });
  });

  it('requires an access request when the resolver reports DENIED', async () => {
    const resolver = new FakeAccessResolver('DENIED');
    const result = await gateSubmission(resolver, 'user-3', 'wt-locked');
    expect(result).toEqual({
      status: 'requires-access-request',
      writingTypeId: 'wt-locked',
    });
    expect(resolver.lastArgs).toEqual({ userId: 'user-3', writingTypeId: 'wt-locked' });
  });
});
