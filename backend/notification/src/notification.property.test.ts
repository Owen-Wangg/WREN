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
import type { NotificationEvent, NotificationState, TargetRole, DedupStrategy } from './types.js';
import { NotificationServiceImpl, type NotificationServiceDeps } from './notificationService.js';
import { validateNoLeakConstraint } from './noLeakValidation.js';

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

/* -------------------------------------------------------------------------- */
/* Shared mock helpers                                                         */
/* -------------------------------------------------------------------------- */

function createMockDeps(overrides?: Partial<NotificationServiceDeps>): NotificationServiceDeps {
  return {
    query: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue(1),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Property 7: Type catalog referential integrity                              */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 7: Type catalog referential integrity', () => {
  it('processEvent throws when typeSlug does not exist in the catalog', async () => {
    await fc.assert(
      fc.asyncProperty(arbSlug, arbEntityId, async (slug, entityId) => {
        const deps = createMockDeps({
          query: jest.fn().mockResolvedValue([]),
        });
        const service = new NotificationServiceImpl(deps);
        const event: NotificationEvent = {
          typeSlug: slug,
          entityId,
          context: {},
        };
        await expect(service.processEvent(event)).rejects.toThrow(/not found/i);
      }),
      { numRuns: 100 },
    );
  });

  it('processEvent succeeds when typeSlug exists in the catalog', async () => {
    await fc.assert(
      fc.asyncProperty(arbSlug, arbEntityId, arbUserId, async (slug, entityId, userId) => {
        const typeRow = {
          id: 'type-id-1',
          slug,
          display_template: 'Hello {{name}}',
          action_url_template: null,
          target_roles: JSON.stringify(['Student']),
          dedup_strategy: JSON.stringify({ enabled: false }),
        };
        const deps = createMockDeps({
          query: jest.fn()
            .mockResolvedValueOnce([typeRow]) // type lookup
            .mockResolvedValue([]),           // recipient resolver
          execute: jest.fn().mockResolvedValue(1),
        });
        const service = new NotificationServiceImpl(deps);
        const event: NotificationEvent = {
          typeSlug: slug,
          entityId,
          context: { name: 'Test' },
          recipientUserId: userId,
        };
        const result = await service.processEvent(event);
        expect(result.created).toBeGreaterThanOrEqual(0);
        expect(result.deduplicated).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 4: Persistent creation with unread state                           */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 4: Persistent creation with unread state', () => {
  it('processEvent always inserts notifications with state unread', async () => {
    await fc.assert(
      fc.asyncProperty(arbSlug, arbEntityId, arbUserId, async (slug, entityId, userId) => {
        const typeRow = {
          id: 'type-id-1',
          slug,
          display_template: 'Notification for {{user}}',
          action_url_template: null,
          target_roles: JSON.stringify(['Student']),
          dedup_strategy: JSON.stringify({ enabled: false }),
        };
        const executeFn = jest.fn().mockResolvedValue(1);
        const deps = createMockDeps({
          query: jest.fn()
            .mockResolvedValueOnce([typeRow])
            .mockResolvedValue([]),
          execute: executeFn,
        });
        const service = new NotificationServiceImpl(deps);
        const event: NotificationEvent = {
          typeSlug: slug,
          entityId,
          context: { user: 'test' },
          recipientUserId: userId,
        };
        await service.processEvent(event);

        // Verify the INSERT SQL contains 'unread' state
        if (executeFn.mock.calls.length > 0) {
          const sql: string = executeFn.mock.calls[0][0];
          expect(sql).toContain("'unread'");
        }
      }),
      { numRuns: 100 },
    );
  });

  it('processEvent sets created_at to NOW() in the INSERT SQL', async () => {
    await fc.assert(
      fc.asyncProperty(arbSlug, arbEntityId, arbUserId, async (slug, entityId, userId) => {
        const typeRow = {
          id: 'type-id-1',
          slug,
          display_template: 'Test {{item}}',
          action_url_template: null,
          target_roles: JSON.stringify(['Student']),
          dedup_strategy: JSON.stringify({ enabled: false }),
        };
        const executeFn = jest.fn().mockResolvedValue(1);
        const deps = createMockDeps({
          query: jest.fn()
            .mockResolvedValueOnce([typeRow])
            .mockResolvedValue([]),
          execute: executeFn,
        });
        const service = new NotificationServiceImpl(deps);
        const event: NotificationEvent = {
          typeSlug: slug,
          entityId,
          context: { item: 'val' },
          recipientUserId: userId,
        };
        await service.processEvent(event);

        if (executeFn.mock.calls.length > 0) {
          const sql: string = executeFn.mock.calls[0][0];
          expect(sql).toContain('NOW()');
        }
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 1: In-app-only delivery invariant                                  */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 1: In-app-only delivery invariant', () => {
  it('NotificationView from getInbox contains no email/phone/sms field', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        fc.integer({ min: 1, max: 20 }),
        async (userId, limit) => {
          const mockRows = [
            {
              id: 'notif-1',
              type_slug: 'test-type',
              type_label: 'Test Type',
              rendered_content: 'Hello',
              state: 'unread' as const,
              created_at: '2026-01-01T00:00:00Z',
              action_url: null,
            },
          ];
          const deps = createMockDeps({
            query: jest.fn()
              .mockResolvedValueOnce(mockRows)           // getInbox query
              .mockResolvedValueOnce([{ count: '1' }]),  // unread count
          });
          const service = new NotificationServiceImpl(deps);
          const result = await service.getInbox(userId, { limit });

          for (const notification of result.notifications) {
            const keys = Object.keys(notification);
            expect(keys).not.toContain('email');
            expect(keys).not.toContain('phone');
            expect(keys).not.toContain('sms');
            expect(keys).not.toContain('emailAddress');
            expect(keys).not.toContain('phoneNumber');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('ProcessResult from processEvent contains no external delivery info', async () => {
    await fc.assert(
      fc.asyncProperty(arbSlug, arbEntityId, arbUserId, async (slug, entityId, userId) => {
        const typeRow = {
          id: 'type-id-1',
          slug,
          display_template: 'Hello {{name}}',
          action_url_template: null,
          target_roles: JSON.stringify(['Student']),
          dedup_strategy: JSON.stringify({ enabled: false }),
        };
        const deps = createMockDeps({
          query: jest.fn()
            .mockResolvedValueOnce([typeRow])
            .mockResolvedValue([]),
          execute: jest.fn().mockResolvedValue(1),
        });
        const service = new NotificationServiceImpl(deps);
        const event: NotificationEvent = {
          typeSlug: slug,
          entityId,
          context: { name: 'Test' },
          recipientUserId: userId,
        };
        const result = await service.processEvent(event);
        const keys = Object.keys(result);
        expect(keys).not.toContain('emailsSent');
        expect(keys).not.toContain('smsSent');
        expect(keys).not.toContain('pushSent');
        expect(keys).not.toContain('externalDeliveries');
        // Only contains created and deduplicated
        expect(keys.sort()).toEqual(['created', 'deduplicated']);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 11: Pagination and filtering correctness                           */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 11: Pagination and filtering correctness', () => {
  it('getInbox never returns more than limit items', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 50 }),
        async (userId, limit, extraRows) => {
          // Generate rows up to limit + extraRows + 1 to simulate "more results"
          const totalRows = limit + extraRows;
          const mockRows = Array.from({ length: totalRows }, (_, i) => ({
            id: `notif-${i}`,
            type_slug: 'test-type',
            type_label: 'Test',
            rendered_content: `Content ${i}`,
            state: 'unread' as const,
            created_at: new Date(2026, 0, 1, 0, 0, totalRows - i).toISOString(),
            action_url: null,
          }));
          const deps = createMockDeps({
            query: jest.fn()
              .mockResolvedValueOnce(mockRows.slice(0, limit + 1)) // getInbox returns limit+1 for cursor
              .mockResolvedValueOnce([{ count: '5' }]),
          });
          const service = new NotificationServiceImpl(deps);
          const result = await service.getInbox(userId, { limit });
          expect(result.notifications.length).toBeLessThanOrEqual(limit);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('nextCursor is null when results are less than or equal to limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        fc.integer({ min: 1, max: 100 }),
        async (userId, limit) => {
          // Return fewer rows than limit+1 (no extra page)
          const fewRows = Math.max(0, Math.min(limit - 1, 5));
          const mockRows = Array.from({ length: fewRows }, (_, i) => ({
            id: `notif-${i}`,
            type_slug: 'test-type',
            type_label: 'Test',
            rendered_content: `Content ${i}`,
            state: 'unread' as const,
            created_at: new Date(2026, 0, 1, 0, 0, fewRows - i).toISOString(),
            action_url: null,
          }));
          const deps = createMockDeps({
            query: jest.fn()
              .mockResolvedValueOnce(mockRows)
              .mockResolvedValueOnce([{ count: '0' }]),
          });
          const service = new NotificationServiceImpl(deps);
          const result = await service.getInbox(userId, { limit });
          expect(result.nextCursor).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('nextCursor is non-null when more results exist (rows > limit)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        fc.integer({ min: 1, max: 50 }),
        async (userId, limit) => {
          // Return limit+1 rows to trigger pagination
          const mockRows = Array.from({ length: limit + 1 }, (_, i) => ({
            id: `notif-${i}`,
            type_slug: 'test-type',
            type_label: 'Test',
            rendered_content: `Content ${i}`,
            state: 'unread' as const,
            created_at: new Date(2026, 0, 1, 0, 0, limit + 1 - i).toISOString(),
            action_url: null,
          }));
          const deps = createMockDeps({
            query: jest.fn()
              .mockResolvedValueOnce(mockRows)
              .mockResolvedValueOnce([{ count: '10' }]),
          });
          const service = new NotificationServiceImpl(deps);
          const result = await service.getInbox(userId, { limit });
          expect(result.nextCursor).not.toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 2: Inbox ordering                                                  */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 2: Inbox ordering', () => {
  it('getInbox returns notifications in the same order as the DB (created_at DESC)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        fc.array(
          fc.date({ min: new Date(2020, 0, 1), max: new Date(2027, 11, 31) }),
          { minLength: 2, maxLength: 20 },
        ),
        async (userId, dates) => {
          // Sort dates descending to simulate DB ORDER BY created_at DESC
          const sortedDates = [...dates].sort((a, b) => b.getTime() - a.getTime());
          const mockRows = sortedDates.map((d, i) => ({
            id: `notif-${i}`,
            type_slug: 'test-type',
            type_label: 'Test',
            rendered_content: `Content ${i}`,
            state: 'unread' as const,
            created_at: d.toISOString(),
            action_url: null,
          }));
          const deps = createMockDeps({
            query: jest.fn()
              .mockResolvedValueOnce(mockRows)
              .mockResolvedValueOnce([{ count: '0' }]),
          });
          const service = new NotificationServiceImpl(deps);
          const result = await service.getInbox(userId, { limit: 100 });

          // Verify the service preserves the DB order (doesn't reorder)
          for (let i = 1; i < result.notifications.length; i++) {
            const prev = new Date(result.notifications[i - 1].createdAt).getTime();
            const curr = new Date(result.notifications[i].createdAt).getTime();
            expect(prev).toBeGreaterThanOrEqual(curr);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 12: Bulk operation completeness                                    */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 12: Bulk operation completeness', () => {
  it('bulkTransition markAllRead calls UPDATE with state=unread filter', async () => {
    await fc.assert(
      fc.asyncProperty(arbUserId, async (userId) => {
        const executeFn = jest.fn().mockResolvedValue(5);
        const deps = createMockDeps({ execute: executeFn });
        const service = new NotificationServiceImpl(deps);
        await service.bulkTransition(userId, 'markAllRead');

        expect(executeFn).toHaveBeenCalledTimes(1);
        const sql: string = executeFn.mock.calls[0][0];
        expect(sql).toContain("state = 'read'");
        expect(sql).toContain("state = 'unread'");
        expect(executeFn.mock.calls[0][1]).toContain(userId);
      }),
      { numRuns: 100 },
    );
  });

  it('bulkTransition dismissAll calls UPDATE with state!=dismissed filter', async () => {
    await fc.assert(
      fc.asyncProperty(arbUserId, async (userId) => {
        const executeFn = jest.fn().mockResolvedValue(3);
        const deps = createMockDeps({ execute: executeFn });
        const service = new NotificationServiceImpl(deps);
        await service.bulkTransition(userId, 'dismissAll');

        expect(executeFn).toHaveBeenCalledTimes(1);
        const sql: string = executeFn.mock.calls[0][0];
        expect(sql).toContain("state = 'dismissed'");
        expect(sql).toContain("state != 'dismissed'");
        expect(executeFn.mock.calls[0][1]).toContain(userId);
      }),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 3: Unread count accuracy                                           */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 3: Unread count accuracy', () => {
  it('getUnreadCount returns the count from the DB query', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUserId,
        fc.integer({ min: 0, max: 10000 }),
        async (userId, expectedCount) => {
          const deps = createMockDeps({
            query: jest.fn().mockResolvedValue([{ count: String(expectedCount) }]),
          });
          const service = new NotificationServiceImpl(deps);
          const result = await service.getUnreadCount(userId);
          expect(result).toBe(expectedCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Property 8: No-leak validation for Student-targeted types                   */
/* -------------------------------------------------------------------------- */

describe('Feature: in-app-notifications, Property 8: No-leak validation for Student-targeted types', () => {
  const NUMERIC_PLACEHOLDERS = [
    '{{score}}', '{{count}}', '{{total}}', '{{number}}', '{{quantity}}',
    '{{numItems}}', '{{itemCount}}', '{{feedbackCount}}', '{{rating}}',
    '{{percentage}}', '{{percent}}', '{{avg}}', '{{average}}', '{{sum}}',
    '{{min}}', '{{max}}', '{{totalScore}}', '{{itemCount}}',
    '{{feedbackRating}}', '{{userPercentage}}',
  ];

  it('rejects templates with numeric placeholders when targeting Student', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NUMERIC_PLACEHOLDERS),
        fc.string({ minLength: 0, maxLength: 50 }),
        (numericPlaceholder, prefix) => {
          const template = `${prefix} ${numericPlaceholder} notification`;
          const result = validateNoLeakConstraint(template, ['Student']);
          expect(result.valid).toBe(false);
          expect(result.violations.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('allows any template when NOT targeting Student', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...NUMERIC_PLACEHOLDERS),
        fc.constantFrom<TargetRole[]>(['DepartmentAdmin'], ['TechnicalAdmin'], ['DepartmentAdmin', 'TechnicalAdmin']),
        (numericPlaceholder, roles) => {
          const template = `Alert: ${numericPlaceholder} items`;
          const result = validateNoLeakConstraint(template, roles);
          expect(result.valid).toBe(true);
          expect(result.violations).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('allows qualitative templates when targeting Student', () => {
    const SAFE_TEMPLATES = [
      'Your draft is ready for review',
      'A new comment was posted on {{documentTitle}}',
      'Your submission has been {{status}}',
      'Feedback is available for {{assignmentName}}',
      'Welcome to {{courseName}}!',
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...SAFE_TEMPLATES),
        (template) => {
          const result = validateNoLeakConstraint(template, ['Student']);
          expect(result.valid).toBe(true);
          expect(result.violations).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects randomly generated templates with numeric placeholder patterns for Student', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z]+$/.test(s)),
        fc.constantFrom('Score', 'Count', 'Total', 'Number', 'Rating', 'Percentage', 'Percent', 'Qty'),
        (prefix, suffix) => {
          const template = `Value: {{${prefix}${suffix}}}`;
          const result = validateNoLeakConstraint(template, ['Student']);
          expect(result.valid).toBe(false);
          expect(result.violations.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
