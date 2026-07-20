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

/** Raw `department` row (snake_case columns from PostgreSQL). */
interface DepartmentRow {
  readonly id: string;
  readonly name: string;
  readonly prompt: string | null;
}

/** The columns every read/write returns, in the shared DTO's field order. */
const RETURNING = 'id, name, prompt';

/** Map a raw row to the validated shared {@link Department} DTO. */
function toDepartment(row: DepartmentRow): Department {
  return departmentSchema.parse({
    id: row.id,
    name: row.name,
    prompt: row.prompt,
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
    `SELECT ${RETURNING} FROM department ORDER BY name ASC`,
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
 * Update a Department's department-level prompt text. Scoped to TechnicalAdmin
 * or DepartmentAdmin who administers this department (`department.manage`).
 * Throws {@link NotFoundError} when the Department does not exist.
 */
export async function updateDepartmentPrompt(
  actor: AuthContext,
  id: string,
  input: UpdateDepartmentPromptInput,
  db: QueryExecutor,
): Promise<Department> {
  requireCapability(actor, {
    capability: 'department.manage',
    scope: { kind: 'department', departmentId: id },
  });

  const { prompt } = updateDepartmentPromptInputSchema.parse(input);

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
