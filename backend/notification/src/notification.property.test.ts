/**
 * Property-based tests for the WREN Notification Service (Wave 3).
 *
 * Covers: recipient resolution, lifecycle state machine, deduplication,
 * content sanitization, and stored content resilience.
 */
import fc from 'fast-check';
import { recipientResolver } from './recipientResolver.js';
import type { RecipientResolverDeps } from './recipientResolver.js';
import { lifecycleStateMachine, isTerminalState } from './lifecycle.js';
import { buildDedupKey } from './dedup.js';
import { renderTemplate, sanitizeValue } from './templateRenderer.js';
import { validateNoLeakConstraint } from './noLeakValidation.js';
import type { NotificationEvent, NotificationState, TargetRole, DedupStrategy } from './types.js';

/* -------------------------------------------------------------------------- */
/* Shared arbitraries                                                          */
/* -------------------------------------------------------------------------- */

const arbState = fc.constantFrom<NotificationState>('unread', 'read', 'dismissed');
const arbRole = fc.constantFrom<TargetRole>('Student', 'DepartmentAdmin', 'TechnicalAdmin');
const arbUserId = fc.uuid();
const arbSlug = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0);
const arbEntityId = fc.uuid();

/* -------------------------------------------------------------------------- */
/* Property 6: Recipient resolution correctness                                */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 6: Recipient resolution correctness', () => {
  it('returns exactly the recipientUserId when provided, regardless of target roles', async () => {
    await fc.assert(
      fc.asyncProperty(arbUserId, fc.array(arbRole, { minLength: 1, maxLength: 3 }), async (userId, roles) => {
        const event: NotificationEvent = {
          typeSlug: 'test-type',
          entityId: 'entity-1',
          context: {},
          recipientUserId: userId,
          departmentId: 'dept-1',
        };
        const deps: RecipientResolverDeps = {
          query: async () => [{ user_id: 'should-not-appear' }] as any,
        };
        const result = await recipientResolver(event, roles, deps);
        expect(result).toHaveLength(1);
        expect(result[0].userId).toBe(userId);
      }),
      { numRuns: 100 },
    );
  });

  it('returns all DepartmentAdmin org owners when departmentId is provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbUserId, { minLength: 1, maxLength: 5 }),
        fc.uuid(),
        async (adminIds, deptId) => {
          const event: NotificationEvent = {
            typeSlug: 'test-type',
            entityId: 'entity-1',
            context: {},
            departmentId: deptId,
          };
          const deps: RecipientResolverDeps = {
            query: async () => adminIds.map((id) => ({ user_id: id })) as any,
          };
          const result = await recipientResolver(event, ['DepartmentAdmin'], deps);
          expect(result).toHaveLength(adminIds.length);
          for (const id of adminIds) {
            expect(result.some((r) => r.userId === id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns all TechnicalAdmin users from DB', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbUserId, { minLength: 1, maxLength: 5 }),
        async (adminIds) => {
          const event: NotificationEvent = {
            typeSlug: 'test-type',
            entityId: 'entity-1',
            context: {},
          };
          const deps: RecipientResolverDeps = {
            query: async () => adminIds.map((id) => ({ user_id: id })) as any,
          };
          const result = await recipientResolver(event, ['TechnicalAdmin'], deps);
          expect(result).toHaveLength(adminIds.length);
          for (const id of adminIds) {
            expect(result.some((r) => r.userId === id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('produces no duplicate user IDs in results', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbUserId, { minLength: 1, maxLength: 5 }),
        async (adminIds) => {
          const event: NotificationEvent = {
            typeSlug: 'test-type',
            entityId: 'entity-1',
            context: {},
            departmentId: 'dept-1',
          };
          // Return same IDs for both DepartmentAdmin and TechnicalAdmin queries
          const deps: RecipientResolverDeps = {
            query: async () => adminIds.map((id) => ({ user_id: id })) as any,
          };
          const result = await recipientResolver(event, ['DepartmentAdmin', 'TechnicalAdmin'], deps);
          const userIds = result.map((r) => r.userId);
          const uniqueIds = new Set(userIds);
          expect(userIds.length).toBe(uniqueIds.size);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns empty for Student target without recipientUserId', async () => {
    await fc.assert(
      fc.asyncProperty(arbSlug, arbEntityId, async (slug, entityId) => {
        const event: NotificationEvent = {
          typeSlug: slug,
          entityId,
          context: {},
          // No recipientUserId
        };
        const deps: RecipientResolverDeps = {
          query: async () => [],
        };
        const result = await recipientResolver(event, ['Student'], deps);
        expect(result).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 5: Lifecycle state machine validity                                */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 5: Lifecycle state machine validity', () => {
  const ALL_STATES: NotificationState[] = ['unread', 'read', 'dismissed'];
  const VALID_FORWARD: Set<string> = new Set(['unread:read', 'unread:dismissed', 'read:dismissed']);

  it('valid forward transitions succeed with alreadyInState=false', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Array.from(VALID_FORWARD)),
        (pair) => {
          const [from, to] = pair.split(':') as [NotificationState, NotificationState];
          const result = lifecycleStateMachine(from, to);
          expect(result.success).toBe(true);
          expect(result.alreadyInState).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('same-state transitions are idempotent (success with alreadyInState=true)', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        const result = lifecycleStateMachine(state, state);
        expect(result.success).toBe(true);
        expect(result.alreadyInState).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('invalid transitions return success=false', () => {
    fc.assert(
      fc.property(arbState, arbState, (from, to) => {
        if (from === to) return; // skip idempotent
        const key = `${from}:${to}`;
        if (VALID_FORWARD.has(key)) return; // skip valid transitions
        const result = lifecycleStateMachine(from, to);
        expect(result.success).toBe(false);
        expect(result.alreadyInState).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('dismissed is always terminal', () => {
    fc.assert(
      fc.property(arbState, (state) => {
        if (state === 'dismissed') {
          expect(isTerminalState(state)).toBe(true);
        } else {
          expect(isTerminalState(state)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 10: Deduplication enforcement                                      */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 10: Deduplication enforcement', () => {
  it('identical params within same time window produce the same dedup key', () => {
    fc.assert(
      fc.property(
        arbSlug,
        arbUserId,
        arbEntityId,
        fc.integer({ min: 1, max: 1440 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (slug, userId, entityId, windowMinutes, baseTime) => {
          const strategy: DedupStrategy = { enabled: true, windowMinutes };
          const windowMs = windowMinutes * 60_000;
          // Two timestamps within the same window bucket
          const t1 = baseTime * windowMs; // start of a bucket
          const t2 = t1 + Math.floor(windowMs / 2); // middle of same bucket

          const key1 = buildDedupKey(slug, userId, entityId, strategy, t1);
          const key2 = buildDedupKey(slug, userId, entityId, strategy, t2);
          expect(key1).toBe(key2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('different time windows produce different keys', () => {
    fc.assert(
      fc.property(
        arbSlug,
        arbUserId,
        arbEntityId,
        fc.integer({ min: 1, max: 1440 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (slug, userId, entityId, windowMinutes, bucketIndex) => {
          const strategy: DedupStrategy = { enabled: true, windowMinutes };
          const windowMs = windowMinutes * 60_000;
          // Two timestamps in adjacent buckets
          const t1 = bucketIndex * windowMs;
          const t2 = (bucketIndex + 1) * windowMs;

          const key1 = buildDedupKey(slug, userId, entityId, strategy, t1);
          const key2 = buildDedupKey(slug, userId, entityId, strategy, t2);
          expect(key1).not.toBe(key2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returns null when dedupStrategy.enabled=false', () => {
    fc.assert(
      fc.property(
        arbSlug,
        arbUserId,
        arbEntityId,
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (slug, userId, entityId, nowMs) => {
          const strategy: DedupStrategy = { enabled: false };
          const key = buildDedupKey(slug, userId, entityId, strategy, nowMs);
          expect(key).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('key includes type, recipient, entity, and window bucket', () => {
    fc.assert(
      fc.property(
        arbSlug,
        arbUserId,
        arbEntityId,
        fc.integer({ min: 1, max: 1440 }),
        fc.integer({ min: 1, max: 1_000_000_000_000 }),
        (slug, userId, entityId, windowMinutes, nowMs) => {
          const strategy: DedupStrategy = { enabled: true, windowMinutes };
          const key = buildDedupKey(slug, userId, entityId, strategy, nowMs);
          expect(key).not.toBeNull();
          expect(key!).toContain(slug);
          expect(key!).toContain(userId);
          expect(key!).toContain(entityId);
          // Should contain the bucket number
          const windowMs = windowMinutes * 60_000;
          const expectedBucket = Math.floor(nowMs / windowMs);
          expect(key!).toContain(String(expectedBucket));
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 15: Content sanitization                                           */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 15: Content sanitization', () => {
  const HTML_CHARS = /[<>"'&/]/;

  it('sanitizeValue escapes all HTML special characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => HTML_CHARS.test(s)),
        (input) => {
          const result = sanitizeValue(input);
          expect(result).not.toMatch(/[<>"'/&](?!amp;|lt;|gt;|quot;|#39;|#x2F;)/);
          // More strict: none of the raw chars should appear
          expect(result.includes('<')).toBe(false);
          expect(result.includes('>')).toBe(false);
          expect(result.includes('"')).toBe(false);
          expect(result.includes("'")).toBe(false);
          expect(result.includes('/')).toBe(false);
          // & can appear as part of entity encoding, but raw & followed by non-entity should not
          // Actually we just check the raw chars are gone except & which is used in entities
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renderTemplate with script tags in context produces no raw < or > in interpolated output', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z]\w*$/.test(s)),
        fc.string({ minLength: 1, maxLength: 100 }),
        (placeholderName, payload) => {
          const xssPayload = `<script>${payload}</script>`;
          const template = `Hello {{${placeholderName}}}!`;
          const context = { [placeholderName]: xssPayload };
          const result = renderTemplate(template, context);
          // The interpolated portion should have no raw < or >
          // Remove the static parts to inspect the interpolated portion
          const interpolated = result.content.replace('Hello ', '').replace('!', '');
          expect(interpolated.includes('<')).toBe(false);
          expect(interpolated.includes('>')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('XSS payloads are fully escaped in rendered output', () => {
    const xssPayloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '"><script>alert(document.cookie)</script>',
      "javascript:alert('xss')",
      '<svg/onload=alert(1)>',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...xssPayloads),
        fc.string({ minLength: 1, maxLength: 15 }).filter((s) => /^[a-zA-Z]\w*$/.test(s)),
        (payload, name) => {
          const template = `Notification: {{${name}}}`;
          const context = { [name]: payload };
          const result = renderTemplate(template, context);
          expect(result.content.includes('<')).toBe(false);
          expect(result.content.includes('>')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 14: Stored content resilience                                      */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 14: Stored content resilience', () => {
  it('renderTemplate never throws regardless of input', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^\w+$/.test(s)), fc.string()),
        (template, context) => {
          expect(() => renderTemplate(template, context)).not.toThrow();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('missing placeholders appear as {{name}} in output (graceful degradation)', () => {
    // Avoid names that collide with Object.prototype properties (valueOf, toString, etc.)
    const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));
    const safeName = fc
      .string({ minLength: 1, maxLength: 15 })
      .filter((s) => /^[a-zA-Z]\w*$/.test(s) && !PROTO_KEYS.has(s));

    fc.assert(
      fc.property(
        fc.array(safeName, { minLength: 1, maxLength: 5 }),
        (placeholderNames) => {
          const unique = [...new Set(placeholderNames)];
          if (unique.length === 0) return;
          const template = unique.map((n) => `{{${n}}}`).join(' ');
          // Provide empty context — all placeholders should remain
          const result = renderTemplate(template, {});
          for (const name of unique) {
            expect(result.content).toContain(`{{${name}}}`);
            expect(result.missingPlaceholders).toContain(name);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('returned content is always a string', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^\w+$/.test(s)), fc.string()),
        (template, context) => {
          const result = renderTemplate(template, context);
          expect(typeof result.content).toBe('string');
        },
      ),
      { numRuns: 100 },
    );
  });
});
