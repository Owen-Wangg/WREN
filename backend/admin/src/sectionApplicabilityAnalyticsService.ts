/**
 * Aggregated analytics for per-section debrief applicability votes
 * (follow-up to the student-facing section applicability feature).
 *
 * Reads from `debrief_section_applicability` — deliberately no user_id
 * column, same privacy design as `feedback_helpfulness_rating` (migration
 * 0009 / Requirement 43.2). The query aggregates in SQL so no raw per-student
 * rows reach app code.
 *
 * Auth: same capability pattern as {@link getHelpfulnessAnalytics} — only
 * DepartmentAdmins (scoped to administered departments) and TechnicalAdmins
 * may call this.
 */
import type { AuthContext } from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Aggregate vote counts for a single error category (debrief section). */
export interface SectionApplicabilityRow {
  /** `error_category.id` */
  categoryId: string;
  /** Human-readable category name from `error_category.name`. */
  categoryName: string;
  /** Number of "applicable" votes. */
  applicableCount: number;
  /** Number of "not applicable" votes. */
  notApplicableCount: number;
  /** Total votes (applicable + notApplicable). */
  total: number;
  /** `notApplicableCount / total * 100`, rounded to one decimal; null when total is 0. */
  notApplicablePct: number | null;
}

/** Full analytics result for the section applicability view. */
export interface SectionApplicabilityAnalyticsResult {
  /** Rows sorted descending by notApplicablePct (highest first), sections with zero responses excluded. */
  sections: SectionApplicabilityRow[];
  /** ISO timestamp of the most-recent vote included, or null if no votes exist. */
  asOf: string | null;
}

interface AggRow {
  category_id: string;
  category_name: string;
  applicable_count: string;
  not_applicable_count: string;
  total: string;
  as_of: string | null;
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
 * Aggregate "applicable" vs "not applicable" votes per debrief section for a
 * given document type.
 *
 * Scoping: votes are linked to documents (via `debrief_section_applicability
 * .document_id`), and documents belong to a document type. The join ensures
 * only votes belonging to documents of the requested type are counted.
 *
 * Performance: all aggregation happens in a single GROUP BY query; no raw
 * rows are fetched. The index `idx_section_applicability_debrief` on
 * `(document_id, draft_id)` supports the join; the additional filter on
 * `ec.document_type_id` is covered by the `error_category` PK.
 */
export async function getSectionApplicabilityAnalytics(
  actor: AuthContext,
  documentTypeId: string,
  db: QueryExecutor,
): Promise<SectionApplicabilityAnalyticsResult> {
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

  const rows = await db.query<AggRow>(
    `SELECT
       ec.id                                                         AS category_id,
       ec.name                                                       AS category_name,
       COUNT(*) FILTER (WHERE dsa.applicable = true)::text          AS applicable_count,
       COUNT(*) FILTER (WHERE dsa.applicable = false)::text         AS not_applicable_count,
       COUNT(*)::text                                                AS total,
       MAX(dsa.updated_at)::text                                     AS as_of
     FROM debrief_section_applicability dsa
     JOIN document d ON d.id = dsa.document_id
     JOIN error_category ec ON ec.id = dsa.error_category_id
     WHERE d.document_type_id = $1
       AND ec.document_type_id = $1
     GROUP BY ec.id, ec.name
     HAVING COUNT(*) > 0
     ORDER BY
       (COUNT(*) FILTER (WHERE dsa.applicable = false))::float / NULLIF(COUNT(*), 0) DESC,
       ec.name ASC`,
    [documentTypeId],
  );

  const asOf =
    rows.length > 0
      ? rows.reduce<string | null>((latest, r) => {
          if (!r.as_of) return latest;
          if (!latest) return r.as_of;
          return r.as_of > latest ? r.as_of : latest;
        }, null)
      : null;

  const sections: SectionApplicabilityRow[] = rows.map((r) => {
    const total = parseInt(r.total, 10);
    const notApplicableCount = parseInt(r.not_applicable_count, 10);
    const applicableCount = parseInt(r.applicable_count, 10);
    const notApplicablePct =
      total > 0 ? Math.round((notApplicableCount / total) * 1000) / 10 : null;
    return {
      categoryId: r.category_id,
      categoryName: r.category_name,
      applicableCount,
      notApplicableCount,
      total,
      notApplicablePct,
    };
  });

  return { sections, asOf };
}
