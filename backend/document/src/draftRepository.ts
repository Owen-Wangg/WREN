/**
 * Draft persistence port + concrete `@wren/db-node`-backed adapter (design
 * "Document / Draft Service — Draft versioning"; REQ-DOC-DRAFT-01 / Requirement
 * 8).
 *
 * `DraftRepository` is an interface — mirroring the injectable `DocxExtractor` /
 * `PdfExtractor` ports used by `ingestion.ts` — so the core versioning logic in
 * `draftVersioning.ts` (and its tests) depends only on the shape, never on a
 * concrete database call. {@link DbDraftRepository} is the production
 * implementation over the parameterized {@link QueryExecutor} (satisfied
 * structurally by `@wren/db-node`'s `DataAccess`).
 *
 * Immutability (Requirement 8.1): this repository exposes NO update path for a
 * Draft. `insertDraft` only ever appends a new row; prior Drafts are never
 * touched. The relational schema additionally enforces this with a BEFORE
 * UPDATE trigger on `draft` and a `UNIQUE (document_id, version_number)`
 * constraint (see `0002_initial_schema.sql`).
 *
 * Feedback Item association (Requirement 8.3): `listFeedbackItems` retrieves the
 * Document's existing Feedback Items so a later stage (Diff_Engine /
 * Progress_Tracker) can re-evaluate them against the new Draft. Feedback Items
 * belong to the Document (`feedback_item.document_id`), so they are inherently
 * carried across Drafts — this method never deletes, regenerates, or mutates
 * them; re-anchoring and re-evaluation are separate tasks (8.x / 9.x).
 */
import {
  draftSchema,
  feedbackItemSchema,
  type Draft,
  type FeedbackItem,
  type Segment,
} from '@wren/types';

/**
 * Minimal parameterized data-access surface. `@wren/db-node`'s `DataAccess`
 * satisfies this structurally (`query<Row>(text, params)`), and so does any
 * test fake. Every value is sent to PostgreSQL as a bind parameter ($1..$N);
 * no value is ever interpolated into SQL text (UBC CIC security steering /
 * Requirement 39.2).
 */
export interface QueryExecutor {
  query<Row = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

/** The fields required to persist a new immutable Draft. */
export interface NewDraftInput {
  readonly documentId: string;
  readonly versionNumber: number;
  readonly s3Key: string;
  readonly segments: readonly Segment[];
  readonly wordCount: number;
}

/**
 * Persistence operations the draft-versioning core depends on. Deliberately
 * append-and-read only — there is no `updateDraft`, because Drafts are
 * immutable (Requirement 8.1).
 */
export interface DraftRepository {
  /**
   * The highest existing `versionNumber` for a Document, or `null` when the
   * Document has no Drafts yet. Used to assign the next monotonically
   * increasing version (Requirement 8.2).
   */
  getHighestVersionNumber(documentId: string): Promise<number | null>;

  /** Append a new immutable Draft and return the stored row (Requirement 8.1). */
  insertDraft(input: NewDraftInput): Promise<Draft>;

  /**
   * The current Draft — the one with the highest `versionNumber` — or `null`
   * when the Document has no Drafts. The DAL-query counterpart to the pure
   * `selectCurrentDraft` selector (Requirement 8.2).
   */
  getCurrentDraft(documentId: string): Promise<Draft | null>;

  /**
   * The Document's existing Feedback Items, to hand to the re-evaluation stage
   * (Requirement 8.3). Read-only: never mutates or regenerates feedback.
   */
  listFeedbackItems(documentId: string): Promise<FeedbackItem[]>;
}

/** Raw `draft` row (snake_case columns from PostgreSQL). */
interface DraftRow {
  readonly id: string;
  readonly document_id: string;
  readonly version_number: number;
  readonly s3_key: string;
  readonly segments: unknown;
  readonly word_count: number;
  readonly created_at: string | Date;
}

/** Raw `feedback_item` row (snake_case columns from PostgreSQL). */
interface FeedbackItemRow {
  readonly id: string;
  readonly document_id: string;
  readonly error_category_id: string;
  readonly kind: string;
  readonly question_text: string;
  readonly current_anchor_id: string | null;
  readonly citation_reference_id: string | null;
  readonly source_draft_id: string;
  readonly created_at: string | Date;
}

const DRAFT_COLUMNS =
  'id, document_id, version_number, s3_key, segments, word_count, created_at';

const FEEDBACK_ITEM_COLUMNS =
  'id, document_id, error_category_id, kind, question_text, ' +
  'current_anchor_id, citation_reference_id, source_draft_id, created_at';

/** timestamptz comes back as a JS `Date` (or ISO string); normalize to ISO. */
function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Normalize a jsonb column value. Drivers may return a parsed object, a JSON
 * string, or (when the app also `JSON.stringify`s the bind param) a
 * double-encoded JSON string.
 */
function parseJsonbColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? [];
  let parsed: unknown = JSON.parse(value);
  if (typeof parsed === 'string') {
    parsed = JSON.parse(parsed);
  }
  return parsed;
}

/** Map a raw `draft` row to the validated shared {@link Draft} DTO. */
function toDraft(row: DraftRow): Draft {
  return draftSchema.parse({
    id: row.id,
    documentId: row.document_id,
    versionNumber: row.version_number,
    s3Key: row.s3_key,
    segments: parseJsonbColumn(row.segments),
    wordCount: row.word_count,
    createdAt: toIso(row.created_at),
  });
}

/** Map a raw `feedback_item` row to the validated shared {@link FeedbackItem}. */
function toFeedbackItem(row: FeedbackItemRow): FeedbackItem {
  return feedbackItemSchema.parse({
    id: row.id,
    documentId: row.document_id,
    errorCategoryId: row.error_category_id,
    kind: row.kind,
    questionText: row.question_text,
    // DB NULL → omit the optional field entirely (strict schema).
    ...(row.current_anchor_id !== null ? { currentAnchorId: row.current_anchor_id } : {}),
    ...(row.citation_reference_id !== null
      ? { citationReferenceId: row.citation_reference_id }
      : {}),
    sourceDraftId: row.source_draft_id,
    createdAt: toIso(row.created_at),
  });
}

/**
 * Production {@link DraftRepository} backed by the parameterized
 * {@link QueryExecutor}. All statements use bind parameters only.
 */
export class DbDraftRepository implements DraftRepository {
  public constructor(private readonly db: QueryExecutor) {}

  public async getHighestVersionNumber(documentId: string): Promise<number | null> {
    const rows = await this.db.query<{ max_version: number | null }>(
      'SELECT MAX(version_number)::int AS max_version FROM draft WHERE document_id = $1',
      [documentId],
    );
    return rows[0]?.max_version ?? null;
  }

  public async insertDraft(input: NewDraftInput): Promise<Draft> {
    const rows = await this.db.query<DraftRow>(
      `INSERT INTO draft (document_id, version_number, s3_key, segments, word_count)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING ${DRAFT_COLUMNS}`,
      [
        input.documentId,
        input.versionNumber,
        input.s3Key,
        JSON.stringify(input.segments),
        input.wordCount,
      ],
    );
    return toDraft(rows[0]!);
  }

  public async getCurrentDraft(documentId: string): Promise<Draft | null> {
    const rows = await this.db.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM draft
       WHERE document_id = $1
       ORDER BY version_number DESC
       LIMIT 1`,
      [documentId],
    );
    const row = rows[0];
    return row ? toDraft(row) : null;
  }

  public async listFeedbackItems(documentId: string): Promise<FeedbackItem[]> {
    const rows = await this.db.query<FeedbackItemRow>(
      `SELECT ${FEEDBACK_ITEM_COLUMNS} FROM feedback_item
       WHERE document_id = $1
       ORDER BY created_at ASC`,
      [documentId],
    );
    return rows.map(toFeedbackItem);
  }
}
