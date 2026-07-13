/**
 * Usage-limit configuration and current-usage reporting (REQ-USAGE-LIMITS-01
 * / Requirement 31; Task 13.1).
 *
 * A `TechnicalAdmin` configures usage limits at platform scope or per
 * Document Type (Requirement 31.1) — `usageLimit.configure` is a
 * TechnicalAdmin-only capability in the matrix (mirrors
 * `documentType.setAccessState`: a platform-level technical operation, not
 * educational content). Usage-limit configuration is persisted AGAINST the
 * scope it applies to, never as a tenant-isolation boundary (Requirement
 * 31.3) — there is no `department`/`organization` scope kind on
 * {@link UsageScope} at all, so a limit can never be accidentally scoped to
 * a "home Department."
 *
 * {@link getUsageReport} answers "how much of this scope's limit has been
 * consumed in the current period" (Requirement 31.2). It is read-only and
 * does NOT reserve/consume usage — attributing a feedback-generating action
 * to its applicable scopes and enforcing most-restrictive-wins is Task
 * 13.2's `checkAndReserve` (`UsageService` in design.md), built on top of
 * the `usage_counter` rows this module also reads.
 *
 * Every mutation re-checks `usageLimit.configure` BEFORE touching the
 * database and denies with no mutation when disallowed (Requirements 36.2,
 * 36.3).
 */
import {
  createUsageLimitInputSchema,
  updateUsageLimitInputSchema,
  usageLimitSchema,
  usageReportSchema,
  type AuthContext,
  type CreateUsageLimitInput,
  type UpdateUsageLimitInput,
  type UsageLimit,
  type UsageReport,
  type UsageScope,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';

/** Raw `usage_limit` row (snake_case columns from PostgreSQL, post-V4 rename). */
interface UsageLimitRow {
  readonly id: string;
  readonly scope_kind: 'platform' | 'documentType';
  readonly scope_id: string | null;
  readonly limit_value: number;
  readonly period: string;
}

/** Raw `usage_counter` row for the CURRENT period (one row per scope + period_start). */
interface UsageCounterRow {
  readonly scope_kind: 'platform' | 'documentType';
  readonly scope_id: string | null;
  readonly period_start: string | Date;
  readonly consumed: number;
}

const LIMIT_RETURNING = 'id, scope_kind, scope_id, limit_value, period';

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

/** Map a {@link UsageScope} to its flat `(scope_kind, scope_id)` DB representation. */
function scopeToColumns(scope: UsageScope): { scopeKind: 'platform' | 'documentType'; scopeId: string | null } {
  return scope.kind === 'platform'
    ? { scopeKind: 'platform', scopeId: null }
    : { scopeKind: 'documentType', scopeId: scope.documentTypeId };
}

/** Map the flat DB columns back to a {@link UsageScope}. */
function columnsToScope(scopeKind: 'platform' | 'documentType', scopeId: string | null): UsageScope {
  if (scopeKind === 'platform') {
    return { kind: 'platform' };
  }
  if (!scopeId) {
    throw new Error("Invariant violated: scope_kind 'documentType' requires a non-null scope_id");
  }
  return { kind: 'documentType', documentTypeId: scopeId };
}

/** Map a raw row to the validated shared {@link UsageLimit} DTO. */
function toUsageLimit(row: UsageLimitRow): UsageLimit {
  return usageLimitSchema.parse({
    id: row.id,
    scope: columnsToScope(row.scope_kind, row.scope_id),
    limitValue: row.limit_value,
    period: row.period,
  });
}

/**
 * Configure a usage limit at a scope (`TechnicalAdmin` only —
 * `usageLimit.configure`). Scope is `platform` or a specific Document Type
 * (Requirement 31.1); persisted against that scope alone (Requirement 31.3).
 */
export async function createUsageLimit(
  actor: AuthContext,
  input: CreateUsageLimitInput,
  db: QueryExecutor,
): Promise<UsageLimit> {
  const parsed = createUsageLimitInputSchema.parse(input);

  requireCapability(actor, {
    capability: 'usageLimit.configure',
    scope: { kind: 'platform' },
  });

  const { scopeKind, scopeId } = scopeToColumns(parsed.scope);

  const rows = await db.query<UsageLimitRow>(
    `INSERT INTO usage_limit (scope_kind, scope_id, limit_value, period)
     VALUES ($1, $2, $3, $4) RETURNING ${LIMIT_RETURNING}`,
    [scopeKind, scopeId, parsed.limitValue, parsed.period],
  );

  return toUsageLimit(rows[0]!);
}

/** Read a single usage limit by id, or `null` when it does not exist. */
export async function getUsageLimit(id: string, db: QueryExecutor): Promise<UsageLimit | null> {
  const rows = await db.query<UsageLimitRow>(
    `SELECT ${LIMIT_RETURNING} FROM usage_limit WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toUsageLimit(row) : null;
}

/** Look up the configured limit for a scope (`platform`, or one Document Type), if any. */
export async function getUsageLimitForScope(
  scope: UsageScope,
  db: QueryExecutor,
): Promise<UsageLimit | null> {
  const { scopeKind, scopeId } = scopeToColumns(scope);

  const rows =
    scopeKind === 'platform'
      ? await db.query<UsageLimitRow>(
          `SELECT ${LIMIT_RETURNING} FROM usage_limit WHERE scope_kind = 'platform'`,
        )
      : await db.query<UsageLimitRow>(
          `SELECT ${LIMIT_RETURNING} FROM usage_limit WHERE scope_kind = 'documentType' AND scope_id = $1`,
          [scopeId],
        );

  const row = rows[0];
  return row ? toUsageLimit(row) : null;
}

/** List every configured usage limit (`TechnicalAdmin` view of the full configuration). */
export async function listUsageLimits(db: QueryExecutor): Promise<UsageLimit[]> {
  const rows = await db.query<UsageLimitRow>(
    `SELECT ${LIMIT_RETURNING} FROM usage_limit ORDER BY scope_kind ASC, scope_id ASC NULLS FIRST`,
  );
  return rows.map(toUsageLimit);
}

/**
 * Update a usage limit's value and/or reset period (`TechnicalAdmin` only).
 * Throws {@link NotFoundError} when the limit does not exist.
 */
export async function updateUsageLimit(
  actor: AuthContext,
  id: string,
  input: UpdateUsageLimitInput,
  db: QueryExecutor,
): Promise<UsageLimit> {
  const patch = updateUsageLimitInputSchema.parse(input);

  requireCapability(actor, {
    capability: 'usageLimit.configure',
    scope: { kind: 'platform' },
  });

  const assignments: string[] = [];
  const params: unknown[] = [id];
  if (patch.limitValue !== undefined) {
    params.push(patch.limitValue);
    assignments.push(`limit_value = $${params.length}`);
  }
  if (patch.period !== undefined) {
    params.push(patch.period);
    assignments.push(`period = $${params.length}`);
  }

  if (assignments.length === 0) {
    const current = await getUsageLimit(id, db);
    if (!current) {
      throw new NotFoundError(`Usage limit '${id}' not found`);
    }
    return current;
  }

  const rows = await db.query<UsageLimitRow>(
    `UPDATE usage_limit SET ${assignments.join(', ')} WHERE id = $1 RETURNING ${LIMIT_RETURNING}`,
    params,
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Usage limit '${id}' not found`);
  }
  return toUsageLimit(row);
}

/**
 * Remove a usage limit (`TechnicalAdmin` only). Returns `true` when a row
 * was removed, `false` when no limit had that id.
 */
export async function deleteUsageLimit(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  requireCapability(actor, {
    capability: 'usageLimit.configure',
    scope: { kind: 'platform' },
  });

  const rows = await db.query<{ id: string }>(
    'DELETE FROM usage_limit WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}

/**
 * Report current usage against the configured limit for a scope
 * (Requirement 31.2 — "display current usage relative to the configured
 * limit"). Read-only: does not create, increment, or reset any counter.
 *
 * When no limit is configured for the scope, returns `null` — there is
 * nothing to report usage "relative to" (Requirement 31.2 presupposes a
 * configured limit exists). When a limit exists but no counter row has been
 * created yet for the current period, `consumed` reports as `0`.
 */
export async function getUsageReport(
  scope: UsageScope,
  currentPeriodStart: Date,
  db: QueryExecutor,
): Promise<UsageReport | null> {
  const limit = await getUsageLimitForScope(scope, db);
  if (limit === null) {
    return null;
  }

  const { scopeKind, scopeId } = scopeToColumns(scope);

  const counterRows =
    scopeKind === 'platform'
      ? await db.query<UsageCounterRow>(
          `SELECT scope_kind, scope_id, period_start, consumed FROM usage_counter
           WHERE scope_kind = 'platform' AND period_start = $1`,
          [currentPeriodStart],
        )
      : await db.query<UsageCounterRow>(
          `SELECT scope_kind, scope_id, period_start, consumed FROM usage_counter
           WHERE scope_kind = 'documentType' AND scope_id = $1 AND period_start = $2`,
          [scopeId, currentPeriodStart],
        );

  const consumed = counterRows[0]?.consumed ?? 0;
  const remaining = Math.max(0, limit.limitValue - consumed);

  return usageReportSchema.parse({
    scope,
    limitValue: limit.limitValue,
    consumed,
    remaining,
    periodStart: toIsoString(currentPeriodStart),
  });
}
