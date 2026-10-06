/**
 * Ask WREN per-document quota regression tests (findings f-9051b431, f-038c167b).
 *
 * These lock in the fix for the lost-update that let concurrent requests defeat
 * `platform_usage_policy.message_limit`:
 *   - `appendAskWrenTurn` reserves a slot with an atomic conditional increment
 *     (`reserveAskMessageSlot`) and persists the turn by APPENDING messages only
 *     (`appendMessagesToSession`) — never by rewriting the whole item (which used
 *     to reset `messageCount` from a stale pre-reservation read and clobber turns
 *     a concurrent request committed in between).
 *   - `loadDocumentConversation`'s legacy-session migration SEEDS the document
 *     session with a create-only conditional Put (`saveSessionIfAbsent`), so a
 *     racing reservation's authoritative `messageCount` is never clobbered.
 *
 * No live AWS: we spy on `DynamoDBDocumentClient.prototype.send` with an in-memory
 * item store that emulates the reservation UpdateCommand (atomic increment + the
 * `< :limit` condition), the append UpdateCommand (`list_append`, no count write),
 * the conditional create PutCommand (`attribute_not_exists(sessionId)`), and the
 * GetCommand used by loadSession/loadDocumentConversation. The Bedrock seam
 * (`BedrockRuntimeClient.prototype.send`) is stubbed with a canned Anthropic
 * response, matching the *.prototype.send style of askWrenCaching.test.ts.
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
import { UsageLimitReachedError } from '@wren/admin/lifetimeUsagePolicy';

const USER_ID = 'user-123';
const DOCUMENT_ID = 'doc-abc';
const DRAFT_ID = 'draft-1';
const MODEL_ID = 'anthropic.claude-sonnet-4-6';

let bedrockSendSpy: jest.SpyInstance;
let store: Map<string, Record<string, unknown>>;
let savedTable: string | undefined;

/**
 * Minimal single-item DynamoDB emulation keyed by sessionId. Because the Jest
 * event loop runs each `send` callback synchronously to completion, the
 * read-modify-write below is atomic per command — the same guarantee DynamoDB
 * gives a single-item Update/Put — so concurrent reservations serialize exactly
 * as they would against the real table.
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

        // Reservation: atomic conditional increment of messageCount.
        if (input.ConditionExpression && expr.includes('messageCount')) {
          const hasCount = !!existing && typeof existing.messageCount === 'number';
          const base = hasCount ? (existing!.messageCount as number) : vals[':current'];
          if (!(base < vals[':limit'])) {
            return Promise.reject(
              Object.assign(new Error('The conditional request failed'), {
                name: 'ConditionalCheckFailedException',
              }),
            ) as never;
          }
          const prevItem = existing ?? {};
          store.set(key, {
            ...prevItem,
            sessionId: key,
            messageCount: base + vals[':one'],
            userId: prevItem.userId ?? vals[':uid'],
            documentId: prevItem.documentId ?? vals[':did'],
            draftId: vals[':draftId'],
            ttl: prevItem.ttl ?? vals[':ttl'],
            messages: prevItem.messages ?? vals[':empty'],
          });
          return Promise.resolve({}) as never;
        }

        // Append: list_append of new messages, never writes messageCount.
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

function callTurn() {
  return appendAskWrenTurn({
    userId: USER_ID,
    documentId: DOCUMENT_ID,
    draftId: DRAFT_ID,
    userText: 'Is my argument clear?',
    draftSegments: [{ index: 0, text: 'The tribunal must consider all relevant evidence.' }],
    modelId: MODEL_ID,
    messageLimit: 100,
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

describe('appendAskWrenTurn — quota is not reset by the final persist', () => {
  it('two sequential turns leave messageCount at 2 and accumulate all four messages', async () => {
    await callTurn();
    await callTurn();

    const item = currentItem();
    expect(item?.messageCount).toBe(2);
    expect(item?.messages).toHaveLength(4);
    expect(bedrockSendSpy).toHaveBeenCalledTimes(2);
  });

  it('concurrent turns advance messageCount by the number of successful reservations', async () => {
    const CONCURRENCY = 4;
    await Promise.all(Array.from({ length: CONCURRENCY }, () => callTurn()));

    const item = currentItem();
    // The bug reset the counter to 1 regardless of concurrency; the fix keeps the
    // reservation authoritative, so every committed turn is counted exactly once.
    expect(item?.messageCount).toBe(CONCURRENCY);
    expect(item?.messages).toHaveLength(CONCURRENCY * 2);
    expect(bedrockSendSpy).toHaveBeenCalledTimes(CONCURRENCY);
  });
});

describe('appendAskWrenTurn — limit is enforced before any paid call', () => {
  it('rejects with UsageLimitReachedError and makes no Bedrock call once the limit is reached', async () => {
    const sessionId = buildSessionId(USER_ID, DOCUMENT_ID);
    store.set(sessionId, {
      sessionId,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: DRAFT_ID,
      ttl: Math.floor(Date.now() / 1000) + 3600,
      messageCount: 2,
      messages: [
        { id: 'u1', role: 'user', text: 'q1', createdAt: '2024-01-01T00:00:00.000Z' },
        { id: 'r1', role: 'wren', text: 'a1', createdAt: '2024-01-01T00:00:01.000Z' },
        { id: 'u2', role: 'user', text: 'q2', createdAt: '2024-01-01T00:00:02.000Z' },
        { id: 'r2', role: 'wren', text: 'a2', createdAt: '2024-01-01T00:00:03.000Z' },
      ],
    });

    await expect(
      appendAskWrenTurn({
        userId: USER_ID,
        documentId: DOCUMENT_ID,
        draftId: DRAFT_ID,
        userText: 'One more?',
        draftSegments: [{ index: 0, text: 'A draft paragraph.' }],
        modelId: MODEL_ID,
        messageLimit: 2,
      }),
    ).rejects.toBeInstanceOf(UsageLimitReachedError);

    expect(bedrockSendSpy).not.toHaveBeenCalled();
    // The rejected attempt leaves the stored count untouched.
    expect(currentItem()?.messageCount).toBe(2);
  });
});

describe('loadDocumentConversation — legacy migration never clobbers the live counter', () => {
  const NEW_DRAFT = 'draft-new';
  const LEGACY_DRAFT = 'draft-legacy';

  it('seeds a brand-new document session from legacy history (create path)', async () => {
    const legacyId = buildLegacyDraftSessionId(USER_ID, DOCUMENT_ID, LEGACY_DRAFT);
    store.set(legacyId, {
      sessionId: legacyId,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: LEGACY_DRAFT,
      ttl: Math.floor(Date.now() / 1000) + 3600,
      messageCount: 3,
      messages: legacyMessages(3),
    });

    const result = await loadDocumentConversation({
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: NEW_DRAFT,
      legacyDraftIds: [LEGACY_DRAFT],
    });

    expect(result?.messageCount).toBe(3);
    expect(result?.messages).toHaveLength(6);
    // Persisted under the document-scoped key.
    expect(currentItem()?.messageCount).toBe(3);
    expect(currentItem()?.messages).toHaveLength(6);
  });

  it('does NOT lower an existing reservation counter when it loses the create race', async () => {
    // A bare reservation already created the document session: messageCount=1,
    // messages still empty (the reservation initializes messages to []).
    const sessionId = buildSessionId(USER_ID, DOCUMENT_ID);
    store.set(sessionId, {
      sessionId,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: NEW_DRAFT,
      ttl: Math.floor(Date.now() / 1000) + 3600,
      messageCount: 1,
      messages: [],
    });

    // Legacy history with MORE user turns than the live counter — a full-item
    // Put would recompute messageCount down/across to 3 and clobber the live 1.
    const legacyId = buildLegacyDraftSessionId(USER_ID, DOCUMENT_ID, LEGACY_DRAFT);
    store.set(legacyId, {
      sessionId: legacyId,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: LEGACY_DRAFT,
      ttl: Math.floor(Date.now() / 1000) + 3600,
      messageCount: 3,
      messages: legacyMessages(3),
    });

    const result = await loadDocumentConversation({
      userId: USER_ID,
      documentId: DOCUMENT_ID,
      draftId: NEW_DRAFT,
      legacyDraftIds: [LEGACY_DRAFT],
    });

    // Stored counter is left authoritative — NOT overwritten by the migration.
    expect(currentItem()?.messageCount).toBe(1);
    expect(currentItem()?.messages).toEqual([]);
    // The returned view surfaces legacy history in-memory for context/display,
    // while keeping the authoritative count.
    expect(result?.messageCount).toBe(1);
    expect(result?.messages).toHaveLength(6);
  });
});
