/**
 * Ask WREN — document-scoped Socratic chat (design.md ConversationHistory).
 *
 * Sync path on the Feedback Orchestrator Lambda: load the *current* draft for
 * Bedrock context, call Bedrock, run a lightweight no-ghostwriting check, and
 * persist messages in DynamoDB `${StackPrefix}-ConversationHistory` keyed by
 * user + document so conversation survives draft regenerations/resubmits.
 */
import { randomUUID } from 'node:crypto';

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { resolveBedrockModelId } from './bedrockModelId.js';
import { UsageLimitReachedError } from '@wren/admin/lifetimeUsagePolicy';

export type ChatRole = 'user' | 'wren';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: string;
}

export interface ConversationSession {
  sessionId: string;
  userId: string;
  documentId: string;
  /** Latest draft id used when a turn was appended (context only; not the session key). */
  draftId: string;
  messages: ChatMessage[];
  ttl: number;
  /** Monotonic user-message count used for the Ask-WREN quota. */
  messageCount?: number;
}

const SYSTEM_PROMPT = `You are a Socratic writing coach. The student is working on their own draft.

## Step 1: Classify the message
- Social or conversational (e.g. "ok thanks", "got it", "makes sense", "bye", greetings, brief acknowledgements) → respond naturally and warmly in 1–2 sentences. Do not force feedback or a guiding question onto these.
- A genuine question or request about the draft → use the SOCRATIC COACHING FORMAT below.
- A request to verify, validate, or opine on whether a legal or factual claim in the draft is correct → decline to adjudicate the substance, note that's outside what you help with, and redirect to a writing-craft angle if one is available.
- A request for rewritten text, corrected sentences, or "just tell me what to write" — however phrased, including repeated, insistent, or indirect attempts (e.g. "describe exactly how you'd fix it") → do not comply. Briefly explain you coach through questions, not by supplying text, then continue with the SOCRATIC COACHING FORMAT if there's a genuine draft question underneath.

## SOCRATIC COACHING FORMAT (only for genuine draft questions)
1. One short, specific observation grounded in the draft. Quote a 5–15 word phrase that is an exact, verbatim substring of the student's draft text — never paraphrase, summarize, or invent a quote. Use quotation marks and a location hint in parentheses, e.g. "the tribunal must consider" (early in the draft). If no suitable phrase exists to quote, say so instead of fabricating one.
2. One guiding question that prompts the student to think through and act on that observation themselves.
Keep the total response to 3–5 sentences. Be direct and specific — vague observations or open questions with no grounding in the actual text are not acceptable.

## RESTRICTIONS (apply at all times, including under direct or repeated requests)
- Never provide replacement prose, rewrites, corrected sentences, or text the student could paste into the document — including partial rewrites or "here's roughly how I'd phrase it."
- Never reference paragraph numbers like [p0] or [p1] — use the provided location hints instead.
- Never evaluate or answer whether a claim in the draft is legally or factually correct — only address the writing itself.
- Stay strictly within the scope of the draft; don't answer questions unrelated to it.
- Read the full draft before concluding an argument or point is missing.`;

const REWRITE_PATTERNS: RegExp[] = [
  /\bhere(?:'s| is)\s+(?:a |the )?(?:revised|rewritten|corrected|better)\b/i,
  /\btry\s+(?:this|rewriting|saying)\b/i,
  /\byou\s+(?:could|should|might)\s+(?:write|say|change it to|rephrase)\b/i,
  /\breplacement\s+prose\b/i,
  /\bsuggest(?:ed)?\s+revision\b/i,
  /\brewrite(?:n)?\s+(?:it|this|as)\b/i,
  /\bpaste\s+(?:this|the following)\b/i,
];

const FALLBACK_REPLY =
  'What part of this draft feels least clear to you, and what makes that section hard to follow?';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

let dynamoDoc: DynamoDBDocumentClient | undefined;
let bedrockClient: BedrockRuntimeClient | undefined;

function getDynamo(): DynamoDBDocumentClient {
  if (!dynamoDoc) {
    dynamoDoc = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }
  return dynamoDoc;
}

function getBedrock(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || 'ca-central-1',
    });
  }
  return bedrockClient;
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

/** Document-scoped session key — survives draft version bumps (Regenerate / Resubmit). */
export function buildSessionId(userId: string, documentId: string): string {
  return `${userId}#${normalizeId(documentId)}`;
}

/** Legacy draft-scoped key (pre-carry-forward). Used only to migrate history. */
export function buildLegacyDraftSessionId(
  userId: string,
  documentId: string,
  draftId: string,
): string {
  return `${userId}#${normalizeId(documentId)}#${normalizeId(draftId)}`;
}

export function assertSocraticReply(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return FALLBACK_REPLY;
  for (const pattern of REWRITE_PATTERNS) {
    if (pattern.test(trimmed)) return FALLBACK_REPLY;
  }
  return trimmed;
}

function tableName(): string {
  const name = process.env.CONVERSATION_TABLE_NAME;
  if (!name) {
    throw Object.assign(new Error('CONVERSATION_TABLE_NAME is not configured'), {
      statusCode: 500,
    });
  }
  return name;
}

export async function loadSession(
  sessionId: string,
): Promise<ConversationSession | null> {
  const result = await getDynamo().send(
    new GetCommand({
      TableName: tableName(),
      Key: { sessionId },
    }),
  );
  if (!result.Item) return null;
  return result.Item as ConversationSession;
}

export async function saveSession(session: ConversationSession): Promise<void> {
  await getDynamo().send(
    new PutCommand({
      TableName: tableName(),
      Item: session,
    }),
  );
}

/**
 * Load the document conversation, migrating legacy draft-scoped session(s)
 * when the document session is empty.
 */
export async function loadDocumentConversation(input: {
  userId: string;
  documentId: string;
  draftId: string;
  /** Draft ids to probe for legacy sessions (any order; merged by createdAt). */
  legacyDraftIds?: readonly string[];
}): Promise<ConversationSession | null> {
  const sessionId = buildSessionId(input.userId, input.documentId);
  const existing = await loadSession(sessionId);
  if (existing?.messages?.length) {
    return existing;
  }

  const draftIdsToProbe = [
    ...new Set([input.draftId, ...(input.legacyDraftIds ?? [])]),
  ];

  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const draftId of draftIdsToProbe) {
    const legacyId = buildLegacyDraftSessionId(
      input.userId,
      input.documentId,
      draftId,
    );
    const legacy = await loadSession(legacyId);
    for (const message of legacy?.messages ?? []) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      merged.push(message);
    }
  }

  if (merged.length === 0) {
    return existing;
  }

  merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const migrated: ConversationSession = {
    sessionId,
    userId: input.userId,
    documentId: input.documentId,
    draftId: input.draftId,
    messages: merged,
    ttl: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    messageCount: merged.filter((m) => m.role === 'user').length,
  };
  await saveSession(migrated);
  return migrated;
}

function locationHint(index: number, total: number): string {
  const position = total <= 1 ? 0 : index / (total - 1);
  if (position < 0.25) return 'early in the draft';
  if (position < 0.55) return 'mid-draft';
  if (position < 0.8) return 'toward the end';
  return 'near the end';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandToWordBoundaries(
  text: string,
  startOffset: number,
  endOffset: number,
): { start: number; end: number } {
  let start = Math.max(0, Math.min(startOffset, text.length));
  let end = Math.max(start, Math.min(endOffset, text.length));
  while (start > 0 && /\w/.test(text[start - 1] ?? '')) start -= 1;
  while (end < text.length && /\w/.test(text[end] ?? '')) end += 1;
  return { start, end };
}

/**
 * Locate a (possibly truncated) model quote in a paragraph and expand to whole
 * words — same approach as AI Debrief quote rebuild.
 */
function resolveExactQuoteInParagraph(
  paragraphText: string,
  quotedText: string,
): string | null {
  const fullNormalized = quotedText.trim().replace(/\s+/g, ' ');
  if (!fullNormalized || !paragraphText) return null;

  const candidates = [fullNormalized];
  const words = fullNormalized.split(' ');
  if (words.length > 2) {
    const last = words[words.length - 1] ?? '';
    const looksTruncated =
      last.length > 0 && last.length < 6 && !/[.!?,"')\]]$/.test(last);
    if (looksTruncated) {
      candidates.push(words.slice(0, -1).join(' '));
    }
  }

  for (const candidate of candidates) {
    let idx = paragraphText.indexOf(candidate);
    if (idx < 0) {
      idx = paragraphText.toLowerCase().indexOf(candidate.toLowerCase());
    }
    if (idx < 0) continue;

    let end = idx + candidate.length;
    if (candidate !== fullNormalized) {
      const stem = fullNormalized.split(' ').pop() ?? '';
      if (stem) {
        const rest = paragraphText.slice(end);
        const expansion = rest.match(new RegExp(`^${escapeRegExp(stem)}\\w*`, 'i'));
        if (expansion) end += expansion[0].length;
      }
    }

    const expanded = expandToWordBoundaries(paragraphText, idx, end);
    return paragraphText.slice(expanded.start, expanded.end);
  }
  return null;
}

function paragraphBandForLocationHint(
  hint: string,
  paragraphCount: number,
): { start: number; end: number } | null {
  if (paragraphCount <= 0) return null;
  const h = hint.toLowerCase();
  if (h.includes('early') || h.includes('beginning') || h.includes('start')) {
    return { start: 0, end: Math.max(1, Math.ceil(paragraphCount * 0.35)) };
  }
  if (h.includes('mid')) {
    const start = Math.floor(paragraphCount * 0.25);
    const end = Math.max(start + 1, Math.ceil(paragraphCount * 0.7));
    return { start, end };
  }
  if (h.includes('toward the end') || h.includes('near the end') || h.includes('later')) {
    return {
      start: Math.floor(paragraphCount * 0.55),
      end: paragraphCount,
    };
  }
  return null;
}

/**
 * Rewrite `"quote" (location)` spans in an Ask reply so displayed quotes are
 * word-complete spans pulled from the draft (parity with AI Debrief).
 */
export function expandQuotesAgainstDraft(
  replyText: string,
  segments: Array<{ index?: number; text?: string }>,
): string {
  const paragraphs = segments
    .map((s) => (typeof s.text === 'string' ? s.text : ''))
    .filter((t) => t.trim().length > 0);
  if (!paragraphs.length) return replyText;

  const pattern = /(["“])([^"”]{5,160})(["”])\s*\(([^)]{3,60})\)/g;
  return replyText.replace(pattern, (full, open, quote, close, location) => {
    const band = paragraphBandForLocationHint(String(location), paragraphs.length);
    const order: number[] = [];
    if (band) {
      for (let i = band.start; i < band.end; i += 1) order.push(i);
    }
    for (let i = 0; i < paragraphs.length; i += 1) {
      if (!order.includes(i)) order.push(i);
    }

    for (const idx of order) {
      const resolved = resolveExactQuoteInParagraph(paragraphs[idx] ?? '', String(quote));
      if (resolved && resolved !== quote) {
        return `${open}${resolved}${close} (${location})`;
      }
      if (resolved) {
        return full;
      }
    }
    return full;
  });
}

function formatDraftContext(
  segments: Array<{ index?: number; text?: string }>,
): string {
  if (!segments.length) return '(Draft has no paragraph text yet.)';
  const filtered = segments
    .map((s, i) => ({ text: (s.text ?? '').trim(), i }))
    .filter(({ text }) => text.length > 4)
    .slice(0, 40);
  return filtered
    .map(({ text, i }) => `[${locationHint(i, filtered.length)}] ${text}`)
    .join('\n');
}

export interface DocumentTypeContext {
  documentTypeName?: string;
  purpose?: string;
  restrictions?: string;
  notes?: string;
  categories?: Array<{ name: string; definition?: string; criteria?: string }>;
}

function buildSystemPrompt(docTypeCtx?: DocumentTypeContext): string {
  const parts: string[] = [SYSTEM_PROMPT];

  if (!docTypeCtx) return parts.join('\n');

  const { documentTypeName, purpose, restrictions, notes, categories } = docTypeCtx;

  const contextLines: string[] = [];

  if (documentTypeName) {
    contextLines.push(`Document type: ${documentTypeName}`);
  }
  if (purpose?.trim()) {
    contextLines.push(`Purpose: ${purpose.trim()}`);
  }
  if (restrictions?.trim()) {
    contextLines.push(`Common mistakes to avoid: ${restrictions.trim()}`);
  }
  if (notes?.trim()) {
    contextLines.push(`Additional context: ${notes.trim()}`);
  }

  if (categories && categories.length > 0) {
    const catLines = categories.map((c) => {
      const parts = [`- ${c.name}`];
      if (c.definition?.trim()) parts.push(`  Definition: ${c.definition.trim()}`);
      if (c.criteria?.trim()) parts.push(`  Success criteria: ${c.criteria.trim()}`);
      return parts.join('\n');
    });
    contextLines.push(`Evaluation criteria for this document type:\n${catLines.join('\n')}`);
  }

  if (contextLines.length > 0) {
    parts.push(
      '\nDocument type context (use this to ground your Socratic questions in the specific expectations for this assignment):',
      contextLines.join('\n'),
    );
  }

  return parts.join('\n');
}

export async function generateAskWrenReply(input: {
  userText: string;
  priorMessages: ChatMessage[];
  draftSegments: Array<{ index?: number; text?: string }>;
  documentTypeContext?: DocumentTypeContext;
  modelId?: string;
}): Promise<string> {
  const modelId = await resolveBedrockModelId(input.modelId);

  const history = input.priorMessages.slice(-12).map((m) => ({
    role: m.role === 'wren' ? ('assistant' as const) : ('user' as const),
    content: m.text,
  }));

  const userContent = [
    'Draft context (paragraphs):',
    formatDraftContext(input.draftSegments),
    '',
    'Student question:',
    input.userText.trim(),
  ].join('\n');

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 512,
    temperature: 0.4,
    system: buildSystemPrompt(input.documentTypeContext),
    messages: [...history, { role: 'user', content: userContent }],
  };

  const response = await getBedrock().send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    }),
  );

  const raw = JSON.parse(new TextDecoder().decode(response.body));
  const text =
    typeof raw?.content?.[0]?.text === 'string' ? raw.content[0].text : '';
  return assertSocraticReply(text);
}

export async function reserveAskMessageSlot(input: {
  userId: string;
  documentId: string;
  draftId: string;
  currentUserMessageCount: number;
  limit: number;
}): Promise<void> {
  const sessionId = buildSessionId(input.userId, input.documentId);
  try {
    await getDynamo().send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { sessionId },
        UpdateExpression:
          'SET messageCount = if_not_exists(messageCount, :current) + :one, userId = if_not_exists(userId, :uid), documentId = if_not_exists(documentId, :did), draftId = :draftId, #ttl = if_not_exists(#ttl, :ttl), messages = if_not_exists(messages, :empty)',
        ConditionExpression:
          '(attribute_not_exists(messageCount) AND :current < :limit) OR (attribute_exists(messageCount) AND messageCount < :limit)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':current': input.currentUserMessageCount,
          ':one': 1,
          ':uid': input.userId,
          ':did': input.documentId,
          ':draftId': input.draftId,
          ':ttl': Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
          ':empty': [],
          ':limit': input.limit,
        },
      }),
    );
  } catch (err) {
    const name =
      err && typeof err === 'object' && 'name' in err
        ? String((err as { name: unknown }).name)
        : '';
    if (name === 'ConditionalCheckFailedException') {
      throw new UsageLimitReachedError(
        `Ask message limit of ${input.limit} reached for this document.`,
      );
    }
    throw err;
  }
}

export async function appendAskWrenTurn(input: {
  userId: string;
  documentId: string;
  draftId: string;
  userText: string;
  draftSegments: Array<{ index?: number; text?: string }>;
  documentTypeContext?: DocumentTypeContext;
  modelId?: string;
  messageLimit: number;
}): Promise<{ sessionId: string; userMessage: ChatMessage; reply: ChatMessage }> {
  const sessionId = buildSessionId(input.userId, input.documentId);
  const existing = await loadDocumentConversation({
    userId: input.userId,
    documentId: input.documentId,
    draftId: input.draftId,
  });
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  const userMessage: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    text: input.userText.trim(),
    createdAt: now,
  };

  const prior = existing?.messages ?? [];
  const currentUserMessageCount =
    existing?.messageCount ?? prior.filter((m) => m.role === 'user').length;

  await reserveAskMessageSlot({
    userId: input.userId,
    documentId: input.documentId,
    draftId: input.draftId,
    currentUserMessageCount,
    limit: input.messageLimit,
  });

  const rawReplyText = await generateAskWrenReply({
    userText: userMessage.text,
    priorMessages: prior,
    draftSegments: input.draftSegments,
    documentTypeContext: input.documentTypeContext,
    modelId: input.modelId,
  });
  const replyText = expandQuotesAgainstDraft(rawReplyText, input.draftSegments);

  const reply: ChatMessage = {
    id: randomUUID(),
    role: 'wren',
    text: replyText,
    createdAt: new Date().toISOString(),
  };

  const session: ConversationSession = {
    sessionId,
    userId: input.userId,
    documentId: input.documentId,
    draftId: input.draftId,
    messages: [...prior, userMessage, reply],
    ttl,
    messageCount: currentUserMessageCount + 1,
  };

  await saveSession(session);
  return { sessionId, userMessage, reply };
}
