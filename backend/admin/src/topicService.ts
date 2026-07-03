/**
 * Org-Owner business Topics, scoped to ONE owned Organization (REQ-TOPIC-01 /
 * Requirement 35).
 *
 * A Topic is purely a business-layer label used to organize Users' work — it
 * is NOT a data-isolation boundary (REQ-ORG-GROUPING-01, Requirement 35.2) and
 * it NEVER drives error taxonomy, Reference Material selection, or feedback
 * generation (Requirement 35.3); those remain Writing Type / Writing Domain
 * concerns. This service has no dependency on, and is never referenced by, the
 * error-taxonomy or feedback-generation code paths.
 *
 * A Topic is distinct from a Document's per-document "Writing Topic" Custom
 * Metadata Field value (Requirement 35.4): the catalog entry here and the
 * free-form string stored on a Document are independent — a Document's
 * metadata value is never a foreign key to `topic.id`. Deleting a Topic
 * therefore never cascades into or blanks any Document's stored metadata;
 * {@link getTopicDeletionImpact} exists solely to surface a best-effort count
 * of Documents whose "Writing Topic" metadata value currently matches the
 * Topic's name, so the caller can present an informed confirmation before
 * deleting (Requirement 35.5).
 *
 * Topics are a distinct business entity from the Writing Type catalog, so
 * mutations are gated by their own `topic.manage` capability (Org Owner within
 * an owned Organization, or Admin) rather than reusing
 * `writingType.manageCatalog`. Every mutation re-checks the capability BEFORE
 * touching the database and denies with no mutation when disallowed
 * (Requirements 36.2, 36.3). All persistence uses the injected parameterized
 * {@link QueryExecutor} (Requirement 39.2).
 */
import {
  createTopicInputSchema,
  topicDeletionImpactSchema,
  topicSchema,
  updateTopicInputSchema,
  type AuthContext,
  type CreateTopicInput,
  type Topic,
  type TopicDeletionImpact,
  type UpdateTopicInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import { WRITING_TOPIC_LABEL } from './customMetadataFieldService';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `topic` row (snake_case columns from PostgreSQL). */
interface TopicRow {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
}

const RETURNING = 'id, organization_id, name';

/** Map a raw row to the validated shared {@link Topic} DTO. */
function toTopic(row: TopicRow): Topic {
  return topicSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
  });
}

/** Load a Topic's owning Organization id, or `null` when it is unknown. */
async function findOrganizationId(
  topicId: string,
  db: QueryExecutor,
): Promise<string | null> {
  const rows = await db.query<{ organization_id: string }>(
    'SELECT organization_id FROM topic WHERE id = $1',
    [topicId],
  );
  return rows[0]?.organization_id ?? null;
}

/**
 * Create a Topic within an Organization (`Org Owner` for owned orgs, or
 * `Admin`). A Topic is scoped to exactly one Organization grouping
 * (Requirement 35.2) and is never treated as a data-isolation boundary.
 */
export async function createTopic(
  actor: AuthContext,
  input: CreateTopicInput,
  db: QueryExecutor,
): Promise<Topic> {
  const { organizationId, name } = createTopicInputSchema.parse(input);

  requireCapability(actor, {
    capability: 'topic.manage',
    scope: { kind: 'organization', organizationId },
  });

  const rows = await db.query<TopicRow>(
    `INSERT INTO topic (organization_id, name) VALUES ($1, $2) RETURNING ${RETURNING}`,
    [organizationId, name],
  );

  return toTopic(rows[0]!);
}

/** Read a single Topic by id, or `null` when it does not exist. */
export async function getTopic(id: string, db: QueryExecutor): Promise<Topic | null> {
  const rows = await db.query<TopicRow>(`SELECT ${RETURNING} FROM topic WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? toTopic(row) : null;
}

/** List the Topics for one Organization, ordered by name. */
export async function listTopics(
  organizationId: string,
  db: QueryExecutor,
): Promise<Topic[]> {
  const rows = await db.query<TopicRow>(
    `SELECT ${RETURNING} FROM topic WHERE organization_id = $1 ORDER BY name ASC`,
    [organizationId],
  );
  return rows.map(toTopic);
}

/**
 * Update a Topic's mutable field (its name). Throws {@link NotFoundError} when
 * the Topic does not exist. Renaming a Topic does NOT retroactively change any
 * Document's already-stored "Writing Topic" metadata value — those are
 * independent per-document strings (Requirement 35.4).
 */
export async function updateTopic(
  actor: AuthContext,
  id: string,
  input: UpdateTopicInput,
  db: QueryExecutor,
): Promise<Topic> {
  const { name } = updateTopicInputSchema.parse(input);

  const organizationId = await findOrganizationId(id, db);
  if (organizationId === null) {
    throw new NotFoundError(`Topic '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'topic.manage',
    scope: { kind: 'organization', organizationId },
  });

  const rows = await db.query<TopicRow>(
    `UPDATE topic SET name = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, name],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Topic '${id}' not found`);
  }
  return toTopic(row);
}

/**
 * Count `document` rows whose "Writing Topic" custom-metadata value matches
 * `topicName` (best-effort match on the JSONB `document.metadata` field: the
 * value is an independent per-document string, never a foreign key to
 * `topic.id`). Used only for the read-only deletion-impact report; never for
 * authorization and never to drive taxonomy/feedback.
 */
async function countDocumentsReferencingTopicName(
  topicName: string,
  db: QueryExecutor,
): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM document WHERE metadata ->> $2 = $1`,
    [topicName, WRITING_TOPIC_LABEL],
  );
  return rows[0]?.count ?? 0;
}

/**
 * Report the impact of removing a Topic — a best-effort count of Documents
 * whose "Writing Topic" custom-metadata value currently matches this Topic's
 * name — BEFORE any deletion, so the caller can present an explicit
 * confirmation (REQ-TOPIC-01 / Requirement 35.5). This is read-only: it never
 * deletes or alters anything, and deleting the Topic afterward will NOT cascade
 * into or blank the counted Documents' metadata — those values are independent
 * per-document strings, not a foreign key to `topic.id`, so Document data is
 * inherently preserved regardless of this report. Throws {@link NotFoundError}
 * when the Topic does not exist.
 */
export async function getTopicDeletionImpact(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<TopicDeletionImpact> {
  const organizationId = await findOrganizationId(id, db);
  if (organizationId === null) {
    throw new NotFoundError(`Topic '${id}' not found`);
  }

  requireCapability(actor, {
    capability: 'topic.manage',
    scope: { kind: 'organization', organizationId },
  });

  const rows = await db.query<TopicRow>(`SELECT ${RETURNING} FROM topic WHERE id = $1`, [id]);
  const topic = rows[0];
  if (!topic) {
    throw new NotFoundError(`Topic '${id}' not found`);
  }

  const documentCountReferencingName = await countDocumentsReferencingTopicName(
    topic.name,
    db,
  );

  return topicDeletionImpactSchema.parse({
    topicId: id,
    documentCountReferencingName,
  });
}

/**
 * Delete a Topic (`Org Owner` for owned orgs, or `Admin`). Returns `true` when
 * a row was removed, `false` when no Topic had that id. Callers SHOULD first
 * call {@link getTopicDeletionImpact} and obtain explicit confirmation when it
 * reports any referencing Documents (Requirement 35.5). Deletion never
 * cascades into or blanks any Document's stored "Writing Topic" metadata value
 * — that value is an independent per-document string, not a foreign key to
 * `topic.id`, so existing Document data is preserved by construction, not by
 * any special-cased logic here.
 */
export async function deleteTopic(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  const organizationId = await findOrganizationId(id, db);
  if (organizationId === null) {
    return false;
  }

  requireCapability(actor, {
    capability: 'topic.manage',
    scope: { kind: 'organization', organizationId },
  });

  const rows = await db.query<{ id: string }>('DELETE FROM topic WHERE id = $1 RETURNING id', [
    id,
  ]);
  return rows.length > 0;
}
