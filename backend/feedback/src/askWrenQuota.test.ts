/**
 * Ask WREN per-document lifetime-quota regression tests.
 *
 * The per-document Ask WREN message cap (`platform_usage_policy.message_limit`)
 * is now enforced against a DURABLE Postgres counter (`document.ask_message_count`)
 * reserved by `reserveAskMessage` BEFORE the paid Bedrock call — not the
 * `messageCount` attribute that used to live on the 30-day-TTL'd DynamoDB session
 * item. These tests lock in:
 *   - the lifetime cap is enforced via the Postgres counter and rejects before
 *     any Bedrock call once reached (`reserve-before-paid-call` ordering);
 *   - the DynamoDB session item carries ONLY the transcript — no `messageCount`;
 *   - the regression: with the DynamoDB item ABSENT (TTL-expiry
 *     simulation) the cap still holds when the Postgres count is at the limit, so
 *     the "lifetime" allowance can no longer be reset by letting the item expire;
 *   - `loadDocumentConversation`'s legacy-session migration seeds the transcript
 *     with a create-only conditional Put and never clobbers an existing transcript.
 *
 * No live AWS: we spy on `DynamoDBDocumentClient.prototype.send` with an in-memory
 * item store that emulates the transcript append UpdateCommand (`list_append`), the
 * conditional-create PutCommand (`attribute_not_exists(sessionId)`), and the
 * GetCommand used by loadSession/loadDocumentConversation. The Postgres quota is a
 * tiny in-memory `QueryExecutor` fake; the Bedrock seam is stubbed with a canned
 * Anthropic response.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  appendAskWrenTurn,
  buildLegacyDraftSessionId,
  buildSessionId,
  loadDocumentConversation,
  type ChatMessage,
  type ConversationSession,
} from './askWren';
import type { QueryExecutor } from './db';
import { UsageLimitReachedError } from '@wren/admin/lifetimeUsagePolicy';

const USER_ID = 'user-123';
const DOCUMENT_ID = 'doc-abc';
const DRAFT_ID = 'draft-1';
const MODEL_ID = 'anthropic.claude-sonnet-4-6';

let bedrockSendSpy: jest.SpyInstance;
let store: Map<string, Record<string, unknown>>;
let savedTable: string | undefined;

/**
 * Minimal in-memory Postgres `QueryExecutor` emulating the two statements the
 * Ask WREN quota path runs: `getPlatformUsagePolicy`'s policy SELECT and
 * `reserveAskMessage`'s capped `UPDATE document ... RETURNING ask_message_count`.
 * `count()` exposes the authoritative durable counter for assertions.
 */
function makeQuotaDb(limit: number, initialCount = 0) {
  const state = { count: initialCount };
  const db: QueryExecutor & { count: () => number } = {
    count: () => state.count,
    async query<Row = Record<string, unknown>>(
      text: string,
      params?: readonly unknown[],
    ): Promise<Row[]> {
      if (text.includes('FROM platform_usage_policy WHERE id = 1')) {
        return [
          {
            message_limit: limit,
            debrief_generation_limit: 15,
            document_upload_limit: 30,
            drafts_per_document_limit: 15,
            max_upload_file_size_bytes: 31457280,
            max_word_count: 10000,
          },
        ] as unknown as Row[];
      }
      if (
        text.includes('UPDATE document') &&
        text.includes('ask_message_count = ask_message_count + 1')
      ) {
        const lim = params?.[1] as number;
        if (state.count >= lim) return [] as unknown as Row[];
        state.count += 1;
        return [{ ask_message_count: state.count }] as unknown as Row[];
      }
      throw new Error(`Unexpected SQL in quota fake: ${text}`);
    },
  };
  return db;
}

/**
 * Minimal single-item DynamoDB emulation keyed by sessionId. The item carries
 * only the transcript (`messages`, `ttl`, ids) — the quota counter is NOT stored
 * here anymore. Each `send` callback runs synchronously to completion, so the
 * read-modify-write is atomic per command, matching DynamoDB's single-item
 * guarantee.
 */
function stubDynamo(): void {
  jest
    .spyOn(DynamoDBDocumentClient.prototype, 'send')
    .mockImplementation((command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor.name;
      const input = (command as { input: Record<string, any> }).input;

      if (name === 'GetCommand') {
        const key = input.Key?.sessionId as string | undefined;
        const item = key ? store.get(key) : undefined;
        return Promise.resolve(item ? { Item: item } : {}) as never;
      }

      if (name === 'PutCommand') {
        const item = input.Item as Record<string, unknown>;
        const key = item.sessionId as string;
        // Conditional create used by saveSessionIfAbsent (migration seed).
        if (
          typeof input.ConditionExpression === 'string' &&
          input.ConditionExpression.includes('attribute_not_exists(sessionId)') &&
          store.has(key)
        ) {
          return Promise.reject(
            Object.assign(new Error('The conditional request failed'), {
              name: 'ConditionalCheckFailedException',
            }),
          ) as never;
        }
        store.set(key, { ...item });
        return Promise.resolve({}) as never;
      }

      if (name === 'UpdateCommand') {
        const key = input.Key?.sessionId as string;
        const vals = input.ExpressionAttributeValues as Record<string, any>;
        const expr = String(input.UpdateExpression);
        const existing = store.get(key);

        // Append: list_append of new messages (transcript only).
        if (expr.includes('list_append')) {
          const prevItem = existing ?? { sessionId: key };
          const prevMsgs = Array.isArray(prevItem.messages)
            ? (prevItem.messages as unknown[])
            : vals[':empty'];
          store.set(key, {
            ...prevItem,
            sessionId: key,
            messages: [...prevMsgs, ...vals[':new']],
            ttl: vals[':ttl'],
            draftId: vals[':draftId'],
            userId: prevItem.userId ?? vals[':uid'],
            documentId: prevItem.documentId ?? vals[':did'],
          });
          return Promise.resolve({}) as never;
        }
      }

      throw new Error(`Unexpected DynamoDB command in test: ${name}`);
    });
}

function stubBedrock(): void {
  bedrockSendSpy = jest
    .spyOn(BedrockRuntimeClient.prototype, 'send')
    .mockImplementation(
      () =>
        Promise.resolve({
          body: new TextEncoder().encode(
            JSON.stringify({
              content: [
                {
                  type: 'text',
                  text: 'What part of this section feels least clear, and why?',
                },
              ],
              stop_reason: 'end_turn',
            }),
          ),
          $metadata: { requestId: 'req-ask-wren-quota' },
        }) as never,
    );
}

function currentItem(): ConversationSession | undefined {
  return store.get(buildSessionId(USER_ID, DOCUMENT_ID)) as
    | ConversationSession
    | undefined;
}

function callTurn(db: QueryExecutor) {
  return appendAskWrenTurn({
    userId: USER_ID,
    documentId: DOCUMENT_ID,
    draftId: DRAFT_ID,
    userText: 'Is my argument clear?',
    draftSegments: [{ index: 0, text: 'The tribunal must consider all relevant evidence.' }],
    modelId: MODEL_ID,
    db,
  });
}

function legacyMessages(userTurns: number): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < userTurns; i += 1) {
    out.push({
      id: `legacy-u-${i}`,
      role: 'user',
      text: `legacy question ${i}`,
      createdAt: `2024-01-01T00:0${i}:00.000Z`,
    });
    out.push({
      id: `legacy-r-${i}`,
      role: 'wren',
      text: `legacy reply ${i}`,
      createdAt: `2024-01-01T00:0${i}:30.000Z`,
    });
  }
  return out;
}

beforeAll(() => {
  savedTable = process.env.CONVERSATION_TABLE_NAME;
});

beforeEach(() => {
  process.env.CONVERSATION_TABLE_NAME = 'test-conversation-table';
  store = new Map();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  stubDynamo();
  stubBedrock();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (savedTable === undefined) delete process.env.CONVERSATION_TABLE_NAME;
  else process.env.CONVERSATION_TABLE_NAME = savedTable;
});

describe('appendAskWrenTurn — durable Postgres quota, transcript-only DynamoDB item', () => {
  it('advances the durable counter per turn and accumulates all messages', async () => {
    const db = makeQuotaDb(100);
    await callTurn(db);
    await callTurn(db);

    expect(db.count()).toBe(2);
    const item = currentItem();
    expect(item?.messages).toHaveLength(4);
    // The quota counter is NOT persisted on the session item.
    expect(item).not.toHaveProperty('messageCount');
    expect(bedrockSendSpy).toHaveBeenCalledTimes(2);
  });

  it('reserves exactly once per successful turn under concurrency', async () => {
    const db = makeQuotaDb(100);
    const CONCURRENCY = 4;
    await Promise.all(Array.from({ length: CONCURRENCY }, () => callTurn(db)));

    expect(db.count()).toBe(CONCURRENCY);
    expect(currentItem()?.messages).toHaveLength(CONCURRENCY * 2);
    expect(bedrockSendSpy).toHaveBeenCalledTimes(CONCURRENCY);
  });
});

describe('appendAskWrenTurn — lifetime cap is enforced before any paid call', () => {
  it('rejects with UsageLimitReachedError and makes no Bedrock call once the cap is reached', async () => {
    // Counter already at the cap; a transcript exists for the document.
    const db = makeQuotaDb(2, 2);
    const sessionId = buildSessionId(USER_ID, DOCUMENT_ID);
    store.set(sessionId, {
      sessionId,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: DRAFT_ID,
      ttl: Math.floor(Date.now() / 1000) + 3600,
      messages: [
        { id: 'u1', role: 'user', text: 'q1', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'r1', role: 'wren', text: 'a1', createdAt: '2024-01-01T00:00:01.000Z' },
        { id: 'u2', role: 'user', text: 'q2', createdAt: '2024-01-01T00:00:02.000Z' },
        { id: 'r2', role: 'wren', text: 'a2', createdAt: '2024-01-01T00:00:03.000Z' },
      ],
    });

    await expect(callTurn(db)).rejects.toBeInstanceOf(UsageLimitReachedError);
    expect(bedrockSendSpy).not.toHaveBeenCalled();
    // The rejected attempt leaves the durable counter untouched.
    expect(db.count()).toBe(2);
  });

  it('finding f-4cd612e7: the cap holds even when the session item has expired (is absent)', async () => {
    // Durable Postgres count is at the cap, but the DynamoDB session item is GONE
    // (30-day TTL fired). Pre-fix, the DynamoDB-only counter restarted at 0 and
    // handed out a fresh allowance; now the Postgres counter still blocks.
    const db = makeQuotaDb(100, 100);
    expect(store.size).toBe(0);

    await expect(callTurn(db)).rejects.toBeInstanceOf(UsageLimitReachedError);
    expect(bedrockSendSpy).not.toHaveBeenCalled();
    expect(db.count()).toBe(100);
    // No transcript item was created by the rejected attempt.
    expect(store.size).toBe(0);
  });
});

describe('loadDocumentConversation — legacy migration seeds transcript without clobbering', () => {
  const NEW_DRAFT = 'draft-new';
  const LEGACY_DRAFT = 'draft-legacy';

  it('seeds a brand-new document session transcript from legacy history (create path)', async () => {
    const legacyId = buildLegacyDraftSessionId(USER_ID, DOCUMENT_ID, LEGACY_DRAFT);
    store.set(legacyId, {
      sessionId: legacyId,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: LEGACY_DRAFT,
      ttl: Math.floor(Date.now() / 1000) + 3600,
      messages: legacyMessages(3),
    });

    const result = await loadDocumentConversation({
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: NEW_DRAFT,
      legacyDraftIds: [LEGACY_DRAFT],
    });

    expect(result?.messages).toHaveLength(6);
    // Persisted under the document-scoped key, transcript only (no counter).
    expect(currentItem()?.messages).toHaveLength(6);
    expect(currentItem()).not.toHaveProperty('messageCount');
  });

  it('does NOT overwrite an existing transcript when it loses the create race', async () => {
    // A concurrent turn already created the document session with its transcript.
    const sessionId = buildSessionId(USER_ID, DOCUMENT_ID);
    store.set(sessionId, {
      sessionId,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: NEW_DRAFT,
      ttl: Math.floor(Date.now() / 1000) + 3600,
      messages: [
        { id: 'live-u', role: 'user', text: 'live question', createdAt: '2024-02-01T00:00:00.000Z' },
      ],
    });

    const legacyId = buildLegacyDraftSessionId(USER_ID, DOCUMENT_ID, LEGACY_DRAFT);
    store.set(legacyId, {
      sessionId: legacyId,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: LEGACY_DRAFT,
      ttl: Math.floor(Date.now() / 1000) + 3600,
      messages: legacyMessages(3),
    });

    const result = await loadDocumentConversation({
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: NEW_DRAFT,
      legacyDraftIds: [LEGACY_DRAFT],
    });

    // Stored transcript is left authoritative — NOT overwritten by the migration.
    expect(currentItem()?.messages).toHaveLength(1);
    // The live item already had messages, so that authoritative item is returned.
    expect(result?.messages).toHaveLength(1);
  });
});
