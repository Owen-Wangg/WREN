/**
 * Ask WREN session-item size bound (UNRESTRICTED_RESOURCE_CONSUMPTION fix).
 *
 * `appendAskWrenTurn` used to grow the DynamoDB session item with an unbounded
 * `list_append`, so a long conversation could cross DynamoDB's 400 KB item limit
 * and then fail every subsequent `UpdateItem` with `ValidationException` —
 * permanently breaking Ask WREN for that user+document even though the message
 * quota (`messageCount`, capped at 100) was not exhausted.
 *
 * The fix keeps the atomic `list_append` append and adds a best-effort,
 * oldest-first `REMOVE messages[0..k-1]` trim once the stored history would
 * exceed `MAX_SESSION_HISTORY_BYTES`. These tests lock in:
 *   - the pure `computeHistoryTrimCount` budget math, and
 *   - the end-to-end bound: driving many large turns keeps stored history under
 *     budget, never throws, retains the newest turns (sliding window), and keeps
 *     the durable Postgres quota counter incrementing to the true turn count
 *     (quota unaffected by trimming).
 *
 * No live AWS: the in-memory DynamoDB stub mirrors askWrenQuota.test.ts (transcript
 * append + oldest-index `REMOVE` trim); the lifetime quota is a tiny in-memory
 * Postgres `QueryExecutor` fake.
 */
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  appendAskWrenTurn,
  buildSessionId,
  computeHistoryTrimCount,
  estimateMessageBytes,
  MAX_SESSION_HISTORY_BYTES,
  type ChatMessage,
  type ConversationSession,
} from './askWren';
import type { QueryExecutor } from './db';

const USER_ID = 'user-size';
const DOCUMENT_ID = 'doc-size';
const DRAFT_ID = 'draft-1';
const MODEL_ID = 'anthropic.claude-sonnet-4-6';

let bedrockSendSpy: jest.SpyInstance;
let store: Map<string, Record<string, unknown>>;
let savedTable: string | undefined;

function msg(id: string, role: ChatMessage['role'], text: string): ChatMessage {
  return { id, role, text, createdAt: '2024-01-01T00:00:00.000Z' };
}

/**
 * In-memory Postgres `QueryExecutor` fake for the durable Ask WREN quota counter
 * (`document.ask_message_count`). The limit is set high so the size-bound tests
 * are never gated by the quota. `count()` exposes the durable counter.
 */
function makeQuotaDb(limit: number) {
  const state = { count: 0 };
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
 * In-memory single-item DynamoDB emulation. Mirrors askWrenQuota.test.ts:
 * GetCommand, conditional-create PutCommand, and the `list_append` append
 * UpdateCommand (transcript only) — PLUS the oldest-index `REMOVE` trim
 * UpdateCommand.
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
        const vals = (input.ExpressionAttributeValues ?? {}) as Record<string, any>;
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

        // Trim: oldest-index REMOVE guarded by `size(messages) > :keep`.
        if (expr.startsWith('REMOVE')) {
          const msgs = Array.isArray(existing?.messages)
            ? (existing!.messages as unknown[])
            : [];
          const keep = vals[':keep'] as number;
          if (!(msgs.length > keep)) {
            return Promise.reject(
              Object.assign(new Error('The conditional request failed'), {
                name: 'ConditionalCheckFailedException',
              }),
            ) as never;
          }
          // REMOVE lists the first `removeCount` indices; emulate by dropping
          // that many leading (oldest) elements.
          const removeCount = Object.keys(
            input.ExpressionAttributeNames as Record<string, string>,
          ).length;
          store.set(key, {
            ...existing!,
            messages: msgs.slice(removeCount),
          });
          return Promise.resolve({}) as never;
        }
      }

      throw new Error(`Unexpected DynamoDB command in test: ${name}`);
    });
}

function stubBedrock(replyText: string): void {
  bedrockSendSpy = jest
    .spyOn(BedrockRuntimeClient.prototype, 'send')
    .mockImplementation(
      () =>
        Promise.resolve({
          body: new TextEncoder().encode(
            JSON.stringify({
              content: [{ type: 'text', text: replyText }],
              stop_reason: 'end_turn',
            }),
          ),
          $metadata: { requestId: 'req-ask-wren-size' },
        }) as never,
    );
}

function currentItem(): ConversationSession | undefined {
  return store.get(buildSessionId(USER_ID, DOCUMENT_ID)) as
    | ConversationSession
    | undefined;
}

function itemBytes(item: ConversationSession | undefined): number {
  return item ? Buffer.byteLength(JSON.stringify(item), 'utf8') : 0;
}

beforeAll(() => {
  savedTable = process.env.CONVERSATION_TABLE_NAME;
});

beforeEach(() => {
  process.env.CONVERSATION_TABLE_NAME = 'test-conversation-table';
  store = new Map();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  stubDynamo();
  // A reply short enough that the plain-text draft-quote expansion is a no-op.
  stubBedrock('What part of this section feels least clear, and why?');
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (savedTable === undefined) delete process.env.CONVERSATION_TABLE_NAME;
  else process.env.CONVERSATION_TABLE_NAME = savedTable;
});

describe('computeHistoryTrimCount', () => {
  it('returns 0 for an empty list', () => {
    expect(computeHistoryTrimCount([], MAX_SESSION_HISTORY_BYTES)).toBe(0);
  });

  it('returns 0 when the whole history fits under budget', () => {
    const history = [
      msg('u1', 'user', 'short question'),
      msg('r1', 'wren', 'short reply'),
    ];
    expect(computeHistoryTrimCount(history, MAX_SESSION_HISTORY_BYTES)).toBe(0);
  });

  it('drops only enough of the oldest messages to fit the budget', () => {
    // 10 messages of ~1 KB each; budget of ~3.5 KB should retain ~3 newest.
    const history = Array.from({ length: 10 }, (_v, i) =>
      msg(`m${i}`, i % 2 === 0 ? 'user' : 'wren', 'x'.repeat(1000)),
    );
    const perMsg = estimateMessageBytes(history[0]);
    const budget = perMsg * 3 + Math.floor(perMsg / 2);
    const trim = computeHistoryTrimCount(history, budget);
    const kept = history.length - trim;
    expect(kept).toBe(3);
    const keptBytes = history
      .slice(history.length - kept)
      .reduce((sum, m) => sum + estimateMessageBytes(m), 0);
    expect(keptBytes).toBeLessThanOrEqual(budget);
  });

  it('always keeps the newest minKeep messages even if they exceed budget', () => {
    const history = [
      msg('u1', 'user', 'y'.repeat(5000)),
      msg('r1', 'wren', 'y'.repeat(5000)),
    ];
    // Budget far smaller than a single message, yet the last 2 are retained.
    expect(computeHistoryTrimCount(history, 10)).toBe(0);
  });

  it('bounds a synthetic 100-turn x 4000-char history under 300 KB', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 100; i += 1) {
      history.push(msg(`u${i}`, 'user', 'a'.repeat(4000)));
      history.push(msg(`r${i}`, 'wren', 'b'.repeat(3000)));
    }
    const trim = computeHistoryTrimCount(history, MAX_SESSION_HISTORY_BYTES);
    expect(trim).toBeGreaterThan(0);
    const kept = history.slice(history.length - (history.length - trim));
    const keptBytes = kept.reduce((s, m) => s + estimateMessageBytes(m), 0);
    expect(keptBytes).toBeLessThanOrEqual(MAX_SESSION_HISTORY_BYTES);
  });
});

describe('appendAskWrenTurn — stored history stays within the item-size budget', () => {
  function callLargeTurn(db: QueryExecutor, i: number) {
    return appendAskWrenTurn({
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: DRAFT_ID,
      userText: `turn ${i} ${'q'.repeat(3900)}`,
      draftSegments: [
        { index: 0, text: 'The tribunal must consider all relevant evidence.' },
      ],
      modelId: MODEL_ID,
      db,
    });
  }

  it('runs many large turns without ever throwing and keeps the item under 400 KB', async () => {
    const db = makeQuotaDb(1000);
    const TURNS = 120;
    for (let i = 0; i < TURNS; i += 1) {
      // Must not throw (the old unbounded growth eventually failed with a
      // DynamoDB ValidationException surfacing as a 5xx).
      await expect(callLargeTurn(db, i)).resolves.toMatchObject({
        reply: { role: 'wren' },
      });
    }

    const item = currentItem();
    expect(item).toBeDefined();
    // Stored message history stays under the configured budget...
    const historyBytes = Buffer.byteLength(
      JSON.stringify(item?.messages ?? []),
      'utf8',
    );
    expect(historyBytes).toBeLessThanOrEqual(MAX_SESSION_HISTORY_BYTES);
    // ...and the whole item stays safely under DynamoDB's 400 KB hard limit.
    expect(itemBytes(item)).toBeLessThan(400 * 1024);
  });

  it('retains the newest turns (sliding window) and keeps the durable counter at the true turn total', async () => {
    const db = makeQuotaDb(1000);
    const TURNS = 120;
    for (let i = 0; i < TURNS; i += 1) {
      await callLargeTurn(db, i);
    }

    const item = currentItem();
    // Durable Postgres counter reflects every committed turn — trimming the
    // DynamoDB transcript never touches it.
    expect(db.count()).toBe(TURNS);

    // The most recent user turn is still present; an early one was trimmed.
    const texts = (item?.messages ?? []).map((m) => m.text);
    expect(texts.some((t) => t.startsWith(`turn ${TURNS - 1} `))).toBe(true);
    expect(texts.some((t) => t.startsWith('turn 0 '))).toBe(false);

    // History is a bounded window, far fewer than the 240 messages appended.
    expect((item?.messages ?? []).length).toBeLessThan(TURNS * 2);
  });
});
