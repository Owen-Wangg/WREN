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
} from '@aws-sdk/lib-dynamodb';

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
}

const SYSTEM_PROMPT = `You are WREN, a Socratic writing coach. The student is asking about their own draft.

Your response should do TWO things:
1. Give a short, specific observation grounded in the draft. Quote a short phrase (5–15 words) directly from the student's text — use quotation marks and include the location hint in parentheses, e.g. "the tribunal must consider" (early in the draft). Pick the quote that best anchors your point.
2. Follow with ONE guiding question that prompts the student to think and act on that observation themselves.

Keep the total response to 3–5 sentences. Be direct and substantive — vague observations or open-ended questions with no grounding are not helpful.

NEVER provide replacement prose, rewrites, corrected sentences, or text they could paste into the document.
NEVER say "try this wording", "here is a revised version", or explain how to rewrite a passage by supplying the rewrite.
NEVER reference paragraph numbers like [p0] or [p1] — use the location hints provided instead.
Stay specific to what is actually in the draft.`;

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

/** Document-scoped session key — survives draft version bumps (Regenerate / Resubmit). */
export function buildSessionId(userId: string, documentId: string): string {
  return `${userId}#${documentId}`;
}

/** Legacy draft-scoped key (pre-carry-forward). Used only to migrate history. */
export function buildLegacyDraftSessionId(
  userId: string,
  documentId: string,
  draftId: string,
): string {
  return `${userId}#${documentId}#${draftId}`;
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
  const modelId =
    input.modelId ?? process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';

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

export async function appendAskWrenTurn(input: {
  userId: string;
  documentId: string;
  draftId: string;
  userText: string;
  draftSegments: Array<{ index?: number; text?: string }>;
  documentTypeContext?: DocumentTypeContext;
  modelId?: string;
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
  const replyText = await generateAskWrenReply({
    userText: userMessage.text,
    priorMessages: prior,
    draftSegments: input.draftSegments,
    documentTypeContext: input.documentTypeContext,
    modelId: input.modelId,
  });

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
  };

  await saveSession(session);
  return { sessionId, userMessage, reply };
}
