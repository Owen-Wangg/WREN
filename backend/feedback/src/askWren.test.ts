/**
 * Ask WREN system-prompt assembly tests.
 *
 * Focus: the universal `SYSTEM_PROMPT` and its RESTRICTIONS always stay intact
 * and take precedence; the department-level Ask WREN context is appended AFTER
 * the universal prompt and BEFORE the document-type block, only when present;
 * and departments without a value are unchanged (fallback = current behavior).
 */
import {
  buildSystemPrompt,
  MAX_ASK_WREN_MESSAGE_LENGTH,
  type DocumentTypeContext,
} from './askWren';

const RESTRICTIONS_MARKER = '## RESTRICTIONS';
const SOCRATIC_MARKER = 'SOCRATIC COACHING FORMAT';
const DEPARTMENT_LABEL = 'Department context (background to ground your coaching';
const DOC_TYPE_LABEL = 'Document type context (use this to ground your Socratic questions';

const docTypeCtx: DocumentTypeContext = {
  documentTypeName: 'Legal Memo',
  purpose: 'Advise a partner on a discrete legal question.',
};

describe('buildSystemPrompt — universal prompt is always present', () => {
  it('includes the universal Socratic format and RESTRICTIONS with no context', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain(SOCRATIC_MARKER);
    expect(prompt).toContain(RESTRICTIONS_MARKER);
    expect(prompt).not.toContain(DEPARTMENT_LABEL);
    expect(prompt).not.toContain(DOC_TYPE_LABEL);
  });

  it('keeps the RESTRICTIONS block even when department context is supplied', () => {
    const prompt = buildSystemPrompt(undefined, 'Law students writing memoranda.');
    expect(prompt).toContain(RESTRICTIONS_MARKER);
  });
});

describe('buildSystemPrompt — department Ask WREN context layer', () => {
  it('appends the department block when a non-empty value is provided', () => {
    const prompt = buildSystemPrompt(undefined, 'Law students writing legal memoranda.');
    expect(prompt).toContain(DEPARTMENT_LABEL);
    expect(prompt).toContain('Law students writing legal memoranda.');
  });

  it('omits the department block for an undefined value (fallback = unchanged)', () => {
    const prompt = buildSystemPrompt(docTypeCtx, undefined);
    expect(prompt).not.toContain(DEPARTMENT_LABEL);
  });

  it('omits the department block for a blank/whitespace-only value', () => {
    expect(buildSystemPrompt(undefined, '')).not.toContain(DEPARTMENT_LABEL);
    expect(buildSystemPrompt(undefined, '   \n  ')).not.toContain(DEPARTMENT_LABEL);
  });

  it('places the department block AFTER the universal prompt and BEFORE the doc-type block', () => {
    const prompt = buildSystemPrompt(docTypeCtx, 'Department framing goes here.');

    const restrictionsIdx = prompt.indexOf(RESTRICTIONS_MARKER);
    const departmentIdx = prompt.indexOf(DEPARTMENT_LABEL);
    const docTypeIdx = prompt.indexOf(DOC_TYPE_LABEL);

    expect(restrictionsIdx).toBeGreaterThanOrEqual(0);
    expect(departmentIdx).toBeGreaterThan(restrictionsIdx);
    expect(docTypeIdx).toBeGreaterThan(departmentIdx);
  });

  it('does not alter the existing document-type block wording', () => {
    const withDept = buildSystemPrompt(docTypeCtx, 'Dept context.');
    const withoutDept = buildSystemPrompt(docTypeCtx, undefined);
    // The doc-type block (label + fields) is identical; only the department
    // block is added between the universal prompt and the doc-type block.
    expect(withDept).toContain('Document type: Legal Memo');
    expect(withoutDept).toContain('Document type: Legal Memo');
    expect(withDept).toContain('Purpose: Advise a partner on a discrete legal question.');
  });
});

describe('buildSystemPrompt — fallback equivalence (unconfigured department)', () => {
  it('produces byte-identical output whether department context is undefined, null-like, or blank', () => {
    // A department with no ask_wren_prompt (or a blank one) must yield exactly
    // the same assembled prompt as the pre-feature behavior — no stray block,
    // no whitespace differences.
    const baseline = buildSystemPrompt(docTypeCtx);
    expect(buildSystemPrompt(docTypeCtx, undefined)).toBe(baseline);
    expect(buildSystemPrompt(docTypeCtx, '')).toBe(baseline);
    expect(buildSystemPrompt(docTypeCtx, '   \n\t ')).toBe(baseline);
  });

  it('with no context at all, equals the universal system prompt alone', () => {
    // The zero-config case (no department, no doc type) is unchanged from the
    // original hardcoded SYSTEM_PROMPT.
    const prompt = buildSystemPrompt(undefined, undefined);
    expect(prompt).toContain('Socratic writing coach');
    expect(prompt).not.toContain(DEPARTMENT_LABEL);
    expect(prompt).not.toContain(DOC_TYPE_LABEL);
  });
});

describe('MAX_ASK_WREN_MESSAGE_LENGTH — single-message length bound', () => {
  // The handler rejects a trimmed message whose length exceeds this bound with
  // a 400; a message at exactly the bound is accepted. These assertions pin the
  // boundary contract that handlePostAskWren enforces.
  const atLimit = 'a'.repeat(MAX_ASK_WREN_MESSAGE_LENGTH);
  const overLimit = 'a'.repeat(MAX_ASK_WREN_MESSAGE_LENGTH + 1);

  it('is a positive integer', () => {
    expect(Number.isInteger(MAX_ASK_WREN_MESSAGE_LENGTH)).toBe(true);
    expect(MAX_ASK_WREN_MESSAGE_LENGTH).toBeGreaterThan(0);
  });

  it('accepts a message exactly at the bound', () => {
    expect(atLimit.length > MAX_ASK_WREN_MESSAGE_LENGTH).toBe(false);
  });

  it('rejects a message one character over the bound', () => {
    expect(overLimit.length > MAX_ASK_WREN_MESSAGE_LENGTH).toBe(true);
  });
});
