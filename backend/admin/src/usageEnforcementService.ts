/**
 * Multi-scope usage attribution and most-restrictive-wins enforcement
 * (REQ-TOKEN-LIMIT-01 / Requirement 54; Task 13.2).
 *
 * Every feedback-generating action is attributed to EVERY scope it falls
 * under: the target Document Type and the platform (Requirement 54.2).
 * There is deliberately no "home Department" scope — a Student is global,
 * and Departments are never a usage-attribution or data-isolation boundary
 * (design.md "Departments are groupings, not isolated tenants").
 *
 * {@link checkAndReserve} implements the design's `UsageService.checkAndReserve`
 * contract: it evaluates every applicable scope's limit (adjusted for an
 * active {@link ActiveOverride} on the Document-Type scope, Requirement
 * 54.8), blocks the action if ANY applicable scope is at its limit
 * (most-restrictive-wins, Requirement 54.3), and — only when every scope
 * permits it — atomically increments every applicable scope's counter for
 * the current period (an action is never partially reserved: either every
 * scope's counter advances together, or none do).
 *
 * This module builds on `usageLimitService.ts` (Task 13.1)'s
 * `usage_limit`/`usage_counter` tables and adds no new tables of its own.
 */
import type { QueryExecutor } from './db';
import { getUsageLimitForScope } from './usageLimitService';

/** Raw `usage_counter` row (snake_case columns from PostgreSQL). */
interface UsageCounterRow {
  readonly scope_kind: 'platform' | 'documentType';
  readonly scope_id: string | null;
  readonly period_start: string | Date;
  readonly consumed: number;
}

/** An active override raising the effective bound for one (user, Document Type) pair. */
export interface ActiveOverride {
  readonly additionalActions: number;
}

/**
 * The outcome of a {@link checkAndReserve} call. `blockedScope` and
 * `message` are populated only when `allowed` is `false`, and `message`
 * always names the specific scope that blocked the action (Requirement
 * 54.4 — "a clear message stating which scope's limit was reached").
 */
export interface UsageDecision {
  readonly allowed: boolean;
  readonly blockedScope?: 'platform' | 'documentType';
  readonly message?: string;
}

/** One feedback-generating action to attribute and (if allowed) reserve usage for. */
export interface FeedbackAction {
  readonly userId: string;
  readonly documentTypeId: string;
}

/**
 * Determine the applicable scopes for a feedback-generating action
 * (Requirement 54.2): always the target Document Type AND the platform —
 * never a "home Department." Exposed separately from {@link checkAndReserve}
 * so attribution itself is directly testable/inspectable.
 */
export function applicableScopes(
  action: FeedbackAction,
): Array<{ kind: 'platform' } | { kind: 'documentType'; documentTypeId: string }> {
  return [{ kind: 'platform' }, { kind: 'documentType', documentTypeId: action.documentTypeId }];
}

/** Load the current period's counter value for a scope, or `0` if no row exists yet. */
async function readConsumed(
  scopeKind: 'platform' | 'documentType',
  scopeId: string | null,
  periodStart: Date,
  db: QueryExecutor,
): Promise<number> {
  const rows =
    scopeKind === 'platform'
      ? await db.query<UsageCounterRow>(
          `SELECT scope_kind, scope_id, period_start, consumed FROM usage_counter
           WHERE scope_kind = 'platform' AND period_start = $1`,
          [periodStart],
        )
      : await db.query<UsageCounterRow>(
          `SELECT scope_kind, scope_id, period_start, consumed FROM usage_counter
           WHERE scope_kind = 'documentType' AND scope_id = $1 AND period_start = $2`,
          [scopeId, periodStart],
        );
  return rows[0]?.consumed ?? 0;
}

/** Atomically upsert-increment a scope's counter for the current period by one. */
async function incrementConsumed(
  scopeKind: 'platform' | 'documentType',
  scopeId: string | null,
  periodStart: Date,
  db: QueryExecutor,
): Promise<void> {
  await db.query(
    `INSERT INTO usage_counter (scope_kind, scope_id, period_start, consumed)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (scope_kind, scope_id, period_start) DO UPDATE SET consumed = usage_counter.consumed + 1`,
    [scopeKind, scopeId, periodStart],
  );
}

/**
 * Check every applicable scope's limit for `action` and, only if every
 * scope permits it, atomically reserve (increment) usage in all of them
 * for `periodStart` (Requirement 54.1, 54.2, 54.3).
 *
 * `activeOverride`, when supplied, raises the Document-Type scope's
 * effective bound by `additionalActions` (Requirement 54.8 — "allow the
 * affected Student's feedback-generating actions up to the override's
 * bounds"); it never affects the platform scope, since an override is
 * always Document-Type-scoped (Requirement 54.5).
 *
 * A scope with NO configured limit is treated as unbounded for that scope
 * (nothing to enforce there) — but the action is still attributed to it and
 * its counter still increments on success, so future limit configuration
 * changes see accurate historical consumption.
 */
export async function checkAndReserve(
  action: FeedbackAction,
  periodStart: Date,
  db: QueryExecutor,
  activeOverride: ActiveOverride | null = null,
): Promise<UsageDecision> {
  const scopes = applicableScopes(action);

  // Phase 1: check every applicable scope BEFORE reserving anything, so a
  // blocked action never partially increments some scopes but not others.
  for (const scope of scopes) {
    const limit = await getUsageLimitForScope(scope, db);
    if (limit === null) {
      continue; // No configured limit at this scope — nothing to enforce.
    }

    const scopeId = scope.kind === 'documentType' ? scope.documentTypeId : null;
    const consumed = await readConsumed(scope.kind, scopeId, periodStart, db);

    const effectiveLimit =
      scope.kind === 'documentType' && activeOverride
        ? limit.limitValue + activeOverride.additionalActions
        : limit.limitValue;

    if (consumed >= effectiveLimit) {
      const scopeDescription =
        scope.kind === 'platform' ? 'the platform' : `Document Type '${scope.documentTypeId}'`;
      return {
        allowed: false,
        blockedScope: scope.kind,
        message: `Usage limit reached for ${scopeDescription} (${consumed}/${effectiveLimit} this period).`,
      };
    }
  }

  // Phase 2: every applicable scope permits the action — reserve usage in
  // ALL of them together (Requirement 54.2's "attribute to every scope").
  for (const scope of scopes) {
    const scopeId = scope.kind === 'documentType' ? scope.documentTypeId : null;
    await incrementConsumed(scope.kind, scopeId, periodStart, db);
  }

  return { allowed: true };
}
