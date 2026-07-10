/**
 * In-memory fake of the parameterized {@link QueryExecutor} for Admin_Service
 * unit tests.
 *
 * It stores `department`, `document_type`, `content_type`, and
 * `custom_metadata_field` rows in Maps (plus minimal `document` and
 * `role_assignment` rows used only for the Document Type deletion-impact count)
 * and interprets the exact parameterized statements the services issue —
 * binding `$1..$N` from the supplied params array, never interpolating them —
 * so the tests exercise the REAL service logic (capability checks, row↔DTO
 * mapping, ordering, partial updates, RETURNING semantics) rather than mocking
 * service behavior. The live `postgres` driver / schema is covered separately
 * by `@wren/db-node` and the migration schema tests.
 *
 * `mutationCount` records how many INSERT/UPDATE/DELETE statements actually ran,
 * so a test can assert that a denied operation performed NO mutation.
 */
import type { QueryExecutor } from './db';

interface DepartmentRow {
  id: string;
  name: string;
}

interface DocumentTypeRow {
  id: string;
  department_id: string;
  name: string;
  access_state: string;
  size_limit_words: number | null;
}

interface ContentTypeRow {
  id: string;
  document_type_id: string;
  label: string;
}

interface TopicRow {
  id: string;
  department_id: string;
  name: string;
}

interface CustomMetadataFieldRow {
  id: string;
  document_type_id: string;
  label: string;
  required: boolean;
}

/**
 * Minimal `document` row — only the columns the deletion-impact counts need.
 * `metadata` is optional so existing Document-Type-impact seeds (which don't
 * care about metadata) keep working unchanged.
 */
interface DocumentRow {
  id: string;
  document_type_id: string;
  metadata?: Record<string, string>;
}

/** `role_assignment` row (authorization source of truth). */
interface RoleAssignmentRow {
  id: string;
  user_id: string;
  role: string;
  scope: { departmentId?: string } | null;
  granted_by: string | null;
}

/** `app_user` row (global User; carries no Department ownership column). */
interface AppUserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

/** `access_grant` row. Flat shape: `{document_type_id}`. */
interface AccessGrantRow {
  id: string;
  user_id: string;
  document_type_id: string;
  granted_by: string;
  granted_at: Date;
  revoked_at: Date | null;
}

const collapse = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Apply `col = $n` assignments from a SET clause to a mutable record. */
function applyAssignments(
  setClause: string,
  record: Record<string, unknown>,
  params: readonly unknown[],
): void {
  const re = /(\w+)\s*=\s*\$(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(setClause)) !== null) {
    const column = match[1]!;
    const paramIndex = Number(match[2]) - 1;
    record[column] = params[paramIndex];
  }
}

export class FakeDb implements QueryExecutor {
  public readonly departments = new Map<string, DepartmentRow>();
  public readonly documentTypes = new Map<string, DocumentTypeRow>();
  public readonly contentTypes = new Map<string, ContentTypeRow>();
  public readonly topics = new Map<string, TopicRow>();
  public readonly customMetadataFields = new Map<string, CustomMetadataFieldRow>();
  public readonly documents = new Map<string, DocumentRow>();
  public readonly roleAssignments = new Map<string, RoleAssignmentRow>();
  public readonly appUsers = new Map<string, AppUserRow>();
  public readonly accessGrants = new Map<string, AccessGrantRow>();
  public mutationCount = 0;

  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  /** Seed a Department directly (bypasses authorization) for test setup. */
  public seedDepartment(row: Partial<DepartmentRow> & { id: string }): DepartmentRow {
    const full: DepartmentRow = {
      id: row.id,
      name: row.name ?? 'Seed Dept',
    };
    this.departments.set(full.id, full);
    return full;
  }

  /** Seed a Document Type directly (bypasses authorization) for test setup. */
  public seedDocumentType(
    row: Partial<DocumentTypeRow> & { id: string; department_id: string },
  ): DocumentTypeRow {
    const full: DocumentTypeRow = {
      id: row.id,
      department_id: row.department_id,
      name: row.name ?? 'Seed Type',
      access_state: row.access_state ?? 'LOCKED',
      size_limit_words: row.size_limit_words ?? null,
    };
    this.documentTypes.set(full.id, full);
    return full;
  }

  /** Seed a Content Type directly (bypasses authorization) for test setup. */
  public seedContentType(
    row: Partial<ContentTypeRow> & { id: string; document_type_id: string },
  ): ContentTypeRow {
    const full: ContentTypeRow = {
      id: row.id,
      document_type_id: row.document_type_id,
      label: row.label ?? 'Seed Content Type',
    };
    this.contentTypes.set(full.id, full);
    return full;
  }

  /** Seed a Topic directly (bypasses authorization) for test setup. */
  public seedTopic(row: Partial<TopicRow> & { id: string; department_id: string }): TopicRow {
    const full: TopicRow = {
      id: row.id,
      department_id: row.department_id,
      name: row.name ?? 'Seed Topic',
    };
    this.topics.set(full.id, full);
    return full;
  }

  /** Seed a custom metadata field directly (bypasses authorization). */
  public seedCustomMetadataField(
    row: Partial<CustomMetadataFieldRow> & { id: string; document_type_id: string },
  ): CustomMetadataFieldRow {
    const full: CustomMetadataFieldRow = {
      id: row.id,
      document_type_id: row.document_type_id,
      label: row.label ?? 'Seed Field',
      required: row.required ?? false,
    };
    this.customMetadataFields.set(full.id, full);
    return full;
  }

  /** Seed a Document directly (bypasses authorization) for deletion-impact tests. */
  public seedDocument(row: {
    id: string;
    document_type_id: string;
    metadata?: Record<string, string>;
  }): DocumentRow {
    this.documents.set(row.id, row);
    return row;
  }

  /**
   * Seed a `role_assignment` row directly for test setup. `scope` is JSONB
   * shaped `{departmentId: "..."}` for `DepartmentAdmin`, or `null` for a
   * global role (`Student`/`TechnicalAdmin`).
   */
  public seedRoleAssignment(row: {
    id: string;
    role: string;
    scope: { departmentId?: string } | null;
    user_id?: string;
    granted_by?: string | null;
  }): RoleAssignmentRow {
    const full: RoleAssignmentRow = {
      id: row.id,
      user_id: row.user_id ?? 'seed-user',
      role: row.role,
      scope: row.scope,
      granted_by: row.granted_by ?? null,
    };
    this.roleAssignments.set(row.id, full);
    return full;
  }

  /** Seed a global `app_user` row directly (bypasses authorization) for test setup. */
  public seedAppUser(row: Partial<AppUserRow> & { id: string }): AppUserRow {
    const full: AppUserRow = {
      id: row.id,
      email: row.email ?? `${row.id}@example.com`,
      first_name: row.first_name ?? 'Seed',
      last_name: row.last_name ?? 'User',
    };
    this.appUsers.set(full.id, full);
    return full;
  }

  /** Seed an `access_grant` row directly (bypasses authorization) for test setup. */
  public seedAccessGrant(
    row: Partial<AccessGrantRow> & { id: string; user_id: string; document_type_id: string },
  ): AccessGrantRow {
    const full: AccessGrantRow = {
      id: row.id,
      user_id: row.user_id,
      document_type_id: row.document_type_id,
      granted_by: row.granted_by ?? 'seed-granter',
      granted_at: row.granted_at ?? new Date(),
      revoked_at: row.revoked_at ?? null,
    };
    this.accessGrants.set(full.id, full);
    return full;
  }

  /**
   * Apply the four ILIKE/role filters used by `userService.searchUsers`
   * (params 0-3: firstName/lastName/email patterns + exact role, or `null` to
   * skip that filter), sorted the same way as the real `ORDER BY` clause.
   */
  private matchAppUsers(params: readonly unknown[]): AppUserRow[] {
    const [firstNamePattern, lastNamePattern, emailPattern, role] = params as [
      string | null,
      string | null,
      string | null,
      string | null,
    ];

    const matchesLike = (value: string, pattern: string | null): boolean => {
      if (pattern === null) return true;
      const needle = pattern.slice(1, -1).toLowerCase();
      return value.toLowerCase().includes(needle);
    };

    return [...this.appUsers.values()]
      .filter(
        (u) =>
          matchesLike(u.first_name, firstNamePattern) &&
          matchesLike(u.last_name, lastNamePattern) &&
          matchesLike(u.email, emailPattern) &&
          (role === null ||
            [...this.roleAssignments.values()].some(
              (r) => r.user_id === u.id && r.role === role,
            )),
      )
      .sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
  }

  public async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    const sql = collapse(text);

    /* ------------------------------ department ------------------------------ */

    if (sql.startsWith('INSERT INTO department (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING')) {
      const id = params[0] as string;
      if (this.departments.has(id)) {
        // Conflict: department already exists — DO NOTHING, no mutation.
        return [] as unknown as Row[];
      }
      this.mutationCount += 1;
      const row: DepartmentRow = {
        id,
        name: params[1] as string,
      };
      this.departments.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO department (id, name) VALUES ($1, $2)')) {
      this.mutationCount += 1;
      const row: DepartmentRow = {
        id: params[0] as string,
        name: params[1] as string,
      };
      this.departments.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT id FROM department WHERE id = $1')) {
      const row = this.departments.get(params[0] as string);
      return (row ? [{ id: row.id }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, name FROM department WHERE id = $1')) {
      const row = this.departments.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, name FROM department ORDER BY name ASC')) {
      const rows = [...this.departments.values()]
        .map((r) => ({ ...r }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE department SET')) {
      const row = this.departments.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE department SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM department WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.departments.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* ----------------------------- document_type ----------------------------- */

    if (sql.startsWith('INSERT INTO document_type (department_id, name, size_limit_words)')) {
      this.mutationCount += 1;
      const row: DocumentTypeRow = {
        id: this.nextId('dt'),
        department_id: params[0] as string,
        name: params[1] as string,
        access_state: 'LOCKED',
        size_limit_words: (params[2] as number | null) ?? null,
      };
      this.documentTypes.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT department_id FROM document_type WHERE id = $1')) {
      const row = this.documentTypes.get(params[0] as string);
      return (row ? [{ department_id: row.department_id }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, department_id, name, access_state, size_limit_words FROM document_type WHERE id = $1',
      )
    ) {
      const row = this.documentTypes.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, department_id, name, access_state, size_limit_words FROM document_type WHERE department_id = $1',
      )
    ) {
      const rows = [...this.documentTypes.values()]
        .filter((r) => r.department_id === (params[0] as string))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE document_type SET')) {
      const row = this.documentTypes.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE document_type SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM document_type WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.documentTypes.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* ----------------------------- content_type ------------------------------- */

    if (sql.startsWith('INSERT INTO content_type (document_type_id, label)')) {
      this.mutationCount += 1;
      const row: ContentTypeRow = {
        id: this.nextId('ct'),
        document_type_id: params[0] as string,
        label: params[1] as string,
      };
      this.contentTypes.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, document_type_id, label FROM content_type WHERE id = $1')) {
      const row = this.contentTypes.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, document_type_id, label FROM content_type WHERE document_type_id = $1',
      )
    ) {
      const rows = [...this.contentTypes.values()]
        .filter((r) => r.document_type_id === (params[0] as string))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE content_type SET')) {
      const row = this.contentTypes.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE content_type SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM content_type WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.contentTypes.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* -------------------------------- topic -------------------------------- */

    if (sql.startsWith('INSERT INTO topic (department_id, name)')) {
      this.mutationCount += 1;
      const row: TopicRow = {
        id: this.nextId('topic'),
        department_id: params[0] as string,
        name: params[1] as string,
      };
      this.topics.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT department_id FROM topic WHERE id = $1')) {
      const row = this.topics.get(params[0] as string);
      return (row ? [{ department_id: row.department_id }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, department_id, name FROM topic WHERE id = $1')) {
      const row = this.topics.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, department_id, name FROM topic WHERE department_id = $1',
      )
    ) {
      const rows = [...this.topics.values()]
        .filter((r) => r.department_id === (params[0] as string))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE topic SET')) {
      const row = this.topics.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE topic SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM topic WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.topics.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* ----------------------- custom_metadata_field ------------------------ */

    if (
      sql.startsWith('INSERT INTO custom_metadata_field (document_type_id, label, required)')
    ) {
      this.mutationCount += 1;
      const row: CustomMetadataFieldRow = {
        id: this.nextId('cmf'),
        document_type_id: params[0] as string,
        label: params[1] as string,
        required: params[2] as boolean,
      };
      this.customMetadataFields.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, document_type_id, label, required FROM custom_metadata_field WHERE id = $1',
      )
    ) {
      const row = this.customMetadataFields.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, document_type_id, label, required FROM custom_metadata_field WHERE document_type_id = $1',
      )
    ) {
      const rows = [...this.customMetadataFields.values()]
        .filter((r) => r.document_type_id === (params[0] as string))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE custom_metadata_field SET')) {
      const row = this.customMetadataFields.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice(
        'UPDATE custom_metadata_field SET'.length,
        sql.indexOf('WHERE'),
      );
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM custom_metadata_field WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.customMetadataFields.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* -------------------- document type deletion impact -------------------- */

    if (sql.startsWith('SELECT COUNT(*)::int AS count FROM document WHERE document_type_id = $1')) {
      const documentTypeId = params[0] as string;
      const count = [...this.documents.values()].filter(
        (d) => d.document_type_id === documentTypeId,
      ).length;
      return [{ count }] as unknown as Row[];
    }

    /* ------------------------ topic deletion impact ------------------------ */

    if (sql.startsWith("SELECT COUNT(*)::int AS count FROM document WHERE metadata ->> $2 = $1")) {
      const [topicName, metadataKey] = params as [string, string];
      const count = [...this.documents.values()].filter(
        (d) => (d.metadata ?? {})[metadataKey] === topicName,
      ).length;
      return [{ count }] as unknown as Row[];
    }

    /* ------------------------------- app_user ------------------------------ */

    if (sql.startsWith('SELECT COUNT(*)::int AS count FROM app_user WHERE')) {
      const matches = this.matchAppUsers(params);
      return [{ count: matches.length }] as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, email, first_name, last_name FROM app_user WHERE')) {
      const matches = this.matchAppUsers(params);
      const pageSize = params[4] as number;
      const offset = params[5] as number;
      const page = matches.slice(offset, offset + pageSize);
      return page as unknown as Row[];
    }

    /* ---------------------------- role_assignment -------------------------- */

    if (sql.startsWith('SELECT user_id, role FROM role_assignment WHERE user_id = ANY($1)')) {
      const userIds = new Set(params[0] as string[]);
      const rows = [...this.roleAssignments.values()]
        .filter((r) => userIds.has(r.user_id))
        .map((r) => ({ user_id: r.user_id, role: r.role }));
      return rows as unknown as Row[];
    }

    if (
      sql.startsWith(
        "SELECT id, user_id, role, scope FROM role_assignment WHERE user_id = $1 AND role = $2 AND scope ->> 'departmentId' = $3",
      )
    ) {
      const [userId, role, departmentId] = params as [string, string, string];
      const row = [...this.roleAssignments.values()].find(
        (r) =>
          r.user_id === userId && r.role === role && r.scope?.departmentId === departmentId,
      );
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO role_assignment (user_id, role, scope, granted_by)')) {
      this.mutationCount += 1;
      const [userId, role, scope, grantedBy] = params as [
        string,
        string,
        { departmentId?: string } | null,
        string,
      ];
      const row: RoleAssignmentRow = {
        id: this.nextId('ra'),
        user_id: userId,
        role,
        scope,
        granted_by: grantedBy,
      };
      this.roleAssignments.set(row.id, row);
      return [] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM role_assignment WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.roleAssignments.delete(id);
      if (existed) this.mutationCount += 1;
      return [] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'DELETE FROM role_assignment WHERE user_id = $1 AND role = $2 AND scope IS NULL',
      )
    ) {
      const [userId, role] = params as [string, string];
      for (const [id, row] of this.roleAssignments) {
        if (row.user_id === userId && row.role === role && row.scope === null) {
          this.roleAssignments.delete(id);
          this.mutationCount += 1;
        }
      }
      return [] as unknown as Row[];
    }

    /* ------------------------------ access_grant ---------------------------- */

    if (sql.startsWith('INSERT INTO access_grant (user_id, document_type_id, granted_by)')) {
      this.mutationCount += 1;
      const [userId, documentTypeId, grantedBy] = params as [string, string, string];
      const row: AccessGrantRow = {
        id: this.nextId('grant'),
        user_id: userId,
        document_type_id: documentTypeId,
        granted_by: grantedBy,
        granted_at: new Date(),
        revoked_at: null,
      };
      this.accessGrants.set(row.id, row);
      return [{ ...row }] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, user_id, document_type_id, granted_by, granted_at, revoked_at FROM access_grant WHERE id = $1',
      )
    ) {
      const row = this.accessGrants.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, user_id, document_type_id, granted_by, granted_at, revoked_at FROM access_grant WHERE document_type_id = $1 AND revoked_at IS NULL',
      )
    ) {
      const documentTypeId = params[0] as string;
      const rows = [...this.accessGrants.values()]
        .filter((r) => r.document_type_id === documentTypeId && r.revoked_at === null)
        .sort((a, b) => a.granted_at.getTime() - b.granted_at.getTime());
      return rows.map((r) => ({ ...r })) as unknown as Row[];
    }

    if (sql.startsWith('UPDATE access_grant SET revoked_at = now()')) {
      const id = params[0] as string;
      const row = this.accessGrants.get(id);
      if (!row || row.revoked_at !== null) {
        return [] as unknown as Row[];
      }
      this.mutationCount += 1;
      row.revoked_at = new Date();
      return [{ id }] as unknown as Row[];
    }

    throw new Error(`FakeDb: unhandled SQL: ${sql}`);
  }
}
