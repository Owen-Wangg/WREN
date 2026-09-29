/**
 * Unit tests for audit recording of sensitive actions
 * (Requirements 11.5, 23.3, 32.6, 45.2, 54.6; Task 14.7).
 */
import { FakeDb } from './fakeDb';
import { deptAdminContext, techAdminContext } from './testContexts';
import {
  auditConfigEdit,
  auditDepartmentVisibilityChange,
  auditGuardrailOutcome,
  auditOverrideGrant,
  auditPromptEdit,
  auditRoleOrGrantChange,
} from './auditRecordingService';
import { setPseudonymSaltLoader } from './activityLogService';

beforeAll(() => { setPseudonymSaltLoader(async () => 'test-salt-audit'); });
afterAll(() => { setPseudonymSaltLoader(undefined); });

describe('auditConfigEdit (Requirement 23.3)', () => {
  it('records a config edit with actor, Document Type, field, and action', async () => {
    const db = new FakeDb();
    const actor = deptAdminContext(['dept-1']);

    await auditConfigEdit(actor, {
      documentTypeId: 'dt-1',
      departmentId: 'dept-1',
      field: 'errorCategory',
      action: 'created',
      description: 'Added "Citation Format" category',
    }, db);

    expect(db.activityEvents).toHaveLength(1);
    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('config.created');
    expect(event.object_type).toBe('Config');
    expect(event.object_ref).toContain('errorCategory');
    expect(event.document_type_id).toBe('dt-1');
    expect(event.department_id).toBe('dept-1');
    expect(event.context).toMatchObject({
      role: 'DepartmentAdmin',
      field: 'errorCategory',
      action: 'created',
      description: 'Added "Citation Format" category',
    });
  });

  it('records update and delete actions', async () => {
    const db = new FakeDb();
    const actor = deptAdminContext(['dept-1']);

    await auditConfigEdit(actor, { documentTypeId: 'dt-1', field: 'density', action: 'updated' }, db);
    await auditConfigEdit(actor, { documentTypeId: 'dt-1', field: 'errorCategory', action: 'deleted' }, db);

    expect(db.activityEvents).toHaveLength(2);
    expect(db.activityEvents[0]!.verb).toBe('config.updated');
    expect(db.activityEvents[1]!.verb).toBe('config.deleted');
  });
});

describe('auditPromptEdit (Requirement 32.6)', () => {
  it('records a Document-Type prompt edit with guardrail outcome = passed', async () => {
    const db = new FakeDb();
    const actor = deptAdminContext(['dept-1']);

    await auditPromptEdit(actor, {
      documentTypeId: 'dt-1',
      departmentId: 'dept-1',
      scope: 'documentType',
      guardrailOutcome: 'passed',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('prompt.edited');
    expect(event.object_type).toBe('Prompt');
    expect(event.context).toMatchObject({
      role: 'DepartmentAdmin',
      scope: 'documentType',
      guardrailOutcome: 'passed',
    });
  });

  it('records a system-scope prompt edit with guardrail rejection reason', async () => {
    const db = new FakeDb();
    const actor = techAdminContext();

    await auditPromptEdit(actor, {
      scope: 'system',
      guardrailOutcome: 'rejected',
      rejectionReason: 'Contains "suggest a revised version"',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.object_ref).toBe('system-scaffolding');
    expect(event.context).toMatchObject({
      role: 'TechnicalAdmin',
      scope: 'system',
      guardrailOutcome: 'rejected',
      rejectionReason: 'Contains "suggest a revised version"',
    });
  });

  it('records a department Ask WREN prompt edit scoped to the department', async () => {
    const db = new FakeDb();
    const actor = deptAdminContext(['dept-1']);

    await auditPromptEdit(actor, {
      departmentId: 'dept-1',
      scope: 'department',
      guardrailOutcome: 'passed',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('prompt.edited');
    expect(event.object_type).toBe('Prompt');
    expect(event.object_ref).toBe('department:dept-1');
    expect(event.department_id).toBe('dept-1');
    expect(event.context).toMatchObject({
      role: 'DepartmentAdmin',
      scope: 'department',
      guardrailOutcome: 'passed',
    });
  });

  it('records a rejected department Ask WREN prompt edit with the reason', async () => {
    const db = new FakeDb();
    const actor = deptAdminContext(['dept-1']);

    await auditPromptEdit(actor, {
      departmentId: 'dept-1',
      scope: 'department',
      guardrailOutcome: 'rejected',
      rejectionReason: 'Prompt content rejected: ghostwriting instruction',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.object_ref).toBe('department:dept-1');
    expect(event.context).toMatchObject({
      scope: 'department',
      guardrailOutcome: 'rejected',
      rejectionReason: 'Prompt content rejected: ghostwriting instruction',
    });
  });
});

describe('auditRoleOrGrantChange (Requirement 45.2)', () => {
  it('records a role assignment', async () => {
    const db = new FakeDb();
    const actor = techAdminContext();

    await auditRoleOrGrantChange(actor, {
      action: 'role.assigned',
      targetUserId: 'user-student',
      targetRole: 'DepartmentAdmin',
      departmentId: 'dept-1',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('role.assigned');
    expect(event.object_type).toBe('RoleAssignment');
    expect(event.object_ref).toBe('user-student');
    expect(event.context).toMatchObject({
      role: 'TechnicalAdmin',
      targetUserId: 'user-student',
      targetRole: 'DepartmentAdmin',
    });
  });

  it('records an access grant creation', async () => {
    const db = new FakeDb();
    const actor = deptAdminContext(['dept-1']);

    await auditRoleOrGrantChange(actor, {
      action: 'grant.created',
      targetUserId: 'student-1',
      documentTypeId: 'dt-1',
      departmentId: 'dept-1',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('grant.created');
    expect(event.object_type).toBe('AccessGrant');
    expect(event.document_type_id).toBe('dt-1');
  });

  it('records a grant revocation', async () => {
    const db = new FakeDb();
    const actor = deptAdminContext(['dept-1']);

    await auditRoleOrGrantChange(actor, {
      action: 'grant.revoked',
      targetUserId: 'student-2',
      documentTypeId: 'dt-1',
    }, db);

    expect(db.activityEvents[0]!.verb).toBe('grant.revoked');
  });
});

describe('auditDepartmentVisibilityChange', () => {
  it('records state transitions without email or other user profile data', async () => {
    const db = new FakeDb();
    await auditDepartmentVisibilityChange(
      techAdminContext(),
      {
        action: 'department.visibility.updated',
        departmentId: 'dept-1',
        previousState: 'VISIBLE',
        newState: 'PERMITTED_ONLY',
      },
      db,
    );

    expect(db.activityEvents[0]).toMatchObject({
      verb: 'department.visibility.updated',
      object_type: 'Department',
      object_ref: 'dept-1',
      department_id: 'dept-1',
      context: {
        role: 'TechnicalAdmin',
        previousState: 'VISIBLE',
        newState: 'PERMITTED_ONLY',
      },
    });
  });

  it('records grant identity and target user id but no email', async () => {
    const db = new FakeDb();
    await auditDepartmentVisibilityChange(
      techAdminContext(),
      {
        action: 'department_visibility_grant.created',
        departmentId: 'dept-1',
        grantId: 'grant-1',
        targetUserId: 'user-1',
      },
      db,
    );

    const event = db.activityEvents[0]!;
    expect(event.object_type).toBe('DepartmentVisibilityGrant');
    expect(event.object_ref).toBe('grant-1');
    expect(event.context).toMatchObject({ targetUserId: 'user-1' });
    expect(JSON.stringify(event.context)).not.toContain('@');
  });
});

describe('auditOverrideGrant (Requirement 54.6)', () => {
  it('records the granting actor, role, affected Student, Document Type, reason, and bounds', async () => {
    const db = new FakeDb();
    const actor = deptAdminContext(['dept-1']);

    await auditOverrideGrant(actor, {
      userId: 'student-1',
      documentTypeId: 'dt-1',
      departmentId: 'dept-1',
      reason: 'Extension granted for final exam prep.',
      bounds: { additionalActions: 5 },
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('override.granted');
    expect(event.object_type).toBe('Override');
    expect(event.object_ref).toBe('student-1:dt-1');
    expect(event.document_type_id).toBe('dt-1');
    expect(event.context).toMatchObject({
      role: 'DepartmentAdmin',
      affectedUserId: 'student-1',
      reason: 'Extension granted for final exam prep.',
      bounds: { additionalActions: 5 },
    });
  });

  it('works for a TechnicalAdmin grantor', async () => {
    const db = new FakeDb();
    const actor = techAdminContext();

    await auditOverrideGrant(actor, {
      userId: 'student-3',
      documentTypeId: 'dt-2',
      reason: 'Platform accommodation.',
      bounds: { additionalActions: 10 },
    }, db);

    expect(db.activityEvents[0]!.context).toMatchObject({ role: 'TechnicalAdmin' });
  });
});

describe('auditGuardrailOutcome (Requirement 11.5, 38.4)', () => {
  it('records a passed guardrail check', async () => {
    const db = new FakeDb();

    await auditGuardrailOutcome({
      documentId: 'doc-1',
      documentTypeId: 'dt-1',
      outcome: 'passed',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('guardrail.passed');
    expect(event.object_type).toBe('FeedbackGeneration');
    expect(event.object_ref).toBe('doc-1');
    expect(event.context).toMatchObject({ outcome: 'passed' });
  });

  it('records a guardrail violation rejection with a description', async () => {
    const db = new FakeDb();

    await auditGuardrailOutcome({
      documentId: 'doc-2',
      documentTypeId: 'dt-1',
      outcome: 'violation_rejected',
      description: 'Model output contained replacement prose.',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('guardrail.violation_rejected');
    expect(event.context).toMatchObject({
      outcome: 'violation_rejected',
      description: 'Model output contained replacement prose.',
    });
  });

  it('records a prompt-injection mitigation', async () => {
    const db = new FakeDb();

    await auditGuardrailOutcome({
      documentId: 'doc-3',
      outcome: 'injection_mitigated',
      description: 'Detected "ignore previous instructions" in submitted text.',
    }, db);

    const event = db.activityEvents[0]!;
    expect(event.verb).toBe('guardrail.injection_mitigated');
  });

  it('uses a system actor (not attributed to a student)', async () => {
    const db = new FakeDb();

    await auditGuardrailOutcome({
      documentId: 'doc-1',
      outcome: 'passed',
    }, db);

    // The actor pseudonym should NOT be a student userId — it is derived from '__system__'.
    const event = db.activityEvents[0]!;
    expect(event.actor_pseudonym).not.toBe('__system__');
    expect(event.actor_pseudonym.length).toBeGreaterThan(10); // SHA-256 hex
  });
});
