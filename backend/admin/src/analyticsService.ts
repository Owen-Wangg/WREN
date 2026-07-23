/**
 * Aggregate-only analytics projections (REQ-AUDIT-01 / REQ-AUDIT-01b /
 * REQ-AUDIT-01c / REQ-AUDIT-OPSTATE-01 / REQ-PROGRESS-AGG-01 — Requirements
 * 19, 40, 41, 42, 43; Task 14.3).
 *
 * This module is the ONLY analytics read surface the Admin_Service exposes,
 * and it deliberately projects `aggregate_counter` rows ONLY:
 *
 *   - {@link getAnalytics} NEVER queries `feedback_item`, `resolution_status_
 *     history`, `document`, or any other per-Student operational table
 *     directly — those are per-Student operational state (Requirement 43.1)
 *     that survives only for the owning Student's own experience (Requirement
 *     43.3) and is deleted with its Document (Requirement 43.4). Computing
 *     analytics from `aggregate_counter`/`activity_event` instead means
 *     analytics keep working after a Document (and its per-Student state) is
 *     deleted (Requirement 40.5, 41.5) — see Task 14.5.
 *   - Every row `aggregate_counter` holds is already an all-users total (its
 *     schema has no per-Student column at all — see `AggregateCounter` in
 *     `@wren/types`), so there is no per-Student value this module could leak
 *     even by a query-construction mistake (Requirement 43.2).
 *   - Both roles get an identically-shaped {@link AnalyticsResult}; only the
 *     SCOPE differs — DepartmentAdmin sees totals for Document Types within
 *     Departments they administer, TechnicalAdmin sees platform-wide totals —
 *     enforced by `analytics.view` in the `@wren/auth` capability matrix
 *     (never a parallel scheme, Requirements 36.2, 36.3).
 *
 * The writer-facing (Student) progress experience never calls this module —
 * it has no numeric-indicator capability at all under `analytics.view` — so
 * Requirement 41.4/42.4 ("numeric aggregate indicators never appear in the
 * writer-facing progress experience") holds structurally: there is no code
 * path from a Student's `AuthContext` into {@link getAnalytics} that survives
 * the capability check.
 */
import {
  analyticsResultSchema,
  type AggregateCounter,
  type AnalyticsQuery,
  type AnalyticsResult,
  type AuthContext,
} from '@wren/types';

export interface CategoryTrendPoint {
  readonly week: string;         // ISO week label e.g. "2024-W03"
  readonly weekStart: string;    // ISO date of Monday that starts the week
  readonly categoryId: string;
  readonly categoryName: string;
  readonly score: number;        // 0–100: avg resolution score for that week
  readonly sampleSize: number;   // how many resolution events contributed
}

export interface ImprovementTrendsResult {
  readonly trends: CategoryTrendPoint[];
}

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { listDocumentTypes } from './documentTypeService';
import { NotFoundError } from './errors';

/** Raw `aggregate_counter` row (snake_case columns from PostgreSQL). */
interface AggregateCounterRow {
  readonly id: string;
  readonly scope_kind: 'platform' | 'documentType';
  readonly scope_id: string | null;
  readonly metric: string;
  readonly window_start: string | Date;
  readonly value: number;
}

const RETURNING = 'id, scope_kind, scope_id, metric, window_start, value';

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toAggregateCounter(row: AggregateCounterRow): AggregateCounter {
  return {
    id: row.id,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id ?? undefined,
    metric: row.metric,
    windowStart: toIsoString(row.window_start),
    value: row.value,
  };
}

/** Look up a Document Type's owning Department id, or `null` when unknown. */
async function findDepartmentId(
  documentTypeId: string,
  db: QueryExecutor,
): Promise<string | null> {
  const rows = await db.query<{ department_id: string }>(
    'SELECT department_id FROM document_type WHERE id = $1',
    [documentTypeId],
  );
  return rows[0]?.department_id ?? null;
}

/** Every Document Type id across a set of Departments. */
async function documentTypeIdsForDepartments(
  departmentIds: readonly string[],
  db: QueryExecutor,
): Promise<string[]> {
  const perDepartment = await Promise.all(
    departmentIds.map((departmentId) => listDocumentTypes(departmentId, db)),
  );
  return perDepartment.flat().map((documentType) => documentType.id);
}

/** Fetch `aggregate_counter` rows for an explicit list of `documentType`-scope ids. */
async function countersForDocumentTypes(
  documentTypeIds: readonly string[],
  db: QueryExecutor,
): Promise<AggregateCounter[]> {
  if (documentTypeIds.length === 0) {
    return [];
  }
  const rows = await db.query<AggregateCounterRow>(
    `SELECT ${RETURNING} FROM aggregate_counter
     WHERE scope_kind = 'documentType' AND scope_id = ANY($1)
     ORDER BY metric ASC, window_start ASC, scope_id ASC`,
    [documentTypeIds],
  );
  return rows.map(toAggregateCounter);
}

/** Fetch every `platform`-scope `aggregate_counter` row. */
async function platformCounters(db: QueryExecutor): Promise<AggregateCounter[]> {
  const rows = await db.query<AggregateCounterRow>(
    `SELECT ${RETURNING} FROM aggregate_counter WHERE scope_kind = 'platform'
     ORDER BY metric ASC, window_start ASC`,
  );
  return rows.map(toAggregateCounter);
}

/**
 * Aggregate analytics for a `TechnicalAdmin`: platform-wide totals, or
 * (when `query.documentTypeId` is supplied) totals for that one Document
 * Type only (Requirement 41.1, 41.2).
 */
async function technicalAdminAnalytics(
  query: AnalyticsQuery,
  db: QueryExecutor,
): Promise<AggregateCounter[]> {
  if (query.documentTypeId) {
    return countersForDocumentTypes([query.documentTypeId], db);
  }
  return platformCounters(db);
}

/**
 * Aggregate analytics for a `DepartmentAdmin`: totals for Document Types
 * within Departments they administer, optionally filtered to one Document
 * Type (Requirement 42.1, 42.2) — NEVER a Document Type outside an
 * administered Department (Requirement 42.1's negative clause), enforced by
 * checking the filtered Document Type's owning Department against
 * `actor.administeredDepartmentIds` before running any query.
 */
async function departmentAdminAnalytics(
  actor: AuthContext,
  query: AnalyticsQuery,
  db: QueryExecutor,
): Promise<AggregateCounter[]> {
  if (query.documentTypeId) {
    const departmentId = await findDepartmentId(query.documentTypeId, db);
    if (departmentId === null) {
      throw new NotFoundError(`Document Type '${query.documentTypeId}' not found`);
    }
    requireCapability(actor, {
      capability: 'analytics.view',
      scope: { kind: 'documentType', documentTypeId: query.documentTypeId, departmentId },
    });
    return countersForDocumentTypes([query.documentTypeId], db);
  }

  // No Document Type filter: aggregate across every Document Type in every
  // Department the actor administers. Re-check the capability per
  // administered Department (defense-in-depth against a future change to
  // `requireCapability`'s semantics); an actor who administers NO Department
  // yields an empty totals list, not an error — "no Department Types in
  // scope" is a valid (if unusual) authorized result, not a denial.
  for (const departmentId of actor.administeredDepartmentIds) {
    requireCapability(actor, {
      capability: 'analytics.view',
      scope: { kind: 'department', departmentId },
    });
  }
  const documentTypeIds = await documentTypeIdsForDepartments(
    actor.administeredDepartmentIds,
    db,
  );
  return countersForDocumentTypes(documentTypeIds, db);
}

/**
 * Get all-users aggregate analytics for `actor`, scoped per role
 * (Requirements 19.1, 40.1-40.6, 41.1-41.6, 42.1-42.5, 43.2):
 *
 *   - `TechnicalAdmin` → platform-wide, filterable by Document Type.
 *   - `DepartmentAdmin` → Document Types within administered Departments,
 *     filterable by Document Type (never one outside an administered
 *     Department).
 *
 * Re-checks `analytics.view` BEFORE running any query and denies with no
 * data returned when disallowed (Requirements 36.2, 36.3). When an actor
 * holds both roles, TechnicalAdmin's platform-wide view takes precedence
 * (mirrors the OR-semantics of the capability matrix: the actor is
 * authorized either way, and platform-wide is the more permissive result).
 */
export async function getAnalytics(
  actor: AuthContext,
  query: AnalyticsQuery,
  db: QueryExecutor,
): Promise<AnalyticsResult> {
  if (actor.roles.includes('TechnicalAdmin')) {
    requireCapability(actor, { capability: 'analytics.view', scope: { kind: 'platform' } });
    const totals = await technicalAdminAnalytics(query, db);
    return analyticsResultSchema.parse({ totals });
  }

  if (actor.roles.includes('DepartmentAdmin')) {
    const totals = await departmentAdminAnalytics(actor, query, db);
    return analyticsResultSchema.parse({ totals });
  }

  requireCapability(actor, { capability: 'analytics.view', scope: { kind: 'platform' } });
  // Unreachable: requireCapability always throws for a Student/no-role actor.
  return analyticsResultSchema.parse({ totals: [] });
}

/**
 * Improvement trends: per-category resolution rates bucketed into calendar
 * weeks, for a single document type.
 *
 * Scoring (all-users aggregate — no per-student column):
 *   resolved            → 100
 *   partially_resolved  →  50
 *   still_unresolved    →   0
 *   removed / unchanged → excluded (structural change, not a signal)
 *
 * Only DepartmentAdmin (for their administered departments) and TechnicalAdmin
 * may call this. Same `analytics.view` capability gate as getAnalytics.
 */
export async function getImprovementTrends(
  actor: AuthContext,
  documentTypeId: string,
  db: QueryExecutor,
): Promise<ImprovementTrendsResult> {
  // Authorization: same gate as getAnalytics
  const departmentId = await findDepartmentId(documentTypeId, db);
  if (departmentId === null) {
    throw new NotFoundError(`Document Type '${documentTypeId}' not found`);
  }
  requireCapability(actor, {
    capability: 'analytics.view',
    scope: { kind: 'documentType', documentTypeId, departmentId },
  });

  // Aggregate resolution events by ISO week + error category.
  // We never expose individual student rows — all GROUP BY aggregation.
  const rows = await db.query<{
    week_label: string;
    week_start: string;
    category_id: string;
    category_name: string;
    avg_score: number;
    sample_size: number;
  }>(
    `SELECT
       to_char(date_trunc('week', rsh.evaluated_at), 'IYYY-"W"IW') AS week_label,
       date_trunc('week', rsh.evaluated_at)::date::text            AS week_start,
       ec.id                                                        AS category_id,
       ec.name                                                      AS category_name,
       AVG(
         CASE rsh.status
           WHEN 'resolved'           THEN 100.0
           WHEN 'partially_resolved' THEN  50.0
           WHEN 'still_unresolved'   THEN   0.0
           ELSE NULL
         END
       )::numeric(5,1)                                             AS avg_score,
       COUNT(CASE WHEN rsh.status IN (
         'resolved','partially_resolved','still_unresolved'
       ) THEN 1 END)::int                                          AS sample_size
     FROM resolution_status_history rsh
     JOIN feedback_item             fi  ON fi.id  = rsh.feedback_item_id
     JOIN error_category            ec  ON ec.id  = fi.error_category_id
     WHERE ec.document_type_id = $1
     GROUP BY 1, 2, 3, 4
     HAVING COUNT(CASE WHEN rsh.status IN (
       'resolved','partially_resolved','still_unresolved'
     ) THEN 1 END) > 0
     ORDER BY 2 ASC, 4 ASC`,
    [documentTypeId],
  );

  const trends: CategoryTrendPoint[] = rows.map((r) => ({
    week: r.week_label,
    weekStart: r.week_start,
    categoryId: r.category_id,
    categoryName: r.category_name,
    score: Number(r.avg_score),
    sampleSize: r.sample_size,
  }));

  return { trends };
}
