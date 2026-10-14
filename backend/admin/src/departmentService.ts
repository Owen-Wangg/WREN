/**
 * Department management (REQ-ORG-GROUPING-01 / Requirement 28).
 *
 * A Department is a GROUPING of Document Types, the DepartmentAdmins who
 * maintain them, department-wide Reference Material, and business Topics. It
 * owns NO Users — the `department` table carries no user foreign key and this
 * service never associates a User with a Department as ownership (Requirement
 * 28.1 / 28.2). It is never a data-isolation boundary.
 *
 * Departments are created implicitly via the joint DepartmentAdmin appointment
 * action in `roleAssignmentService.ts`, but can also be renamed/removed by a
 * DepartmentAdmin who administers them.
 *
 * Renaming and removing Departments are gated by the `department.manage`
 * capability, which the `@wren/auth` capability matrix grants to a
 * DepartmentAdmin within their administered Departments. Every mutation
 * re-checks the capability BEFORE touching the database and denies with no
 * mutation when disallowed (Requirements 36.2, 36.3).
 *
 * All persistence goes through the injected parameterized {@link QueryExecutor};
 * no value is ever interpolated into SQL (Requirement 39.2).
 */
import {
  createDepartmentInputSchema,
  departmentSchema,
  updateDepartmentInputSchema,
  updateDepartmentAskWrenPromptInputSchema,
  updateDepartmentPromptInputSchema,
  updateDepartmentVisibilityInputSchema,
  type AuthContext,
  type CreateDepartmentInput,
  type Department,
  type DepartmentVisibilityState,
  type UpdateDepartmentAskWrenPromptInput,
  type UpdateDepartmentInput,
  type UpdateDepartmentPromptInput,
  type UpdateDepartmentVisibilityInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';
import { assertGhostwritingFree, assertPromptInjectionFree } from './promptGuardrail';

/** Raw `department` row (snake_case columns from PostgreSQL). */
interface DepartmentRow {
  readonly id: string;
  readonly name: string;
  readonly prompt: string | null;
  readonly ask_wren_prompt?: string | null;
  readonly access_state?: 'OPEN' | 'LOCKED' | null;
  readonly visibility_state?: DepartmentVisibilityState | null;
  readonly viewer_can_discover?: boolean | null;
  readonly active_user_count?: string | number;
  readonly archived_at?: string | null;
}

/** The columns every read/write returns, in the shared DTO's field order. */
const RETURNING = 'id, name, prompt, access_state, visibility_state, archived_at';

/**
 * Columns returned by the Ask WREN prompt write path. Same as {@link RETURNING}
 * plus `ask_wren_prompt` so the updated DTO reflects the new value. Kept
 * separate so the widely-used {@link RETURNING} shape (and the many read paths
 * that depend on it) stay unchanged.
 */
const RETURNING_WITH_ASK_WREN =
  'id, name, prompt, ask_wren_prompt, access_state, visibility_state, archived_at';

/** Map a raw row to the validated shared {@link Department} DTO. */
function toDepartment(row: DepartmentRow): Department {
  return departmentSchema.parse({
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    // Only surface askWrenPrompt when the read path selected it; otherwise leave
    // it undefined so existing reads (which don't select it) parse unchanged.
    ...(row.ask_wren_prompt !== undefined ? { askWrenPrompt: row.ask_wren_prompt } : {}),
    accessState: row.access_state === 'LOCKED' || row.access_state === 'OPEN'
      ? row.access_state
      : 'OPEN',
    visibilityState: row.visibility_state === 'PERMITTED_ONLY' ? 'PERMITTED_ONLY' : 'VISIBLE',
    viewerCanDiscover: row.viewer_can_discover ?? true,
    activeUserCount: row.active_user_count !== undefined
      ? parseInt(String(row.active_user_count), 10)
      : undefined,
    archivedAt: row.archived_at ?? null,
  });
}

/** Read a single Department by id, or `null` when it does not exist. */
export async function getDepartment(
  id: string,
  db: QueryExecutor,
): Promise<Department | null> {
  const rows = await db.query<DepartmentRow>(
    `SELECT ${RETURNING_WITH_ASK_WREN} FROM department WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? toDepartment(row) : null;
}

/**
 * Create a new Department (TechnicalAdmin only — platform-level operation).
 */
export async function createDepartment(
  actor: AuthContext,
  input: CreateDepartmentInput,
  db: QueryExecutor,
): Promise<Department> {
  if (!actor.roles.includes('TechnicalAdmin')) {
    throw Object.assign(new Error('Only TechnicalAdmin may create departments'), { statusCode: 403 });
  }

  const { name } = createDepartmentInputSchema.parse(input);

  const rows = await db.query<DepartmentRow>(
    `INSERT INTO department (name) VALUES ($1) RETURNING ${RETURNING}`,
    [name],
  );

  return toDepartment(rows[0]!);
}

/**
 * List all active Department groupings, annotated with the current viewer's
 * discovery decision. The UI-only phase deliberately returns denied rows so
 * clients can filter them without treating visibility as a security boundary.
 */
export async function listDepartments(
  actor: AuthContext,
  db: QueryExecutor,
): Promise<Department[]> {
  const rows = await db.query<DepartmentRow>(
    `SELECT d.id, d.name, d.prompt, d.ask_wren_prompt, d.access_state, d.visibility_state, d.archived_at,
            -- Computed live (distinct document owners in the department) so it
            -- always matches listDepartmentUsers. The aggregate_counter
            -- 'active_users' row drifts because only the student create/delete
            -- paths maintain it (admin deletions, user removal, document-type
            -- changes and pre-existing data are not reflected).
            COALESCE(au.active_user_count, 0)::int AS active_user_count,
            CASE
              WHEN d.visibility_state = 'VISIBLE' THEN true
              WHEN $2::boolean THEN true
              WHEN d.id = ANY($3::uuid[]) THEN true
              WHEN EXISTS (
                SELECT 1
                FROM department_visibility_grant dvg
                WHERE dvg.department_id = d.id
                  AND dvg.user_id = $1
                  AND dvg.revoked_at IS NULL
              ) THEN true
              ELSE false
            END AS viewer_can_discover
     FROM department d
     LEFT JOIN (
       SELECT dt.department_id, COUNT(DISTINCT doc.owner_user_id) AS active_user_count
       FROM document doc
       JOIN document_type dt ON dt.id = doc.document_type_id
       GROUP BY dt.department_id
     ) au ON au.department_id = d.id
     WHERE d.archived_at IS NULL
     ORDER BY d.name ASC`,
    [
      actor.userId,
      actor.roles.includes('TechnicalAdmin'),
      actor.administeredDepartmentIds,
    ],
  );
  return rows.map(toDepartment);
}

/** Shape returned by {@link listDepartmentUsers}. */
export interface DepartmentUserSummary {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
}

/**
 * List users who have submitted at least one document to any document type
 * belonging to this department — the same definition as the `active_users`
 * aggregate counter.
 */
export async function listDepartmentUsers(
  departmentId: string,
  db: QueryExecutor,
  options?: { q?: string; limit?: number; offset?: number },
): Promise<{ users: DepartmentUserSummary[]; total: number }> {
  const search = options?.q?.trim() || null;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = await db.query<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    total: string;
  }>(
    `SELECT u.id, u.first_name, u.last_name, u.email,
            COUNT(*) OVER() AS total
     FROM app_user u
     WHERE EXISTS (
       SELECT 1 FROM document d
       JOIN document_type dt ON dt.id = d.document_type_id
       WHERE d.owner_user_id = u.id
         AND dt.department_id = $1
     )
     AND ($2::text IS NULL
          OR u.first_name ILIKE $2
          OR u.last_name  ILIKE $2
          OR u.email      ILIKE $2)
     ORDER BY u.last_name ASC, u.first_name ASC
     LIMIT $3 OFFSET $4`,
    [departmentId, search ? `%${search}%` : null, limit, offset],
  );

  const total = rows[0] ? parseInt(rows[0].total, 10) : 0;
  return {
    users: rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
    })),
    total,
  };
}

/**
 * Rename a Department (DepartmentAdmin for their administered Departments).
 * Throws {@link NotFoundError} when the Department does not exist.
 */
export async function renameDepartment(
  actor: AuthContext,
  id: string,
  input: UpdateDepartmentInput,
  db: QueryExecutor,
): Promise<Department> {
  requireCapability(actor, {
    capability: 'department.manage',
    scope: { kind: 'department', departmentId: id },
  });

  const { name } = updateDepartmentInputSchema.parse(input);

  const rows = await db.query<DepartmentRow>(
    `UPDATE department SET name = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, name],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Department '${id}' not found`);
  }
  return toDepartment(row);
}

/**
 * Update a Department's Feedback-Engine department prompt (`department.prompt`).
 *
 * Gated by `department.managePrompt`: a TechnicalAdmin at platform scope, or a
 * DepartmentAdmin scoped to an administered Department (a DepartmentAdmin of a
 * different Department is denied with no mutation).
 *
 * Both save-time guardrails run BEFORE any DB write (deny-with-no-mutation):
 * {@link assertGhostwritingFree} preserves the no-ghostwriting contract for
 * Feedback-Engine instructions, and {@link assertPromptInjectionFree} runs the
 * text through Bedrock Guardrails.
 *
 * Throws {@link NotFoundError} when the Department does not exist.
 */
export async function updateDepartmentPrompt(
  actor: AuthContext,
  id: string,
  input: UpdateDepartmentPromptInput,
  db: QueryExecutor,
): Promise<Department> {
  const scope = actor.roles.includes('TechnicalAdmin')
    ? { kind: 'platform' as const }
    : { kind: 'department' as const, departmentId: id };
  requireCapability(actor, { capability: 'department.managePrompt', scope });

  const { prompt } = updateDepartmentPromptInputSchema.parse(input);

  // Save-time guardrails — validated before the DB write (deny-with-no-mutation).
  if (prompt) {
    assertGhostwritingFree(prompt);
    await assertPromptInjectionFree(prompt);
  }

  const rows = await db.query<DepartmentRow>(
    `UPDATE department SET prompt = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, prompt],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Department '${id}' not found`);
  }
  return toDepartment(row);
}

/**
 * Update a Department's Ask WREN prompt text — the department-level Socratic
 * coaching context appended to Ask WREN's universal system prompt.
 *
 * Gated by `department.manageAskWrenPrompt`: a DepartmentAdmin for the
 * administered Department, or a TechnicalAdmin at platform scope (the Ask WREN
 * prompt is surfaced within the Technical Admin domain). Distinct from
 * `department.manage` (rename/removal, DepartmentAdmin-only) and from
 * {@link updateDepartmentPrompt} (the Feedback-Engine field, gated by
 * `department.managePrompt`). The prompt surfaces are independent — this never touches
 * `department.prompt`.
 *
 * Both save-time guardrails run BEFORE any DB write (deny-with-no-mutation,
 * mirroring `document_type_config`): {@link assertGhostwritingFree} rejects
 * instructions that would make Ask WREN produce replacement prose, and
 * {@link assertPromptInjectionFree} runs the text through Bedrock Guardrails
 * (fails closed when unconfigured). A rejection leaves the previously
 * persisted value untouched.
 *
 * Throws {@link NotFoundError} when the Department does not exist.
 */
export async function updateDepartmentAskWrenPrompt(
  actor: AuthContext,
  id: string,
  input: UpdateDepartmentAskWrenPromptInput,
  db: QueryExecutor,
): Promise<Department> {
  // Shared educational-content operation: a TechnicalAdmin edits it at platform
  // scope (the Ask WREN prompt lives in the Technical Admin domain), while a
  // DepartmentAdmin edits it scoped to an administered Department.
  const scope = actor.roles.includes('TechnicalAdmin')
    ? { kind: 'platform' as const }
    : { kind: 'department' as const, departmentId: id };
  requireCapability(actor, {
    capability: 'department.manageAskWrenPrompt',
    scope,
  });

  const { askWrenPrompt } = updateDepartmentAskWrenPromptInputSchema.parse(input);

  // Save-time guardrails — validated BEFORE any DB write, so a rejected save
  // leaves the previously persisted Ask WREN prompt entirely untouched.
  if (askWrenPrompt) {
    assertGhostwritingFree(askWrenPrompt);
    await assertPromptInjectionFree(askWrenPrompt);
  }

  const rows = await db.query<DepartmentRow>(
    `UPDATE department SET ask_wren_prompt = $2 WHERE id = $1 RETURNING ${RETURNING_WITH_ASK_WREN}`,
    [id, askWrenPrompt],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Department '${id}' not found`);
  }
  return toDepartment(row);
}

/**
 * Set department-wide student access (OPEN/LOCKED). TechnicalAdmin only.
 * Also syncs document_type.access_state in the department so catalog reads stay aligned.
 */
export async function setDepartmentAccessState(
  actor: AuthContext,
  id: string,
  accessState: 'OPEN' | 'LOCKED',
  db: QueryExecutor,
): Promise<Department> {
  if (!actor.roles.includes('TechnicalAdmin')) {
    throw Object.assign(new Error('TechnicalAdmin role required'), { statusCode: 403 });
  }
  if (accessState !== 'OPEN' && accessState !== 'LOCKED') {
    throw Object.assign(new Error("accessState must be 'OPEN' or 'LOCKED'"), { statusCode: 400 });
  }

  const rows = await db.query<DepartmentRow>(
    `UPDATE department SET access_state = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, accessState],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Department '${id}' not found`);
  }

  await db.query(
    `UPDATE document_type SET access_state = $2 WHERE department_id = $1`,
    [id, accessState],
  );

  return toDepartment(row);
}

export interface DepartmentVisibilityUpdateResult {
  readonly department: Department;
  readonly previousState: DepartmentVisibilityState;
  readonly changed: boolean;
}

/** Set student-catalog visibility without changing OPEN/LOCKED submission access. */
export async function setDepartmentVisibilityState(
  actor: AuthContext,
  id: string,
  input: UpdateDepartmentVisibilityInput,
  db: QueryExecutor,
): Promise<DepartmentVisibilityUpdateResult> {
  requireCapability(actor, {
    capability: 'departmentVisibility.manage',
    scope: { kind: 'department', departmentId: id },
  });
  const { visibilityState } = updateDepartmentVisibilityInputSchema.parse(input);
  // Handlers call this service inside a transaction. Locking the row serializes
  // overlapping state requests so each caller observes the last committed state
  // and emits at most one accurate transition audit.
  const existingRows = await db.query<DepartmentRow>(
    `SELECT ${RETURNING}
     FROM department
     WHERE id = $1 AND archived_at IS NULL
     FOR UPDATE`,
    [id],
  );
  const existingRow = existingRows[0];
  if (!existingRow) {
    throw new NotFoundError(`Department '${id}' not found`);
  }
  const existing = toDepartment({ ...existingRow, viewer_can_discover: true });

  const previousState = existing.visibilityState;
  if (previousState === visibilityState) {
    return { department: existing, previousState, changed: false };
  }

  const rows = await db.query<DepartmentRow>(
    `UPDATE department SET visibility_state = $2 WHERE id = $1 RETURNING ${RETURNING}`,
    [id, visibilityState],
  );
  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Department '${id}' not found`);
  }
  return {
    department: toDepartment({ ...row, viewer_can_discover: true }),
    previousState,
    changed: true,
  };
}

/**
 * Archive a Department (soft-delete). Sets `archived_at` to NOW() so the
 * department is invisible to students and blocks new submissions, but all
 * child data (document types, documents, student feedback) is preserved.
 *
 * TechnicalAdmin only — archiving is a platform-level operation.
 * Returns the archived Department DTO, or throws {@link NotFoundError}.
 */
export async function archiveDepartment(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<Department> {
  if (!actor.roles.includes('TechnicalAdmin')) {
    throw Object.assign(new Error('TechnicalAdmin role required'), { statusCode: 403 });
  }

  const rows = await db.query<DepartmentRow>(
    `UPDATE department SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING ${RETURNING}`,
    [id],
  );

  const row = rows[0];
  if (!row) {
    throw new NotFoundError(`Department '${id}' not found or already archived`);
  }
  return toDepartment(row);
}
