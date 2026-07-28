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
  updateDepartmentPromptInputSchema,
  type AuthContext,
  type CreateDepartmentInput,
  type Department,
  type UpdateDepartmentInput,
  type UpdateDepartmentPromptInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { NotFoundError } from './errors';
import { assertPromptInjectionFree } from './promptGuardrail';

/** Raw `department` row (snake_case columns from PostgreSQL). */
interface DepartmentRow {
  readonly id: string;
  readonly name: string;
  readonly prompt: string | null;
  readonly access_state?: 'OPEN' | 'LOCKED' | null;
  readonly active_user_count?: string | number;
}

/** The columns every read/write returns, in the shared DTO's field order. */
const RETURNING = 'id, name, prompt, access_state';

/** Map a raw row to the validated shared {@link Department} DTO. */
function toDepartment(row: DepartmentRow): Department {
  return departmentSchema.parse({
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    accessState: row.access_state === 'LOCKED' || row.access_state === 'OPEN'
      ? row.access_state
      : 'OPEN',
    activeUserCount: row.active_user_count !== undefined
      ? parseInt(String(row.active_user_count), 10)
      : undefined,
  });
}

/** Read a single Department by id, or `null` when it does not exist. */
export async function getDepartment(
  id: string,
  db: QueryExecutor,
): Promise<Department | null> {
  const rows = await db.query<DepartmentRow>(
    `SELECT ${RETURNING} FROM department WHERE id = $1`,
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

/** List all Department groupings, ordered by name. */
export async function listDepartments(
  db: QueryExecutor,
): Promise<Department[]> {
  const rows = await db.query<DepartmentRow>(
    `SELECT d.id, d.name, d.prompt, d.access_state,
            COUNT(DISTINCT doc.owner_user_id)::int AS active_user_count
     FROM department d
     LEFT JOIN document_type dt ON dt.department_id = d.id
     LEFT JOIN document doc ON doc.document_type_id = dt.id
     GROUP BY d.id, d.name, d.prompt, d.access_state
     ORDER BY d.name ASC`,
  );
  return rows.map(toDepartment);
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
 * Update a Department's department-level prompt text (TechnicalAdmin only —
 * this is a platform-level system prompt, not an educational content operation).
 * Throws {@link NotFoundError} when the Department does not exist.
 */
export async function updateDepartmentPrompt(
  actor: AuthContext,
  id: string,
  input: UpdateDepartmentPromptInput,
  db: QueryExecutor,
): Promise<Department> {
  if (!actor.roles.includes('TechnicalAdmin')) {
    throw Object.assign(new Error('TechnicalAdmin role required'), { statusCode: 403 });
  }

  const { prompt } = updateDepartmentPromptInputSchema.parse(input);

  // Prompt injection check — runs before DB write (deny-with-no-mutation).
  if (prompt) {
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

/**
 * Delete a Department grouping (DepartmentAdmin for their administered
 * Departments). Returns `true` when a row was removed, `false` when no
 * Department had that id.
 */
export async function deleteDepartment(
  actor: AuthContext,
  id: string,
  db: QueryExecutor,
): Promise<boolean> {
  requireCapability(actor, {
    capability: 'department.manage',
    scope: { kind: 'department', departmentId: id },
  });

  const rows = await db.query<{ id: string }>(
    'DELETE FROM department WHERE id = $1 RETURNING id',
    [id],
  );
  return rows.length > 0;
}
