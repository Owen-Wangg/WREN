/**
 * In-memory fake of the parameterized {@link QueryExecutor} for Admin_Service
 * unit tests.
 *
 * It stores `organization`, `writing_type`, `content_type`, and
 * `custom_metadata_field` rows in Maps (plus minimal `document` and
 * `role_assignment` rows used only for the Writing Type deletion-impact count)
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

interface OrganizationRow {
  id: string;
  name: string;
  access_state: string;
}

interface WritingTypeRow {
  id: string;
  organization_id: string;
  name: string;
  access_state: string;
  size_limit_words: number | null;
}

interface ContentTypeRow {
  id: string;
  writing_type_id: string;
  label: string;
}

interface TopicRow {
  id: string;
  organization_id: string;
  name: string;
}

interface CustomMetadataFieldRow {
  id: string;
  writing_type_id: string;
  label: string;
  required: boolean;
}

/**
 * Minimal `document` row — only the columns the deletion-impact counts need.
 * `metadata` is optional so existing Writing-Type-impact seeds (which don't
 * care about metadata) keep working unchanged.
 */
interface DocumentRow {
  id: string;
  writing_type_id: string;
  metadata?: Record<string, string>;
}

/** `role_assignment` row (authorization source of truth). */
interface RoleAssignmentRow {
  id: string;
  user_id: string;
  role: string;
  scope: { writingTypeIds?: string[]; organizationId?: string } | null;
  granted_by: string | null;
}

/** `app_user` row (global User; carries no Organization ownership column). */
interface AppUserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}

/** `access_grant` row. `scope` is JSONB shaped `{writingTypeId}` or `{organizationId}`. */
interface AccessGrantRow {
  id: string;
  user_id: string;
  scope: { writingTypeId?: string; organizationId?: string };
  granted_by: string | null;
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
  public readonly organizations = new Map<string, OrganizationRow>();
  public readonly writingTypes = new Map<string, WritingTypeRow>();
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

  /** Seed an Organization directly (bypasses authorization) for test setup. */
  public seedOrganization(row: Partial<OrganizationRow> & { id: string }): OrganizationRow {
    const full: OrganizationRow = {
      id: row.id,
      name: row.name ?? 'Seed Org',
      access_state: row.access_state ?? 'LOCKED',
    };
    this.organizations.set(full.id, full);
    return full;
  }

  /** Seed a Writing Type directly (bypasses authorization) for test setup. */
  public seedWritingType(
    row: Partial<WritingTypeRow> & { id: string; organization_id: string },
  ): WritingTypeRow {
    const full: WritingTypeRow = {
      id: row.id,
      organization_id: row.organization_id,
      name: row.name ?? 'Seed Type',
      access_state: row.access_state ?? 'INHERIT',
      size_limit_words: row.size_limit_words ?? null,
    };
    this.writingTypes.set(full.id, full);
    return full;
  }

  /** Seed a Content Type directly (bypasses authorization) for test setup. */
  public seedContentType(
    row: Partial<ContentTypeRow> & { id: string; writing_type_id: string },
  ): ContentTypeRow {
    const full: ContentTypeRow = {
      id: row.id,
      writing_type_id: row.writing_type_id,
      label: row.label ?? 'Seed Content Type',
    };
    this.contentTypes.set(full.id, full);
    return full;
  }

  /** Seed a Topic directly (bypasses authorization) for test setup. */
  public seedTopic(row: Partial<TopicRow> & { id: string; organization_id: string }): TopicRow {
    const full: TopicRow = {
      id: row.id,
      organization_id: row.organization_id,
      name: row.name ?? 'Seed Topic',
    };
    this.topics.set(full.id, full);
    return full;
  }

  /** Seed a custom metadata field directly (bypasses authorization). */
  public seedCustomMetadataField(
    row: Partial<CustomMetadataFieldRow> & { id: string; writing_type_id: string },
  ): CustomMetadataFieldRow {
    const full: CustomMetadataFieldRow = {
      id: row.id,
      writing_type_id: row.writing_type_id,
      label: row.label ?? 'Seed Field',
      required: row.required ?? false,
    };
    this.customMetadataFields.set(full.id, full);
    return full;
  }

  /** Seed a Document directly (bypasses authorization) for deletion-impact tests. */
  public seedDocument(row: {
    id: string;
    writing_type_id: string;
    metadata?: Record<string, string>;
  }): DocumentRow {
    this.documents.set(row.id, row);
    return row;
  }

  /**
   * Seed a `role_assignment` row directly for test setup. Mirrors the real
   * schema: `scope` is JSONB shaped `{writingTypeIds: [...]}` for `Field
   * Expert`, `{organizationId: "..."}` for `Org Owner`, or `null` for a global
   * role (`User`/`Admin`).
   */
  public seedRoleAssignment(row: {
    id: string;
    role: string;
    scope: { writingTypeIds?: string[]; organizationId?: string } | null;
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
    row: Partial<AccessGrantRow> & { id: string; user_id: string },
  ): AccessGrantRow {
    const full: AccessGrantRow = {
      id: row.id,
      user_id: row.user_id,
      scope: row.scope ?? {},
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

    /* ---------------------------- organization --------------------------- */

    if (sql.startsWith('INSERT INTO organization (name) VALUES ($1)')) {
      this.mutationCount += 1;
      const row: OrganizationRow = {
        id: this.nextId('org'),
        name: params[0] as string,
        access_state: 'LOCKED',
      };
      this.organizations.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO organization (name, access_state)')) {
      this.mutationCount += 1;
      const row: OrganizationRow = {
        id: this.nextId('org'),
        name: params[0] as string,
        access_state: params[1] as string,
      };
      this.organizations.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, name, access_state FROM organization WHERE id = $1')) {
      const row = this.organizations.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, name, access_state FROM organization ORDER BY name ASC')) {
      const rows = [...this.organizations.values()]
        .map((r) => ({ ...r }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE organization SET')) {
      const row = this.organizations.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE organization SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM organization WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.organizations.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* ---------------------------- writing_type --------------------------- */

    if (sql.startsWith('INSERT INTO writing_type (organization_id, name, size_limit_words)')) {
      this.mutationCount += 1;
      const row: WritingTypeRow = {
        id: this.nextId('wt'),
        organization_id: params[0] as string,
        name: params[1] as string,
        access_state: 'INHERIT',
        size_limit_words: (params[2] as number | null) ?? null,
      };
      this.writingTypes.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT organization_id FROM writing_type WHERE id = $1')) {
      const row = this.writingTypes.get(params[0] as string);
      return (row ? [{ organization_id: row.organization_id }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, organization_id, name, access_state, size_limit_words FROM writing_type WHERE id = $1',
      )
    ) {
      const row = this.writingTypes.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, organization_id, name, access_state, size_limit_words FROM writing_type WHERE organization_id = $1',
      )
    ) {
      const rows = [...this.writingTypes.values()]
        .filter((r) => r.organization_id === (params[0] as string))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE writing_type SET')) {
      const row = this.writingTypes.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE writing_type SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM writing_type WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.writingTypes.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* --------------------------- content_type ----------------------------- */

    if (sql.startsWith('INSERT INTO content_type (writing_type_id, label)')) {
      this.mutationCount += 1;
      const row: ContentTypeRow = {
        id: this.nextId('ct'),
        writing_type_id: params[0] as string,
        label: params[1] as string,
      };
      this.contentTypes.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, writing_type_id, label FROM content_type WHERE id = $1')) {
      const row = this.contentTypes.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, writing_type_id, label FROM content_type WHERE writing_type_id = $1',
      )
    ) {
      const rows = [...this.contentTypes.values()]
        .filter((r) => r.writing_type_id === (params[0] as string))
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

    if (sql.startsWith('INSERT INTO topic (organization_id, name)')) {
      this.mutationCount += 1;
      const row: TopicRow = {
        id: this.nextId('topic'),
        organization_id: params[0] as string,
        name: params[1] as string,
      };
      this.topics.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT organization_id FROM topic WHERE id = $1')) {
      const row = this.topics.get(params[0] as string);
      return (row ? [{ organization_id: row.organization_id }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, organization_id, name FROM topic WHERE id = $1')) {
      const row = this.topics.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, organization_id, name FROM topic WHERE organization_id = $1',
      )
    ) {
      const rows = [...this.topics.values()]
        .filter((r) => r.organization_id === (params[0] as string))
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
      sql.startsWith('INSERT INTO custom_metadata_field (writing_type_id, label, required)')
    ) {
      this.mutationCount += 1;
      const row: CustomMetadataFieldRow = {
        id: this.nextId('cmf'),
        writing_type_id: params[0] as string,
        label: params[1] as string,
        required: params[2] as boolean,
      };
      this.customMetadataFields.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, writing_type_id, label, required FROM custom_metadata_field WHERE id = $1',
      )
    ) {
      const row = this.customMetadataFields.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, writing_type_id, label, required FROM custom_metadata_field WHERE writing_type_id = $1',
      )
    ) {
      const rows = [...this.customMetadataFields.values()]
        .filter((r) => r.writing_type_id === (params[0] as string))
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

    /* --------------------- writing type deletion impact -------------------- */

    if (
      sql.startsWith(
        "SELECT COUNT(*)::int AS count FROM role_assignment WHERE role = 'Field Expert' AND scope -> 'writingTypeIds' ? $1",
      )
    ) {
      const writingTypeId = params[0] as string;
      const count = [...this.roleAssignments.values()].filter(
        (r) =>
          r.role === 'Field Expert' &&
          (r.scope?.writingTypeIds ?? []).includes(writingTypeId),
      ).length;
      return [{ count }] as unknown as Row[];
    }

    if (sql.startsWith('SELECT COUNT(*)::int AS count FROM document WHERE writing_type_id = $1')) {
      const writingTypeId = params[0] as string;
      const count = [...this.documents.values()].filter(
        (d) => d.writing_type_id === writingTypeId,
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
        "SELECT id, user_id, role, scope FROM role_assignment WHERE user_id = $1 AND role = $2 AND scope ->> 'organizationId' = $3",
      )
    ) {
      const [userId, role, organizationId] = params as [string, string, string];
      const row = [...this.roleAssignments.values()].find(
        (r) =>
          r.user_id === userId && r.role === role && r.scope?.organizationId === organizationId,
      );
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        "SELECT id, user_id, role, scope FROM role_assignment WHERE user_id = $1 AND role = 'Field Expert'",
      )
    ) {
      const userId = params[0] as string;
      const row = [...this.roleAssignments.values()].find(
        (r) => r.user_id === userId && r.role === 'Field Expert',
      );
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        "INSERT INTO role_assignment (user_id, role, scope, granted_by) VALUES ($1, 'Field Expert', $2, $3)",
      )
    ) {
      this.mutationCount += 1;
      const [userId, scope, grantedBy] = params as [
        string,
        { writingTypeIds?: string[] },
        string,
      ];
      const row: RoleAssignmentRow = {
        id: this.nextId('ra'),
        user_id: userId,
        role: 'Field Expert',
        scope,
        granted_by: grantedBy,
      };
      this.roleAssignments.set(row.id, row);
      return [] as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO role_assignment (user_id, role, scope, granted_by)')) {
      this.mutationCount += 1;
      const [userId, role, scope, grantedBy] = params as [
        string,
        string,
        { organizationId?: string } | null,
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

    if (sql.startsWith('UPDATE role_assignment SET scope = $2 WHERE id = $1')) {
      this.mutationCount += 1;
      const id = params[0] as string;
      const scope = params[1] as { writingTypeIds?: string[] };
      const row = this.roleAssignments.get(id);
      if (row) {
        this.roleAssignments.set(id, { ...row, scope });
      }
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

    if (sql.startsWith('INSERT INTO access_grant (user_id, scope, granted_by)')) {
      this.mutationCount += 1;
      const [userId, scope, grantedBy] = params as [
        string,
        { writingTypeId?: string; organizationId?: string },
        string,
      ];
      const row: AccessGrantRow = {
        id: this.nextId('grant'),
        user_id: userId,
        scope,
        granted_by: grantedBy,
        granted_at: new Date(),
        revoked_at: null,
      };
      this.accessGrants.set(row.id, row);
      return [{ ...row }] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, user_id, scope, granted_by, granted_at, revoked_at FROM access_grant WHERE id = $1',
      )
    ) {
      const row = this.accessGrants.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        "SELECT id, user_id, scope, granted_by, granted_at, revoked_at FROM access_grant WHERE scope ->> 'writingTypeId' = $1 AND revoked_at IS NULL",
      )
    ) {
      const writingTypeId = params[0] as string;
      const rows = [...this.accessGrants.values()]
        .filter((r) => r.scope.writingTypeId === writingTypeId && r.revoked_at === null)
        .sort((a, b) => a.granted_at.getTime() - b.granted_at.getTime());
      return rows.map((r) => ({ ...r })) as unknown as Row[];
    }

    if (
      sql.startsWith(
        "SELECT id, user_id, scope, granted_by, granted_at, revoked_at FROM access_grant WHERE scope ->> 'organizationId' = $1 AND revoked_at IS NULL",
      )
    ) {
      const organizationId = params[0] as string;
      const rows = [...this.accessGrants.values()]
        .filter((r) => r.scope.organizationId === organizationId && r.revoked_at === null)
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
