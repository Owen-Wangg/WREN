/**
 * Helpfulness-rating analytics (Requirements 16.1–16.5, 42.1, 42.2, 43.2).
 *
 * Reads from `feedback_helpfulness_rating` — a table that deliberately has no
 * user_id column — so no per-Student identity can leak through this service
 * even by a query-construction mistake (Requirement 43.2).
 *
 * Auth follows the same capability pattern as {@link getAnalytics}: only
 * DepartmentAdmins and TechnicalAdmins (via `analytics.view`) may call this.
 * A DepartmentAdmin may only query document types within their administered
 * departments (Requirement 42.1).
 */
import type { AuthContext } from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** A single anonymous comment entry returned to the admin. */
export interface HelpfulnessComment {
  helpful: boolean;
  comment: string;
  createdAt: string;
}

/** Aggregate helpfulness analytics for a document type. */
export interface HelpfulnessAnalyticsResult {
  helpful: number;
  notHelpful: number;
  total: number;
  /** Up to 20 most-recent comments, anonymous (no student identity). */
  comments: HelpfulnessComment[];
}

interface HelpfulnessCountRow {
  helpful: boolean;
  cnt: string;
}

interface CommentRow {
  helpful: boolean;
  comment: string;
  created_at: string | Date;
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Verify a document type exists and return its owning department id. */
async function getDepartmentId(
  documentTypeId: string,
  db: QueryExecutor,
): Promise<string> {
  const rows = await db.query<{ department_id: string }>(
    `SELECT department_id FROM document_type WHERE id = $1`,
    [documentTypeId],
  );
  if (rows.length === 0) {
    throw new NotFoundError(`Document Type '${documentTypeId}' not found`);
  }
  return rows[0].department_id;
}

/**
 * Get helpfulness-rating analytics for a document type, scoped by role.
 *
 * `documentTypeId` is required — unlike the aggregate counter endpoint which
 * can return platform-wide totals, helpfulness ratings are always per document
 * type (the donut chart is a per-document-type view in the admin UI).
 */
export async function getHelpfulnessAnalytics(
  actor: AuthContext,
  documentTypeId: string,
  db: QueryExecutor,
): Promise<HelpfulnessAnalyticsResult> {
  const departmentId = await getDepartmentId(documentTypeId, db);

  if (actor.roles.includes('TechnicalAdmin')) {
    requireCapability(actor, { capability: 'analytics.view', scope: { kind: 'platform' } });
  } else if (actor.roles.includes('DepartmentAdmin')) {
    requireCapability(actor, {
      capability: 'analytics.view',
      scope: { kind: 'documentType', documentTypeId, departmentId },
    });
  } else {
    requireCapability(actor, { capability: 'analytics.view', scope: { kind: 'platform' } });
    // Unreachable — requireCapability always throws for non-admin roles.
  }

  const [countRows, commentRows] = await Promise.all([
    db.query<HelpfulnessCountRow>(
      `SELECT helpful, COUNT(*) AS cnt
       FROM feedback_helpfulness_rating
       WHERE document_type_id = $1
       GROUP BY helpful`,
      [documentTypeId],
    ),
    db.query<CommentRow>(
      `SELECT helpful, comment, created_at
       FROM feedback_helpfulness_rating
       WHERE document_type_id = $1 AND comment IS NOT NULL AND comment <> ''
       ORDER BY created_at DESC
       LIMIT 20`,
      [documentTypeId],
    ),
  ]);

  let helpful = 0;
  let notHelpful = 0;
  for (const row of countRows) {
    const n = parseInt(row.cnt, 10);
    if (row.helpful) {
      helpful = n;
    } else {
      notHelpful = n;
    }
  }

  const comments: HelpfulnessComment[] = commentRows.map((r) => ({
    helpful: r.helpful,
    comment: r.comment,
    createdAt: toIsoString(r.created_at),
  }));

  return { helpful, notHelpful, total: helpful + notHelpful, comments };
}
