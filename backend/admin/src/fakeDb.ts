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
  prompt: string | null;
  ask_wren_prompt: string | null;
  access_state: 'OPEN' | 'LOCKED';
  visibility_state: 'VISIBLE' | 'PERMITTED_ONLY';
  archived_at: string | null;
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

interface ErrorCategoryRow {
  id: string;
  document_type_id: string;
  name: string;
  internal_guidance: string | null;
}

interface DocumentTypeConfigRow {
  document_type_id: string;
  tone: string | null;
  density: string | null;
  category_priority: string[];
  type_prompt_text: string | null;
  tone_description: string | null;
  density_description: string | null;
  structure_description: string | null;
  restrictions_description: string | null;
  notes_description: string | null;
  citation_config: Record<string, unknown> | null;
  updated_at: Date;
}

interface ReferenceMaterialRow {
  id: string;
  tier: 'department' | 'type';
  department_id: string;
  document_type_id: string | null;
  title: string;
  section: string | null;
  content_kind: 'file' | 'text' | 'html';
  s3_key: string | null;
  inline_content: string | null;
}

interface UsageLimitRow {
  id: string;
  scope_kind: 'platform' | 'documentType';
  scope_id: string | null;
  limit_value: number;
  period: string;
}

interface UsageCounterRow {
  scope_kind: 'platform' | 'documentType';
  scope_id: string | null;
  period_start: Date;
  consumed: number;
}

interface OverrideRow {
  id: string;
  user_id: string;
  document_type_id: string;
  bounds: { additionalActions: number };
  reason: string;
  granted_by: string | null;
  expires_at: Date;
}

interface ActivityEventRow {
  id: string;
  actor_pseudonym: string;
  verb: string;
  object_type: string;
  object_ref: string;
  document_type_id: string | null;
  department_id: string | null;
  timestamp: Date;
  context: Record<string, unknown>;
}

interface AggregateCounterRow {
  id: string;
  scope_kind: 'platform' | 'documentType';
  scope_id: string | null;
  metric: string;
  window_start: Date;
  value: number;
}

/**
 * Minimal `document` row — only the columns the deletion-impact counts need.
 * `metadata` is optional so existing Document-Type-impact seeds (which don't
 * care about metadata) keep working unchanged.
 */
interface DocumentRow {
  id: string;
  document_type_id: string;
  owner_user_id?: string;
  metadata?: Record<string, string>;
  debrief_generation_count?: number;
  draft_create_count?: number;
}

interface PlatformUsagePolicyRow {
  id: number;
  message_limit: number;
  debrief_generation_limit: number;
  document_upload_limit: number;
  drafts_per_document_limit: number;
  max_upload_file_size_bytes: number;
  max_word_count: number;
}

/** Minimal `draft` row for deletion-retention tests. */
interface DraftRow {
  id: string;
  document_id: string;
  version_number: number;
}

/** Minimal `feedback_item` row for deletion-retention tests. */
interface FeedbackItemRow {
  id: string;
  document_id: string;
  kind: 'inline' | 'structural';
  question_text: string;
}

/** Minimal `anchor` row for deletion-retention tests. */
interface AnchorRow {
  id: string;
  draft_id: string;
  feedback_item_id: string;
  state: 'active' | 'removed';
}

/** Minimal `resolution_status_history` row for deletion-retention tests. */
interface ResolutionStatusHistoryRow {
  id: string;
  feedback_item_id: string;
  draft_id: string;
  status: string;
}

/** `role_assignment` row (authorization source of truth). */
interface RoleAssignmentRow {
  id: string;
  user_id: string;
  role: string;
  scope: { departmentId?: string; departmentIds?: string[] } | null;
  granted_by: string | null;
}

/** `app_user` row (global User; carries no Department ownership column). */
interface AppUserRow {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  idp_subject?: string | null;
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

interface DepartmentVisibilityGrantRow {
  id: string;
  department_id: string;
  user_id: string;
  granted_by: string | null;
  granted_at: Date;
  revoked_at: Date | null;
}

const collapse = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/**
 * Project a stored `department` row to the columns a statement actually
 * selects/returns, so the fake mirrors production column visibility. In
 * particular `ask_wren_prompt` is a late-added column selected only by the
 * Ask WREN write path — statements that don't name it must not leak it (they
 * would otherwise cause `toDepartment` to surface `askWrenPrompt` on every
 * read, diverging from the real driver).
 */
function projectDepartmentRow<T extends { ask_wren_prompt?: string | null }>(
  row: T,
  sql: string,
): T {
  if (sql.includes('ask_wren_prompt')) return { ...row };
  const { ask_wren_prompt: _omitted, ...rest } = row;
  return rest as T;
}

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
  public readonly drafts = new Map<string, DraftRow>();
  public readonly feedbackItems = new Map<string, FeedbackItemRow>();
  public readonly anchors = new Map<string, AnchorRow>();
  public readonly resolutionStatusHistory = new Map<string, ResolutionStatusHistoryRow>();
  public readonly roleAssignments = new Map<string, RoleAssignmentRow>();
  public readonly appUsers = new Map<string, AppUserRow>();
  public readonly accessGrants = new Map<string, AccessGrantRow>();
  public readonly departmentVisibilityGrants = new Map<string, DepartmentVisibilityGrantRow>();
  public readonly errorCategories = new Map<string, ErrorCategoryRow>();
  public readonly documentTypeConfigs = new Map<string, DocumentTypeConfigRow>();
  public readonly referenceMaterials = new Map<string, ReferenceMaterialRow>();
  public readonly usageLimits = new Map<string, UsageLimitRow>();
  public readonly usageCounters: UsageCounterRow[] = [];
  public readonly overrides = new Map<string, OverrideRow>();
  public readonly activityEvents: ActivityEventRow[] = [];
  public readonly aggregateCounters = new Map<string, AggregateCounterRow>();
  public readonly userLifetimeUsage = new Map<string, { document_upload_count: number }>();
  public platformUsagePolicy: PlatformUsagePolicyRow | null = null;
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
      prompt: row.prompt ?? null,
      ask_wren_prompt: row.ask_wren_prompt ?? null,
      access_state: row.access_state ?? 'OPEN',
      visibility_state: row.visibility_state ?? 'VISIBLE',
      archived_at: row.archived_at ?? null,
    };
    this.departments.set(full.id, full);
    return full;
  }

  /** Seed a Document Type directly (bypasses authorization) for test setup. */
  public seedDocumentType(
    row: Partial<DocumentTypeRow> & { id: string; department_id: string },
  ): DocumentTypeRow {
    const dept = this.departments.get(row.department_id);
    const full: DocumentTypeRow = {
      id: row.id,
      department_id: row.department_id,
      name: row.name ?? 'Seed Type',
      access_state: row.access_state ?? dept?.access_state ?? 'OPEN',
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
    owner_user_id?: string;
    metadata?: Record<string, string>;
    debrief_generation_count?: number;
    draft_create_count?: number;
  }): DocumentRow {
    const full: DocumentRow = {
      ...row,
      owner_user_id: row.owner_user_id ?? 'seed-user',
      debrief_generation_count: row.debrief_generation_count ?? 0,
      draft_create_count: row.draft_create_count ?? 0,
    };
    this.documents.set(full.id, full);
    return full;
  }

  public seedPlatformUsagePolicy(
    overrides: Partial<Omit<PlatformUsagePolicyRow, 'id'>> = {},
  ): PlatformUsagePolicyRow {
    const full: PlatformUsagePolicyRow = {
      id: 1,
      message_limit: 100,
      debrief_generation_limit: 15,
      document_upload_limit: 30,
      drafts_per_document_limit: 15,
      max_upload_file_size_bytes: 30 * 1024 * 1024,
      max_word_count: 10_000,
      ...overrides,
    };
    this.platformUsagePolicy = full;
    return full;
  }

  /** Seed a Draft directly for deletion-retention tests. */
  public seedDraft(row: { id: string; document_id: string; version_number?: number }): DraftRow {
    const full: DraftRow = { id: row.id, document_id: row.document_id, version_number: row.version_number ?? 1 };
    this.drafts.set(full.id, full);
    return full;
  }

  /** Seed a FeedbackItem directly for deletion-retention tests. */
  public seedFeedbackItem(row: { id: string; document_id: string; kind?: 'inline' | 'structural'; question_text?: string }): FeedbackItemRow {
    const full: FeedbackItemRow = { id: row.id, document_id: row.document_id, kind: row.kind ?? 'inline', question_text: row.question_text ?? 'Why?' };
    this.feedbackItems.set(full.id, full);
    return full;
  }

  /** Seed an Anchor directly for deletion-retention tests. */
  public seedAnchor(row: { id: string; draft_id: string; feedback_item_id: string; state?: 'active' | 'removed' }): AnchorRow {
    const full: AnchorRow = { id: row.id, draft_id: row.draft_id, feedback_item_id: row.feedback_item_id, state: row.state ?? 'active' };
    this.anchors.set(full.id, full);
    return full;
  }

  /** Seed a ResolutionStatusHistory entry for deletion-retention tests. */
  public seedResolutionStatusHistory(row: { id: string; feedback_item_id: string; draft_id: string; status?: string }): ResolutionStatusHistoryRow {
    const full: ResolutionStatusHistoryRow = { id: row.id, feedback_item_id: row.feedback_item_id, draft_id: row.draft_id, status: row.status ?? 'resolved' };
    this.resolutionStatusHistory.set(full.id, full);
    return full;
  }

  /**
   * Seed a `role_assignment` row directly for test setup. `scope` is JSONB
   * shaped `{departmentId: "..."}` for `DepartmentAdmin`, or `null` for a
   * global role (`Student`/`TechnicalAdmin`).
   */
  public seedRoleAssignment(row: {
    id: string;
    role: string;
    scope: { departmentId?: string; departmentIds?: string[] } | null;
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
      idp_subject: row.idp_subject ?? null,
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

  /** Seed a Department visibility grant directly for test setup. */
  public seedDepartmentVisibilityGrant(
    row: Partial<DepartmentVisibilityGrantRow> & {
      id: string;
      department_id: string;
      user_id: string;
    },
  ): DepartmentVisibilityGrantRow {
    const full: DepartmentVisibilityGrantRow = {
      id: row.id,
      department_id: row.department_id,
      user_id: row.user_id,
      granted_by: row.granted_by ?? 'seed-granter',
      granted_at: row.granted_at ?? new Date(),
      revoked_at: row.revoked_at ?? null,
    };
    this.departmentVisibilityGrants.set(full.id, full);
    return full;
  }

  /** Seed an error category directly (bypasses authorization) for test setup. */
  public seedErrorCategory(
    row: Partial<ErrorCategoryRow> & { id: string; document_type_id: string },
  ): ErrorCategoryRow {
    const full: ErrorCategoryRow = {
      id: row.id,
      document_type_id: row.document_type_id,
      name: row.name ?? 'Seed Category',
      internal_guidance: row.internal_guidance ?? null,
    };
    this.errorCategories.set(full.id, full);
    return full;
  }

  /** Seed a Document Type's config row directly (bypasses authorization) for test setup. */
  public seedDocumentTypeConfig(
    row: Partial<DocumentTypeConfigRow> & { document_type_id: string },
  ): DocumentTypeConfigRow {
    const full: DocumentTypeConfigRow = {
      document_type_id: row.document_type_id,
      tone: row.tone ?? null,
      density: row.density ?? null,
      category_priority: row.category_priority ?? [],
      type_prompt_text: row.type_prompt_text ?? null,
      tone_description: row.tone_description ?? null,
      density_description: row.density_description ?? null,
      structure_description: row.structure_description ?? null,
      restrictions_description: row.restrictions_description ?? null,
      notes_description: row.notes_description ?? null,
      citation_config: row.citation_config ?? null,
      updated_at: row.updated_at ?? new Date(),
    };
    this.documentTypeConfigs.set(full.document_type_id, full);
    return full;
  }

  /** Seed a Reference Material row directly (bypasses authorization) for test setup. */
  public seedReferenceMaterial(
    row: Partial<ReferenceMaterialRow> & { id: string; department_id: string },
  ): ReferenceMaterialRow {
    const full: ReferenceMaterialRow = {
      id: row.id,
      tier: row.tier ?? 'department',
      department_id: row.department_id,
      document_type_id: row.document_type_id ?? null,
      title: row.title ?? 'Seed Material',
      section: row.section ?? null,
      content_kind: row.content_kind ?? 'text',
      s3_key: row.s3_key ?? null,
      inline_content: row.inline_content ?? 'Seed content',
    };
    this.referenceMaterials.set(full.id, full);
    return full;
  }

  /** Seed a usage limit row directly (bypasses authorization) for test setup. */
  public seedUsageLimit(row: Partial<UsageLimitRow> & { id: string }): UsageLimitRow {
    const full: UsageLimitRow = {
      id: row.id,
      scope_kind: row.scope_kind ?? 'platform',
      scope_id: row.scope_id ?? null,
      limit_value: row.limit_value ?? 100,
      period: row.period ?? 'monthly',
    };
    this.usageLimits.set(full.id, full);
    return full;
  }

  /** Seed a usage counter row directly (bypasses authorization) for test setup. */
  public seedUsageCounter(row: Partial<UsageCounterRow> & { period_start: Date }): UsageCounterRow {
    const full: UsageCounterRow = {
      scope_kind: row.scope_kind ?? 'platform',
      scope_id: row.scope_id ?? null,
      period_start: row.period_start,
      consumed: row.consumed ?? 0,
    };
    this.usageCounters.push(full);
    return full;
  }

  /** Seed an override row directly (bypasses authorization) for test setup. */
  public seedOverride(
    row: Partial<OverrideRow> & { id: string; user_id: string; document_type_id: string },
  ): OverrideRow {
    const full: OverrideRow = {
      id: row.id,
      user_id: row.user_id,
      document_type_id: row.document_type_id,
      bounds: row.bounds ?? { additionalActions: 5 },
      reason: row.reason ?? 'Seed reason',
      granted_by: row.granted_by ?? 'seed-granter',
      expires_at: row.expires_at ?? new Date('2099-01-01T00:00:00.000Z'),
    };
    this.overrides.set(full.id, full);
    return full;
  }

  /** Seed an aggregate-counter row directly (bypasses recording) for test setup. */
  public seedAggregateCounter(
    row: Partial<AggregateCounterRow> & {
      id: string;
      scope_kind: 'platform' | 'documentType';
      metric: string;
      window_start: Date;
      value: number;
    },
  ): AggregateCounterRow {
    const full: AggregateCounterRow = {
      id: row.id,
      scope_kind: row.scope_kind,
      scope_id: row.scope_id ?? null,
      metric: row.metric,
      window_start: row.window_start,
      value: row.value,
    };
    this.aggregateCounters.set(full.id, full);
    return full;
  }

  /** Seed an activity-event row directly (bypasses recording) for test setup. */
  public seedActivityEvent(
    row: Partial<ActivityEventRow> & { id: string; actor_pseudonym: string; verb: string },
  ): ActivityEventRow {
    const full: ActivityEventRow = {
      id: row.id,
      actor_pseudonym: row.actor_pseudonym,
      verb: row.verb,
      object_type: row.object_type ?? 'Document',
      object_ref: row.object_ref ?? 'seed-ref',
      document_type_id: row.document_type_id ?? null,
      department_id: row.department_id ?? null,
      timestamp: row.timestamp ?? new Date(),
      context: row.context ?? {},
    };
    this.activityEvents.push(full);
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
        prompt: null,
        ask_wren_prompt: null,
        access_state: 'OPEN',
        visibility_state: 'VISIBLE',
        archived_at: null,
      };
      this.departments.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO department (id, name) VALUES ($1, $2)')) {
      this.mutationCount += 1;
      const row: DepartmentRow = {
        id: params[0] as string,
        name: params[1] as string,
        prompt: null,
        ask_wren_prompt: null,
        access_state: 'OPEN',
        visibility_state: 'VISIBLE',
        archived_at: null,
      };
      this.departments.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO department (name) VALUES ($1)')) {
      this.mutationCount += 1;
      const row: DepartmentRow = {
        id: this.nextId('dept'),
        name: params[0] as string,
        prompt: null,
        ask_wren_prompt: null,
        access_state: 'OPEN',
        visibility_state: 'VISIBLE',
        archived_at: null,
      };
      this.departments.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT id FROM department WHERE id = $1 AND archived_at IS NULL')) {
      const row = this.departments.get(params[0] as string);
      return (row && row.archived_at === null ? [{ id: row.id }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT id FROM department WHERE id = $1')) {
      const row = this.departments.get(params[0] as string);
      return (row ? [{ id: row.id }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith('SELECT id, name, prompt, ask_wren_prompt, access_state, visibility_state, archived_at FROM department WHERE id = $1') ||
      sql.startsWith('SELECT id, name, prompt, access_state, visibility_state, archived_at FROM department WHERE id = $1') ||
      sql.startsWith('SELECT id, name, prompt, access_state, archived_at FROM department WHERE id = $1') ||
      sql.startsWith('SELECT id, name, prompt, access_state FROM department WHERE id = $1') ||
      sql.startsWith('SELECT id, name, prompt FROM department WHERE id = $1')
    ) {
      const row = this.departments.get(params[0] as string);
      const requiresActive = sql.includes('archived_at IS NULL');
      return (row && (!requiresActive || row.archived_at === null)
        ? [projectDepartmentRow(row, sql)]
        : []) as unknown as Row[];
    }

    if (
      sql.startsWith('SELECT id, name, prompt, access_state FROM department ORDER BY name ASC') ||
      sql.startsWith('SELECT id, name, prompt FROM department ORDER BY name ASC')
    ) {
      const rows = [...this.departments.values()]
        .filter((r) => r.archived_at === null)
        .map((r) => projectDepartmentRow(r, sql))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (
      sql.startsWith('SELECT d.id, d.name, d.prompt, d.ask_wren_prompt, d.access_state, d.visibility_state,') ||
      sql.startsWith('SELECT d.id, d.name, d.prompt, d.access_state, d.visibility_state,')
    ) {
      const [userId, isTechnicalAdmin, administeredDepartmentIds] = params as [
        string,
        boolean,
        string[],
      ];
      const rows = [...this.departments.values()]
        .filter((r) => r.archived_at === null)
        .map((r) => ({
          ...projectDepartmentRow(r, sql),
          active_user_count: 0,
          viewer_can_discover:
            r.visibility_state === 'VISIBLE' ||
            isTechnicalAdmin ||
            administeredDepartmentIds.includes(r.id) ||
            [...this.departmentVisibilityGrants.values()].some(
              (grant) =>
                grant.department_id === r.id &&
                grant.user_id === userId &&
                grant.revoked_at === null,
            ),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('SELECT d.id, d.name, d.prompt, d.access_state, d.archived_at,')) {
      const rows = [...this.departments.values()]
        .filter((r) => r.archived_at === null)
        .map((r) => ({ ...projectDepartmentRow(r, sql), active_user_count: 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('SELECT d.id, d.name, d.prompt, d.access_state,')) {
      const rows = [...this.departments.values()]
        .filter((r) => r.archived_at === null)
        .map((r) => ({ ...projectDepartmentRow(r, sql), active_user_count: 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    // Archive: UPDATE department SET archived_at = now() WHERE id = $1 AND archived_at IS NULL
    if (sql.startsWith('UPDATE department SET archived_at = now()')) {
      const id = params[0] as string;
      const row = this.departments.get(id);
      if (!row || row.archived_at !== null) return [] as unknown as Row[];
      this.mutationCount += 1;
      row.archived_at = new Date().toISOString();
      return [projectDepartmentRow(row, sql)] as unknown as Row[];
    }

    if (sql.startsWith('UPDATE department SET')) {
      const row = this.departments.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE department SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [projectDepartmentRow(row, sql)] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM department WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.departments.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* ----------------------------- document_type ----------------------------- */

    if (sql.startsWith('INSERT INTO document_type (department_id, name, access_state, size_limit_words)')) {
      this.mutationCount += 1;
      const dept = this.departments.get(params[0] as string);
      const row: DocumentTypeRow = {
        id: this.nextId('dt'),
        department_id: params[0] as string,
        name: params[1] as string,
        access_state: dept?.access_state ?? 'OPEN',
        size_limit_words: (params[2] as number | null) ?? null,
      };
      this.documentTypes.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT department_id FROM document_type WHERE id = $1')) {
      const row = this.documentTypes.get(params[0] as string);
      return (row ? [{ department_id: row.department_id }] : []) as unknown as Row[];
    }

    const withDeptAccess = (r: DocumentTypeRow) => {
      const dept = this.departments.get(r.department_id);
      return {
        ...r,
        access_state: dept?.access_state ?? r.access_state,
      };
    };

    if (
      sql.includes('COALESCE(d.access_state, dt.access_state) AS access_state') &&
      sql.includes('FROM document_type dt') &&
      sql.includes('WHERE dt.id = $1')
    ) {
      const row = this.documentTypes.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      const dept = this.departments.get(row.department_id);
      if (!dept) return [] as unknown as Row[];
      return [withDeptAccess(row)] as unknown as Row[];
    }

    if (
      sql.includes('COALESCE(d.access_state, dt.access_state) AS access_state') &&
      sql.includes('FROM document_type dt') &&
      sql.includes('WHERE dt.department_id = $1')
    ) {
      const rows = [...this.documentTypes.values()]
        .filter((r) => r.department_id === (params[0] as string) && this.departments.has(r.department_id))
        .map(withDeptAccess)
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (
      sql.includes('COALESCE(d.access_state, dt.access_state) AS access_state') &&
      sql.includes('FROM document_type dt') &&
      sql.includes('ORDER BY dt.name ASC') &&
      !sql.includes('WHERE')
    ) {
      const rows = [...this.documentTypes.values()]
        .filter((r) => this.departments.has(r.department_id))
        .map(withDeptAccess)
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
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

    if (sql.startsWith('UPDATE document_type SET access_state = $2 WHERE department_id = $1')) {
      const departmentId = params[0] as string;
      const accessState = params[1] as string;
      let touched = false;
      for (const row of this.documentTypes.values()) {
        if (row.department_id === departmentId) {
          row.access_state = accessState;
          touched = true;
        }
      }
      if (touched) this.mutationCount += 1;
      return [] as unknown as Row[];
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

    if (
      sql.startsWith('SELECT user_id, role, scope FROM role_assignment WHERE user_id = ANY($1)') ||
      sql.startsWith('SELECT user_id, role FROM role_assignment WHERE user_id = ANY($1)')
    ) {
      const userIds = new Set(params[0] as string[]);
      const rows = [...this.roleAssignments.values()]
        .filter((r) => userIds.has(r.user_id))
        .map((r) => ({ user_id: r.user_id, role: r.role, scope: r.scope }));
      return rows as unknown as Row[];
    }

    if (
      sql.startsWith(
        "SELECT id, user_id, role, scope FROM role_assignment WHERE user_id = $1 AND role = $2 AND (",
      ) ||
      sql.startsWith(
        "SELECT id, user_id, role, scope FROM role_assignment WHERE user_id = $1 AND role = $2 AND scope ->> 'departmentId' = $3",
      )
    ) {
      const [userId, role, departmentId] = params as [string, string, string];
      const row = [...this.roleAssignments.values()].find((r) => {
        if (r.user_id !== userId || r.role !== role || !r.scope) return false;
        if (r.scope.departmentId === departmentId) return true;
        const ids = (r.scope as { departmentIds?: unknown }).departmentIds;
        return Array.isArray(ids) && ids.includes(departmentId);
      });
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, user_id, role, scope FROM role_assignment WHERE user_id = $1 AND role = $2 AND scope IS NULL',
      )
    ) {
      const [userId, role] = params as [string, string];
      const row = [...this.roleAssignments.values()].find(
        (r) => r.user_id === userId && r.role === role && r.scope === null,
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

    /* --------------------- department_visibility_grant --------------------- */

    if (sql.startsWith('SELECT idp_subject FROM app_user WHERE id = $1')) {
      const user = this.appUsers.get(params[0] as string);
      return (user ? [{ idp_subject: user.idp_subject ?? null }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT id FROM app_user WHERE id = $1')) {
      const user = this.appUsers.get(params[0] as string);
      return (user ? [{ id: user.id }] : []) as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO department_visibility_grant (department_id, user_id, granted_by)')) {
      const [departmentId, userId, grantedBy] = params as [string, string, string];
      const existing = [...this.departmentVisibilityGrants.values()].find(
        (grant) =>
          grant.department_id === departmentId &&
          grant.user_id === userId &&
          grant.revoked_at === null,
      );
      if (existing) return [] as unknown as Row[];
      this.mutationCount += 1;
      const row: DepartmentVisibilityGrantRow = {
        id: this.nextId('dvg'),
        department_id: departmentId,
        user_id: userId,
        granted_by: grantedBy,
        granted_at: new Date(),
        revoked_at: null,
      };
      this.departmentVisibilityGrants.set(row.id, row);
      return [{ ...row }] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, department_id, user_id, granted_by, granted_at, revoked_at FROM department_visibility_grant WHERE department_id = $1 AND user_id = $2 AND revoked_at IS NULL',
      )
    ) {
      const [departmentId, userId] = params as [string, string];
      const row = [...this.departmentVisibilityGrants.values()].find(
        (grant) =>
          grant.department_id === departmentId &&
          grant.user_id === userId &&
          grant.revoked_at === null,
      );
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT COUNT(*)::int AS total FROM department_visibility_grant dvg')) {
      const [departmentId, search] = params as [string, string | null];
      const needle = search ? search.slice(1, -1).toLowerCase() : null;
      const total = [...this.departmentVisibilityGrants.values()]
        .filter((grant) => grant.department_id === departmentId && grant.revoked_at === null)
        .map((grant) => this.appUsers.get(grant.user_id))
        .filter((user): user is AppUserRow => {
          if (!user) return false;
          if (!needle) return true;
          return [user.first_name, user.last_name, user.email]
            .some((value) => value.toLowerCase().includes(needle));
        }).length;
      return [{ total }] as unknown as Row[];
    }

    if (sql.startsWith('SELECT dvg.id, dvg.department_id, dvg.user_id,')) {
      const [departmentId, search, limit, offset] = params as [
        string,
        string | null,
        number,
        number,
      ];
      const needle = search ? search.slice(1, -1).toLowerCase() : null;
      const matches = [...this.departmentVisibilityGrants.values()]
        .filter((grant) => grant.department_id === departmentId && grant.revoked_at === null)
        .map((grant) => ({ grant, user: this.appUsers.get(grant.user_id) }))
        .filter((entry): entry is { grant: DepartmentVisibilityGrantRow; user: AppUserRow } => {
          if (!entry.user) return false;
          if (!needle) return true;
          return [entry.user.first_name, entry.user.last_name, entry.user.email]
            .some((value) => value.toLowerCase().includes(needle));
        })
        .sort((a, b) =>
          a.user.last_name.localeCompare(b.user.last_name) ||
          a.user.first_name.localeCompare(b.user.first_name),
        );
      const total = matches.length;
      return matches.slice(offset, offset + limit).map(({ grant, user }) => {
        const assignments = [...this.roleAssignments.values()].filter(
          (assignment) => assignment.user_id === user.id,
        );
        const roles = [...new Set(assignments.map((assignment) => assignment.role))];
        const administers = assignments.some(
          (assignment) =>
            assignment.role === 'DepartmentAdmin' &&
            (assignment.scope?.departmentId === departmentId ||
              assignment.scope?.departmentIds?.includes(departmentId)),
        );
        return {
          ...grant,
          ...user,
          roles,
          administered_department_ids: administers ? [departmentId] : [],
          total,
        };
      }) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, department_id, user_id, granted_by, granted_at, revoked_at FROM department_visibility_grant WHERE id = $1 AND department_id = $2',
      )
    ) {
      const [grantId, departmentId] = params as [string, string];
      const row = this.departmentVisibilityGrants.get(grantId);
      return (row && row.department_id === departmentId ? [{ ...row }] : []) as unknown as Row[];
    }

    if (sql.startsWith('UPDATE department_visibility_grant SET revoked_at = now()')) {
      const [grantId, departmentId] = params as [string, string];
      const row = this.departmentVisibilityGrants.get(grantId);
      if (!row || row.department_id !== departmentId || row.revoked_at !== null) {
        return [] as unknown as Row[];
      }
      this.mutationCount += 1;
      row.revoked_at = new Date();
      return [{ ...row }] as unknown as Row[];
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

    /* ----------------------------- error_category ---------------------------- */

    if (sql.startsWith('INSERT INTO error_category (document_type_id, name, internal_guidance)')) {
      this.mutationCount += 1;
      const row: ErrorCategoryRow = {
        id: this.nextId('cat'),
        document_type_id: params[0] as string,
        name: params[1] as string,
        internal_guidance: (params[2] as string | null) ?? null,
      };
      this.errorCategories.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT document_type_id FROM error_category WHERE id = $1')) {
      const row = this.errorCategories.get(params[0] as string);
      return (row ? [{ document_type_id: row.document_type_id }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, document_type_id, name, internal_guidance FROM error_category WHERE id = $1',
      )
    ) {
      const row = this.errorCategories.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, document_type_id, name, internal_guidance FROM error_category WHERE document_type_id = $1',
      )
    ) {
      const rows = [...this.errorCategories.values()]
        .filter((r) => r.document_type_id === (params[0] as string))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE error_category SET')) {
      const row = this.errorCategories.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE error_category SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM error_category WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.errorCategories.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* -------------------------- document_type_config -------------------------- */

    if (sql.startsWith('INSERT INTO document_type_config (document_type_id, updated_at)')) {
      this.mutationCount += 1;
      const documentTypeId = params[0] as string;
      const existing = this.documentTypeConfigs.get(documentTypeId);
      const row: DocumentTypeConfigRow = existing
        ? { ...existing, updated_at: new Date() }
        : {
            document_type_id: documentTypeId,
            tone: null,
            density: null,
            category_priority: [],
            type_prompt_text: null,
            tone_description: null,
            density_description: null,
            structure_description: null,
            restrictions_description: null,
            notes_description: null,
            citation_config: null,
            updated_at: new Date(),
          };
      this.documentTypeConfigs.set(documentTypeId, row);
      return [{ ...row }] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT document_type_id, tone, density, category_priority, type_prompt_text, tone_description, density_description, structure_description, restrictions_description, notes_description, citation_config, updated_at FROM document_type_config WHERE document_type_id = $1',
      )
    ) {
      const row = this.documentTypeConfigs.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO document_type_config (document_type_id, tone, density, category_priority, type_prompt_text, tone_description, density_description, structure_description, restrictions_description, notes_description, citation_config, updated_at)')) {
      this.mutationCount += 1;
      const [documentTypeId, tone, density, categoryPriorityJson, typePromptText, toneDescription, densityDescription, shouldSetPrompt, structureDescription, restrictionsDescription, notesDescription, citationConfigJson, shouldSetCitationConfig] =
        params as [string, string | null, string | null, string | null, string | null, string | null, string | null, boolean, string | null, string | null, string | null, string | null, boolean];
      const existing = this.documentTypeConfigs.get(documentTypeId);
      const categoryPriority = categoryPriorityJson
        ? (JSON.parse(categoryPriorityJson) as string[])
        : existing?.category_priority ?? [];
      const citationConfig = shouldSetCitationConfig
        ? citationConfigJson
          ? (JSON.parse(citationConfigJson) as Record<string, unknown>)
          : null
        : existing?.citation_config ?? null;
      const row: DocumentTypeConfigRow = {
        document_type_id: documentTypeId,
        tone: tone ?? existing?.tone ?? null,
        density: density ?? existing?.density ?? null,
        category_priority: categoryPriority,
        type_prompt_text: shouldSetPrompt ? typePromptText : existing?.type_prompt_text ?? null,
        tone_description: toneDescription ?? existing?.tone_description ?? null,
        density_description: densityDescription ?? existing?.density_description ?? null,
        structure_description: structureDescription ?? existing?.structure_description ?? null,
        restrictions_description: restrictionsDescription ?? existing?.restrictions_description ?? null,
        notes_description: notesDescription ?? existing?.notes_description ?? null,
        citation_config: citationConfig,
        updated_at: new Date(),
      };
      this.documentTypeConfigs.set(documentTypeId, row);
      return [{ ...row }] as unknown as Row[];
    }

    /* ---------------------------- reference_material --------------------------- */

    if (
      sql.startsWith(
        'INSERT INTO reference_material (tier, department_id, document_type_id, title, section, content_kind, s3_key, inline_content)',
      )
    ) {
      this.mutationCount += 1;
      const row: ReferenceMaterialRow = {
        id: this.nextId('refmat'),
        tier: params[0] as 'department' | 'type',
        department_id: params[1] as string,
        document_type_id: (params[2] as string | null) ?? null,
        title: params[3] as string,
        section: (params[4] as string | null) ?? null,
        content_kind: params[5] as 'file' | 'text' | 'html',
        s3_key: (params[6] as string | null) ?? null,
        inline_content: (params[7] as string | null) ?? null,
      };
      this.referenceMaterials.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, tier, department_id, document_type_id, title, section, content_kind, s3_key, inline_content FROM reference_material WHERE id = $1',
      )
    ) {
      const row = this.referenceMaterials.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.includes(
        "FROM reference_material WHERE tier = 'department' AND department_id = $1",
      )
    ) {
      const rows = [...this.referenceMaterials.values()]
        .filter((r) => r.tier === 'department' && r.department_id === (params[0] as string))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.title.localeCompare(b.title));
      return rows as unknown as Row[];
    }

    if (
      sql.includes("FROM reference_material WHERE tier = 'type' AND document_type_id = $1")
    ) {
      const rows = [...this.referenceMaterials.values()]
        .filter((r) => r.tier === 'type' && r.document_type_id === (params[0] as string))
        .map((r) => ({ ...r }))
        .sort((a, b) => a.title.localeCompare(b.title));
      return rows as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM reference_material WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.referenceMaterials.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* ------------------------------- usage_limit ------------------------------- */

    if (sql.startsWith('INSERT INTO usage_limit (scope_kind, scope_id, limit_value, period)')) {
      this.mutationCount += 1;
      const row: UsageLimitRow = {
        id: this.nextId('ulimit'),
        scope_kind: params[0] as 'platform' | 'documentType',
        scope_id: (params[1] as string | null) ?? null,
        limit_value: params[2] as number,
        period: params[3] as string,
      };
      this.usageLimits.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT id, scope_kind, scope_id, limit_value, period FROM usage_limit WHERE id = $1')) {
      const row = this.usageLimits.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (sql.startsWith("SELECT id, scope_kind, scope_id, limit_value, period FROM usage_limit WHERE scope_kind = 'platform'")) {
      const row = [...this.usageLimits.values()].find((r) => r.scope_kind === 'platform');
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        "SELECT id, scope_kind, scope_id, limit_value, period FROM usage_limit WHERE scope_kind = 'documentType' AND scope_id = $1",
      )
    ) {
      const row = [...this.usageLimits.values()].find(
        (r) => r.scope_kind === 'documentType' && r.scope_id === (params[0] as string),
      );
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, scope_kind, scope_id, limit_value, period FROM usage_limit ORDER BY scope_kind ASC, scope_id ASC NULLS FIRST',
      )
    ) {
      const rows = [...this.usageLimits.values()]
        .map((r) => ({ ...r }))
        .sort((a, b) => {
          if (a.scope_kind !== b.scope_kind) return a.scope_kind.localeCompare(b.scope_kind);
          return (a.scope_id ?? '').localeCompare(b.scope_id ?? '');
        });
      return rows as unknown as Row[];
    }

    if (sql.startsWith('UPDATE usage_limit SET')) {
      const row = this.usageLimits.get(params[0] as string);
      if (!row) return [] as unknown as Row[];
      this.mutationCount += 1;
      const setClause = sql.slice('UPDATE usage_limit SET'.length, sql.indexOf('WHERE'));
      applyAssignments(setClause, row as unknown as Record<string, unknown>, params);
      return [{ ...row }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM usage_limit WHERE id = $1')) {
      const id = params[0] as string;
      const existed = this.usageLimits.delete(id);
      if (existed) this.mutationCount += 1;
      return (existed ? [{ id }] : []) as unknown as Row[];
    }

    /* ------------------------------ usage_counter ------------------------------ */

    if (
      sql.startsWith(
        "SELECT scope_kind, scope_id, period_start, consumed FROM usage_counter WHERE scope_kind = 'platform' AND period_start = $1",
      )
    ) {
      const periodStart = params[0] as Date;
      const row = this.usageCounters.find(
        (r) => r.scope_kind === 'platform' && r.period_start.getTime() === periodStart.getTime(),
      );
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        "SELECT scope_kind, scope_id, period_start, consumed FROM usage_counter WHERE scope_kind = 'documentType' AND scope_id = $1 AND period_start = $2",
      )
    ) {
      const [scopeId, periodStart] = params as [string, Date];
      const row = this.usageCounters.find(
        (r) =>
          r.scope_kind === 'documentType' &&
          r.scope_id === scopeId &&
          r.period_start.getTime() === periodStart.getTime(),
      );
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'INSERT INTO usage_counter (scope_kind, scope_id, period_start, consumed)',
      )
    ) {
      this.mutationCount += 1;
      const [scopeKind, scopeId, periodStart] = params as [
        'platform' | 'documentType',
        string | null,
        Date,
      ];
      const existing = this.usageCounters.find(
        (r) =>
          r.scope_kind === scopeKind &&
          r.scope_id === scopeId &&
          r.period_start.getTime() === periodStart.getTime(),
      );
      if (existing) {
        existing.consumed += 1;
        return [{ ...existing }] as unknown as Row[];
      }
      const row: UsageCounterRow = {
        scope_kind: scopeKind,
        scope_id: scopeId,
        period_start: periodStart,
        consumed: 1,
      };
      this.usageCounters.push(row);
      return [row] as unknown as Row[];
    }

    /* -------------------------------- override --------------------------------- */

    if (
      sql.startsWith(
        'INSERT INTO override (user_id, document_type_id, bounds, reason, granted_by, expires_at)',
      )
    ) {
      this.mutationCount += 1;
      const row: OverrideRow = {
        id: this.nextId('override'),
        user_id: params[0] as string,
        document_type_id: params[1] as string,
        bounds: params[2] as { additionalActions: number },
        reason: params[3] as string,
        granted_by: (params[4] as string | null) ?? null,
        expires_at: params[5] as Date,
      };
      this.overrides.set(row.id, row);
      return [row] as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, user_id, document_type_id, bounds, reason, granted_by, expires_at FROM override WHERE id = $1',
      )
    ) {
      const row = this.overrides.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (
      sql.startsWith(
        'SELECT id, user_id, document_type_id, bounds, reason, granted_by, expires_at FROM override WHERE user_id = $1 AND document_type_id = $2',
      )
    ) {
      const [userId, documentTypeId] = params as [string, string];
      const rows = [...this.overrides.values()]
        .filter((r) => r.user_id === userId && r.document_type_id === documentTypeId)
        .map((r) => ({ ...r }))
        .sort((a, b) => b.expires_at.getTime() - a.expires_at.getTime());
      return rows as unknown as Row[];
    }

    /* ---------------------------- activity_event -------------------------------- */

    if (sql.startsWith('INSERT INTO activity_event')) {
      this.mutationCount += 1;
      const row: ActivityEventRow = {
        id: this.nextId('event'),
        actor_pseudonym: params[0] as string,
        verb: params[1] as string,
        object_type: params[2] as string,
        object_ref: params[3] as string,
        document_type_id: (params[4] as string | null) ?? null,
        department_id: (params[5] as string | null) ?? null,
        timestamp: params[6] as Date,
        context: (params[7] as Record<string, unknown>) ?? {},
      };
      this.activityEvents.push(row);
      return [row] as unknown as Row[];
    }

    if (sql.startsWith('SELECT') && sql.includes('FROM activity_event WHERE document_type_id = $1')) {
      const [documentTypeId] = params as [string];
      const rows = this.activityEvents
        .filter((r) => r.document_type_id === documentTypeId)
        .map((r) => ({ ...r }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return rows as unknown as Row[];
    }

    if (sql.startsWith('SELECT') && sql.includes('FROM activity_event WHERE department_id = $1')) {
      const [departmentId] = params as [string];
      const rows = this.activityEvents
        .filter((r) => r.department_id === departmentId)
        .map((r) => ({ ...r }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return rows as unknown as Row[];
    }

    if (sql.startsWith('SELECT') && sql.includes('FROM activity_event ORDER BY')) {
      const rows = this.activityEvents
        .map((r) => ({ ...r }))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      return rows as unknown as Row[];
    }

    /* --------------------------- aggregate_counter ------------------------------ */

    if (
      sql.includes("FROM aggregate_counter") &&
      sql.includes("scope_kind = 'documentType' AND scope_id = ANY($1)")
    ) {
      const [documentTypeIds] = params as [string[]];
      const idSet = new Set(documentTypeIds);
      const rows = [...this.aggregateCounters.values()]
        .filter((r) => r.scope_kind === 'documentType' && r.scope_id !== null && idSet.has(r.scope_id))
        .map((r) => ({ ...r }))
        .sort(
          (a, b) =>
            a.metric.localeCompare(b.metric) ||
            a.window_start.getTime() - b.window_start.getTime() ||
            (a.scope_id ?? '').localeCompare(b.scope_id ?? ''),
        );
      return rows as unknown as Row[];
    }

    if (sql.includes("FROM aggregate_counter WHERE scope_kind = 'platform'")) {
      const rows = [...this.aggregateCounters.values()]
        .filter((r) => r.scope_kind === 'platform')
        .map((r) => ({ ...r }))
        .sort(
          (a, b) => a.metric.localeCompare(b.metric) || a.window_start.getTime() - b.window_start.getTime(),
        );
      return rows as unknown as Row[];
    }

    /* ----------------------- document deletion (Task 14.5) ---------------------- */

    if (sql.includes('FROM document WHERE id = $1') && sql.includes('SELECT') && !sql.includes('DELETE')) {
      const row = this.documents.get(params[0] as string);
      return (row ? [{ ...row }] : []) as unknown as Row[];
    }

    if (sql.includes('COUNT') && sql.includes('FROM draft WHERE document_id = $1') && !sql.includes('feedback_item')) {
      const count = [...this.drafts.values()].filter((d) => d.document_id === (params[0] as string)).length;
      return [{ count }] as unknown as Row[];
    }

    if (sql.includes('COUNT') && sql.includes('FROM feedback_item WHERE document_id = $1') && !sql.includes('resolution_status_history')) {
      const count = [...this.feedbackItems.values()].filter((f) => f.document_id === (params[0] as string)).length;
      return [{ count }] as unknown as Row[];
    }

    if (sql.includes('COUNT') && sql.includes('FROM anchor WHERE draft_id IN')) {
      const documentId = params[0] as string;
      const draftIds = new Set([...this.drafts.values()].filter((d) => d.document_id === documentId).map((d) => d.id));
      const count = [...this.anchors.values()].filter((a) => draftIds.has(a.draft_id)).length;
      return [{ count }] as unknown as Row[];
    }

    if (sql.includes('COUNT') && sql.includes('FROM resolution_status_history WHERE feedback_item_id IN')) {
      const documentId = params[0] as string;
      const feedbackItemIds = new Set([...this.feedbackItems.values()].filter((f) => f.document_id === documentId).map((f) => f.id));
      const count = [...this.resolutionStatusHistory.values()].filter((r) => feedbackItemIds.has(r.feedback_item_id)).length;
      return [{ count }] as unknown as Row[];
    }

    if (sql.includes("FROM activity_event WHERE object_ref = $1 AND object_type = 'Document'") && sql.includes('COUNT')) {
      const docId = params[0] as string;
      const count = this.activityEvents.filter((e) => e.object_ref === docId && e.object_type === 'Document').length;
      return [{ count }] as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM resolution_status_history WHERE feedback_item_id IN')) {
      this.mutationCount += 1;
      const documentId = params[0] as string;
      const feedbackItemIds = new Set([...this.feedbackItems.values()].filter((f) => f.document_id === documentId).map((f) => f.id));
      const deleted: ResolutionStatusHistoryRow[] = [];
      for (const [id, row] of this.resolutionStatusHistory) {
        if (feedbackItemIds.has(row.feedback_item_id)) {
          deleted.push(row);
          this.resolutionStatusHistory.delete(id);
        }
      }
      return deleted.map(() => ({ count: 1 })) as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM anchor WHERE draft_id IN')) {
      this.mutationCount += 1;
      const documentId = params[0] as string;
      const draftIds = new Set([...this.drafts.values()].filter((d) => d.document_id === documentId).map((d) => d.id));
      const deleted: AnchorRow[] = [];
      for (const [id, row] of this.anchors) {
        if (draftIds.has(row.draft_id)) {
          deleted.push(row);
          this.anchors.delete(id);
        }
      }
      return deleted.map(() => ({ count: 1 })) as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM feedback_item WHERE document_id = $1')) {
      this.mutationCount += 1;
      const documentId = params[0] as string;
      const deleted: FeedbackItemRow[] = [];
      for (const [id, row] of this.feedbackItems) {
        if (row.document_id === documentId) {
          deleted.push(row);
          this.feedbackItems.delete(id);
        }
      }
      return deleted.map(() => ({ count: 1 })) as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM draft WHERE document_id = $1')) {
      this.mutationCount += 1;
      const documentId = params[0] as string;
      const deleted: DraftRow[] = [];
      for (const [id, row] of this.drafts) {
        if (row.document_id === documentId) {
          deleted.push(row);
          this.drafts.delete(id);
        }
      }
      return deleted.map(() => ({ count: 1 })) as unknown as Row[];
    }

    if (sql.startsWith('DELETE FROM document WHERE id = $1')) {
      this.mutationCount += 1;
      this.documents.delete(params[0] as string);
      return [] as unknown as Row[];
    }

    /* -------------------- platform lifetime usage policy -------------------- */

    if (
      sql.includes('FROM platform_usage_policy WHERE id = 1') &&
      sql.includes('SELECT message_limit')
    ) {
      return (this.platformUsagePolicy ? [{ ...this.platformUsagePolicy }] : []) as unknown as Row[];
    }

    if (sql.startsWith('UPDATE platform_usage_policy SET')) {
      this.mutationCount += 1;
      const next: PlatformUsagePolicyRow = {
        id: 1,
        message_limit: params[0] as number,
        debrief_generation_limit: params[1] as number,
        document_upload_limit: params[2] as number,
        drafts_per_document_limit: params[3] as number,
        max_upload_file_size_bytes: params[4] as number,
        max_word_count: params[5] as number,
      };
      this.platformUsagePolicy = next;
      return [{ ...next }] as unknown as Row[];
    }

    if (sql.startsWith('INSERT INTO platform_usage_policy')) {
      this.mutationCount += 1;
      const next: PlatformUsagePolicyRow = {
        id: 1,
        message_limit: params[0] as number,
        debrief_generation_limit: params[1] as number,
        document_upload_limit: params[2] as number,
        drafts_per_document_limit: params[3] as number,
        max_upload_file_size_bytes: params[4] as number,
        max_word_count: params[5] as number,
      };
      this.platformUsagePolicy = next;
      return [] as unknown as Row[];
    }

    if (sql.startsWith('SELECT COUNT(*)::int AS count FROM document WHERE owner_user_id = $1')) {
      const count = [...this.documents.values()].filter(
        (d) => d.owner_user_id === (params[0] as string),
      ).length;
      return [{ count }] as unknown as Row[];
    }

    if (sql.startsWith('SELECT document_upload_count FROM user_lifetime_usage WHERE user_id = $1')) {
      const row = this.userLifetimeUsage.get(params[0] as string);
      return (row ? [{ document_upload_count: row.document_upload_count }] : []) as unknown as Row[];
    }

    if (sql.startsWith('SELECT draft_create_count FROM document WHERE id = $1')) {
      const row = this.documents.get(params[0] as string);
      return (row
        ? [{ draft_create_count: row.draft_create_count ?? 0 }]
        : []) as unknown as Row[];
    }

    if (sql.includes('INSERT INTO user_lifetime_usage')) {
      this.mutationCount += 1;
      const userId = params[0] as string;
      const limit = params[1] as number;
      if (limit <= 0) return [] as unknown as Row[];
      const existing = this.userLifetimeUsage.get(userId);
      if (!existing) {
        this.userLifetimeUsage.set(userId, { document_upload_count: 1 });
        return [{ document_upload_count: 1 }] as unknown as Row[];
      }
      if (existing.document_upload_count >= limit) return [] as unknown as Row[];
      existing.document_upload_count += 1;
      return [{ document_upload_count: existing.document_upload_count }] as unknown as Row[];
    }

    if (
      sql.startsWith('UPDATE document') &&
      sql.includes('SET draft_create_count = draft_create_count + 1')
    ) {
      this.mutationCount += 1;
      const row = this.documents.get(params[0] as string);
      const limit = params[1] as number;
      if (!row) return [] as unknown as Row[];
      const current = row.draft_create_count ?? 0;
      if (current >= limit) return [] as unknown as Row[];
      row.draft_create_count = current + 1;
      return [{ draft_create_count: row.draft_create_count }] as unknown as Row[];
    }

    if (sql.startsWith('SELECT debrief_generation_count FROM document WHERE id = $1')) {
      const row = this.documents.get(params[0] as string);
      return (row
        ? [{ debrief_generation_count: row.debrief_generation_count ?? 0 }]
        : []) as unknown as Row[];
    }

    if (
      sql.startsWith('UPDATE document') &&
      sql.includes('SET debrief_generation_count = debrief_generation_count + 1')
    ) {
      this.mutationCount += 1;
      const row = this.documents.get(params[0] as string);
      const limit = params[1] as number;
      if (!row) return [] as unknown as Row[];
      const current = row.debrief_generation_count ?? 0;
      if (current >= limit) return [] as unknown as Row[];
      row.debrief_generation_count = current + 1;
      return [{ debrief_generation_count: row.debrief_generation_count }] as unknown as Row[];
    }

    throw new Error(`FakeDb: unhandled SQL: ${sql}`);
  }
}
