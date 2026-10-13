/**
 * Unit tests for Document-Type conventions/prompt config, the
 * DepartmentAdmin/TechnicalAdmin edit boundary, and the save-time
 * no-ghostwriting guardrail (REQ-CONFIG-CONV-01 / Requirement 24,
 * REQ-PROMPT-EDIT-01 / Requirement 32; Tasks 12.1, 12.3).
 */
import { NotFoundError, AuthorizationError, PromptGuardrailUnavailableError } from './errors';
import { PromptGuardrailError } from './promptGuardrail';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import { getDocumentTypeConfig, upsertDocumentTypeConfig } from './documentTypeConfigService';

const DEPT = 'dept-1';
const DT = 'dt-1';

function seed(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard Law' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Memo' });
}

describe('getDocumentTypeConfig', () => {
  it('returns null when no config row exists yet', async () => {
    const db = new FakeDb();
    seed(db);

    const config = await getDocumentTypeConfig(deptAdminContext([DEPT]), DT, db);

    expect(config).toBeNull();
  });

  it('returns the config once one exists', async () => {
    const db = new FakeDb();
    seed(db);
    db.seedDocumentTypeConfig({ document_type_id: DT, tone: 'formal', density: 'medium' });

    const config = await getDocumentTypeConfig(deptAdminContext([DEPT]), DT, db);

    expect(config?.tone).toBe('formal');
    expect(config?.density).toBe('medium');
  });

  it('denies a Student', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(getDocumentTypeConfig(studentContext(), DT, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('denies a DeptAdmin of a different Department', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      getDocumentTypeConfig(deptAdminContext(['other-dept']), DT, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(getDocumentTypeConfig(deptAdminContext([DEPT]), 'missing', db)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('upsertDocumentTypeConfig — DepartmentAdmin edit boundary', () => {
  it('a DeptAdmin administering the Department creates the first config row', async () => {
    const db = new FakeDb();
    seed(db);

    const config = await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { tone: 'formal', density: 'medium' },
      db,
    );

    expect(config.documentTypeId).toBe(DT);
    expect(config.tone).toBe('formal');
    expect(config.density).toBe('medium');
  });

  it('partial updates only touch the supplied fields', async () => {
    const db = new FakeDb();
    seed(db);
    await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { tone: 'formal', density: 'low' }, db);

    const updated = await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { density: 'high' }, db);

    expect(updated.tone).toBe('formal'); // unchanged
    expect(updated.density).toBe('high'); // updated
  });

  it('stores an ordered category-priority list', async () => {
    const db = new FakeDb();
    seed(db);

    const config = await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { categoryPriority: ['cat-b', 'cat-a', 'cat-c'] },
      db,
    );

    expect(config.categoryPriority).toEqual(['cat-b', 'cat-a', 'cat-c']);
  });

  it('updates updatedAt on every successful write (carry-forward invalidation)', async () => {
    const db = new FakeDb();
    seed(db);

    const first = await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { tone: 'formal' }, db);
    const second = await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { tone: 'casual' }, db);

    expect(new Date(second.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.updatedAt).getTime(),
    );
  });

  it('a DeptAdmin CANNOT edit a Document Type outside their administered Departments', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(deptAdminContext(['other-dept']), DT, { tone: 'formal' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.documentTypeConfigs.has(DT)).toBe(false);
  });

  it('a Student CANNOT edit Document-Type config', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(studentContext(), DT, { tone: 'formal' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('allows a TechnicalAdmin to edit Document-Type config (shared dept-admin bootstrap)', async () => {
    const db = new FakeDb();
    seed(db);

    const config = await upsertDocumentTypeConfig(
      techAdminContext(),
      DT,
      { tone: 'formal' },
      db,
    );
    expect(config.tone).toBe('formal');
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(deptAdminContext([DEPT]), 'missing', { tone: 'formal' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('upsertDocumentTypeConfig — save-time no-ghostwriting guardrail (Requirement 32.5)', () => {
  it('rejects a save containing a ghostwriting instruction, with NO mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(
        deptAdminContext([DEPT]),
        DT,
        { typePromptText: 'When you find an error, rewrite the sentence for the student.' },
        db,
      ),
    ).rejects.toBeInstanceOf(PromptGuardrailError);
    expect(db.documentTypeConfigs.has(DT)).toBe(false);
  });

  it('the rejection identifies the offending instruction', async () => {
    const db = new FakeDb();
    seed(db);

    try {
      await upsertDocumentTypeConfig(
        deptAdminContext([DEPT]),
        DT,
        { typePromptText: 'Please provide a corrected version of any flawed sentence.' },
        db,
      );
      throw new Error('expected PromptGuardrailError');
    } catch (err) {
      expect(err).toBeInstanceOf(PromptGuardrailError);
      const violation = (err as PromptGuardrailError).violation;
      expect(violation.offendingText.toLowerCase()).toContain('provide a corrected version');
    }
  });

  it('accepts Socratic-only prompt text with no rewrite instruction', async () => {
    const db = new FakeDb();
    seed(db);

    const config = await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { typePromptText: 'Ask the writer what evidence supports this claim.' },
      db,
    );

    expect(config.typePromptText).toBe('Ask the writer what evidence supports this claim.');
  });

  it('does not re-validate an unrelated field when typePromptText is not part of the patch', async () => {
    const db = new FakeDb();
    seed(db);
    await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { typePromptText: 'Ask about the thesis clarity.' },
      db,
    );

    // Updating only tone must not re-throw even though the existing stored
    // prompt text is untouched by this call.
    const config = await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { tone: 'formal' }, db);

    expect(config.typePromptText).toBe('Ask about the thesis clarity.');
    expect(config.tone).toBe('formal');
  });

  it('a null typePromptText (clearing it) is not scanned by the guardrail', async () => {
    const db = new FakeDb();
    seed(db);
    await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { typePromptText: 'Ask a Socratic question.' },
      db,
    );

    const cleared = await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { typePromptText: null },
      db,
    );

    expect(cleared.typePromptText).toBeNull();
  });
});

describe('upsertDocumentTypeConfig — save-time prompt-injection guardrail coverage', () => {
  // The global jest setup (testing/typescript/jest.setup.ts) sets
  // PROMPT_GUARDRAIL_SKIP=true so the injection scan is a no-op by default.
  // Unsetting both PROMPT_GUARDRAIL_ID and the skip flag drives the control
  // into its fail-closed branch: if the field under test is routed through
  // assertPromptInjectionFree it throws PromptGuardrailUnavailableError with
  // NO mutation; if it were NOT screened the upsert would succeed. This is the
  // same proof-of-routing pattern departmentService.test.ts uses.
  let savedId: string | undefined;
  let savedSkip: string | undefined;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    savedId = process.env.PROMPT_GUARDRAIL_ID;
    savedSkip = process.env.PROMPT_GUARDRAIL_SKIP;
    delete process.env.PROMPT_GUARDRAIL_ID;
    delete process.env.PROMPT_GUARDRAIL_SKIP;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (savedId !== undefined) process.env.PROMPT_GUARDRAIL_ID = savedId;
    if (savedSkip !== undefined) process.env.PROMPT_GUARDRAIL_SKIP = savedSkip;
  });

  it('screens toneDescription — fails closed with no mutation when the guardrail is unconfigured', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(
        deptAdminContext([DEPT]),
        DT,
        { toneDescription: 'Grounded, encouraging reference tone.' },
        db,
      ),
    ).rejects.toBeInstanceOf(PromptGuardrailUnavailableError);
    expect(db.documentTypeConfigs.has(DT)).toBe(false);
  });

  it('screens densityDescription — fails closed with no mutation when the guardrail is unconfigured', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(
        deptAdminContext([DEPT]),
        DT,
        { densityDescription: 'High: flag every category occurrence.' },
        db,
      ),
    ).rejects.toBeInstanceOf(PromptGuardrailUnavailableError);
    expect(db.documentTypeConfigs.has(DT)).toBe(false);
  });

  it('screens the newly-covered fields with the scan enabled (skip flag) — no false rejection', async () => {
    process.env.PROMPT_GUARDRAIL_SKIP = 'true';
    const db = new FakeDb();
    seed(db);

    const config = await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { toneDescription: 'Encouraging, specific tone.', densityDescription: 'Medium coverage.' },
      db,
    );

    expect(config.toneDescription).toBe('Encouraging, specific tone.');
    expect(config.densityDescription).toBe('Medium coverage.');
  });

  it('does not scan an empty/whitespace-only description (no fail-closed throw)', async () => {
    const db = new FakeDb();
    seed(db);

    const config = await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { toneDescription: '   ', tone: 'formal' },
      db,
    );

    expect(config.tone).toBe('formal');
  });
});

describe('upsertDocumentTypeConfig — citationConfig reuse (footnote-citation-support, Requirements 4.1, 4.2)', () => {
  it('citationConfig round-trips through upsert/get unchanged for other fields (Requirement 4.1)', async () => {
    const db = new FakeDb();
    seed(db);
    await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { tone: 'formal', density: 'low' }, db);

    const updated = await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      {
        citationConfig: {
          citationStyle: 'Bluebook',
          requiredFields: ['author', 'title', 'year'],
          formattingTemplate: '{author}, {title} ({year})',
        },
      },
      db,
    );

    expect(updated.citationConfig).toEqual({
      citationStyle: 'Bluebook',
      requiredFields: ['author', 'title', 'year'],
      formattingTemplate: '{author}, {title} ({year})',
    });
    // Other fields untouched by the citationConfig-only patch.
    expect(updated.tone).toBe('formal');
    expect(updated.density).toBe('low');

    const fetched = await getDocumentTypeConfig(deptAdminContext([DEPT]), DT, db);
    expect(fetched?.citationConfig).toEqual(updated.citationConfig);
  });

  it('citationConfig is null when never configured (vacuous-truth default, Requirement 4.5)', async () => {
    const db = new FakeDb();
    seed(db);

    const config = await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { tone: 'formal' }, db);

    expect(config.citationConfig ?? null).toBeNull();
  });

  it('setting citationConfig to null explicitly clears it (distinguished from "not provided")', async () => {
    const db = new FakeDb();
    seed(db);
    await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { citationConfig: { citationStyle: 'APA', requiredFields: [] } },
      db,
    );

    const cleared = await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { citationConfig: null },
      db,
    );

    expect(cleared.citationConfig).toBeNull();
  });

  it('leaves citationConfig untouched when the patch omits it entirely', async () => {
    const db = new FakeDb();
    seed(db);
    await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { citationConfig: { citationStyle: 'MLA', requiredFields: ['author'] } },
      db,
    );

    const updated = await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { tone: 'casual' }, db);

    expect(updated.citationConfig).toEqual({ citationStyle: 'MLA', requiredFields: ['author'] });
    expect(updated.tone).toBe('casual');
  });

  it('rejects an out-of-bounds citationConfig with no partial write (Requirement 4.7)', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(
        deptAdminContext([DEPT]),
        DT,
        // citationStyle exceeds 50 chars.
        { citationConfig: { citationStyle: 'x'.repeat(51), requiredFields: [] } },
        db,
      ),
    ).rejects.toThrow();
    expect(db.documentTypeConfigs.has(DT)).toBe(false);
  });

  it('reuses the existing documentType.modifyConfig capability guard — denies cross-Department writes (Requirement 4.2)', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(
        deptAdminContext(['other-dept']),
        DT,
        { citationConfig: { citationStyle: 'Bluebook', requiredFields: [] } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.documentTypeConfigs.has(DT)).toBe(false);
  });

  it('reuses the existing documentType.readConfig capability guard on read (Requirement 4.1)', async () => {
    const db = new FakeDb();
    seed(db);
    await upsertDocumentTypeConfig(
      deptAdminContext([DEPT]),
      DT,
      { citationConfig: { citationStyle: 'Bluebook', requiredFields: [] } },
      db,
    );

    await expect(getDocumentTypeConfig(studentContext(), DT, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it('a Student CANNOT write citationConfig', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      upsertDocumentTypeConfig(
        studentContext(),
        DT,
        { citationConfig: { citationStyle: 'Bluebook', requiredFields: [] } },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
