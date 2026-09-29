/**
 * Audit recording for sensitive actions (REQ-AUDIT-01 / Requirements 11.5,
 * 23.3, 32.6, 45.2; Task 14.7).
 *
 * This module provides thin wrappers around {@link recordActivityEvent} for
 * the specific sensitive actions the design identifies as requiring an audit
 * trail:
 *
 *   - Configuration edits (taxonomy, prompt, convention changes) →
 *     Requirement 23.3, 32.6.
 *   - Role/grant changes (role assignment/revocation, access grant
 *     creation/revocation) → Requirement 45.2.
 *   - Usage-limit override grants → Requirement 54.6 (via 45.2).
 *   - Guardrail outcomes (ghostwriting detection, prompt-injection
 *     mitigation) → Requirement 11.5, 38.4.
 *
 * Each audit helper records the actor, role, Document Type (or system scope),
 * timestamp, and operation-specific context into the activity log in a
 * structured way, so the audit trail is both human-readable and
 * machine-queryable.
 *
 * The caller is responsible for invoking the appropriate helper immediately
 * after a successful operation — these helpers are side-effect recorders, not
 * authorization guards. The audit helpers use
 * {@link recordActivityEvent} internally, which pseudonymizes the actor
 * automatically (Requirement 44.4).
 */
import { recordActivityEvent } from './activityLogService';
import type { QueryExecutor } from './db';
import type { AuthContext } from '@wren/types';

/**
 * Record an audit event for a configuration edit (taxonomy, prompt, convention
 * change). Requirement 23.3: "record Department Admin configuration changes
 * with the actor, Document Type, and timestamp."
 */
export async function auditConfigEdit(
  actor: AuthContext,
  detail: {
    documentTypeId: string;
    departmentId?: string;
    field: string;
    action: 'created' | 'updated' | 'deleted';
    description?: string;
  },
  db: QueryExecutor,
): Promise<void> {
  await recordActivityEvent(
    {
      actorUserId: actor.userId,
      verb: `config.${detail.action}`,
      objectType: 'Config',
      objectRef: `${detail.field}:${detail.documentTypeId}`,
      documentTypeId: detail.documentTypeId,
      departmentId: detail.departmentId,
      context: {
        role: actor.roles[0],
        field: detail.field,
        action: detail.action,
        ...(detail.description ? { description: detail.description } : {}),
      },
    },
    db,
  );
}

/**
 * Record an audit event for a prompt edit specifically. Requirement 32.6:
 * "record each prompt edit with the actor, role, Document Type (or system
 * scope), timestamp, and the guardrail validation outcome."
 */
export async function auditPromptEdit(
  actor: AuthContext,
  detail: {
    documentTypeId?: string;
    departmentId?: string;
    /**
     * Which prompt surface was edited:
     *  - `documentType` — Document-Type prompt config (`type_prompt_text`).
     *  - `system`       — TechnicalAdmin-owned Feedback-Engine `department.prompt`.
     *  - `department`   — DepartmentAdmin-owned department Ask WREN prompt
     *                     (`department.ask_wren_prompt`).
     */
    scope: 'documentType' | 'system' | 'department';
    guardrailOutcome: 'passed' | 'rejected';
    rejectionReason?: string;
  },
  db: QueryExecutor,
): Promise<void> {
  const objectRef =
    detail.scope === 'system'
      ? 'system-scaffolding'
      : detail.scope === 'department'
        ? `department:${detail.departmentId}`
        : `documentType:${detail.documentTypeId}`;
  await recordActivityEvent(
    {
      actorUserId: actor.userId,
      verb: 'prompt.edited',
      objectType: 'Prompt',
      objectRef,
      documentTypeId: detail.documentTypeId,
      departmentId: detail.departmentId,
      context: {
        role: actor.roles[0],
        scope: detail.scope,
        guardrailOutcome: detail.guardrailOutcome,
        ...(detail.rejectionReason ? { rejectionReason: detail.rejectionReason } : {}),
      },
    },
    db,
  );
}

/**
 * Record an audit event for a platform-policy change made by a TechnicalAdmin
 * (Issue #187): the active Bedrock model id (`handleUpdateModelConfig`) or the
 * platform usage caps (`handleUpdateUsageLimits`). These are platform-scoped
 * privileged mutations with no Department/Document-Type scope, so they carry
 * neither. `newValue`/`previousValue` hold only structured policy fields —
 * never secrets.
 */
export async function auditPlatformPolicyChange(
  actor: AuthContext,
  detail: {
    change: 'model' | 'usageLimits';
    newValue: Record<string, unknown>;
    previousValue?: Record<string, unknown>;
  },
  db: QueryExecutor,
): Promise<void> {
  await recordActivityEvent(
    {
      actorUserId: actor.userId,
      verb: 'platform_policy.updated',
      objectType: 'PlatformUsagePolicy',
      objectRef: `platform:${detail.change}`,
      context: {
        role: actor.roles[0],
        change: detail.change,
        newValue: detail.newValue,
        ...(detail.previousValue ? { previousValue: detail.previousValue } : {}),
      },
    },
    db,
  );
}

/**
 * Record an audit event for an OPEN/LOCKED access-state change on a Document
 * Type (`handleSetDocumentTypeAccessState`) or a Department
 * (`handleSetDepartmentAccessState`) (Issue #187). Access state gates whether
 * Students may submit work, so a flip is a security-relevant configuration
 * change that must be attributable to the acting TechnicalAdmin.
 */
export async function auditAccessStateChange(
  actor: AuthContext,
  detail: {
    scope: 'documentType' | 'department';
    documentTypeId?: string;
    departmentId: string;
    accessState: 'OPEN' | 'LOCKED';
  },
  db: QueryExecutor,
): Promise<void> {
  await recordActivityEvent(
    {
      actorUserId: actor.userId,
      verb: 'access_state.updated',
      objectType: detail.scope === 'documentType' ? 'DocumentType' : 'Department',
      objectRef:
        detail.scope === 'documentType' ? detail.documentTypeId! : detail.departmentId,
      documentTypeId: detail.documentTypeId,
      departmentId: detail.departmentId,
      context: {
        role: actor.roles[0],
        scope: detail.scope,
        accessState: detail.accessState,
      },
    },
    db,
  );
}

/**
 * Record an audit event for a role or access-grant change. Requirement 45.2:
 * "retain audit records of administrative and security events (e.g. role
 * changes, override grants)."
 */
export async function auditRoleOrGrantChange(
  actor: AuthContext,
  detail: {
    action: 'role.assigned' | 'role.revoked' | 'grant.created' | 'grant.revoked' | 'grant.approved';
    targetUserId: string;
    targetRole?: string;
    documentTypeId?: string;
    departmentId?: string;
  },
  db: QueryExecutor,
): Promise<void> {
  await recordActivityEvent(
    {
      actorUserId: actor.userId,
      verb: detail.action,
      objectType: detail.action.startsWith('role') ? 'RoleAssignment' : 'AccessGrant',
      objectRef: detail.targetUserId,
      documentTypeId: detail.documentTypeId,
      departmentId: detail.departmentId,
      context: {
        role: actor.roles[0],
        action: detail.action,
        targetUserId: detail.targetUserId, // recorded for audit trail (pseudonymized by recordActivityEvent for the actor)
        ...(detail.targetRole ? { targetRole: detail.targetRole } : {}),
      },
    },
    db,
  );
}

export async function auditDepartmentVisibilityChange(
  actor: AuthContext,
  detail: {
    action:
      | 'department.visibility.updated'
      | 'department_visibility_grant.created'
      | 'department_visibility_grant.revoked';
    departmentId: string;
    grantId?: string;
    targetUserId?: string;
    previousState?: 'VISIBLE' | 'PERMITTED_ONLY';
    newState?: 'VISIBLE' | 'PERMITTED_ONLY';
  },
  db: QueryExecutor,
): Promise<void> {
  const isGrant = detail.action.startsWith('department_visibility_grant.');
  await recordActivityEvent(
    {
      actorUserId: actor.userId,
      verb: detail.action,
      objectType: isGrant ? 'DepartmentVisibilityGrant' : 'Department',
      objectRef: detail.grantId ?? detail.departmentId,
      departmentId: detail.departmentId,
      context: {
        role: actor.roles[0],
        ...(detail.targetUserId ? { targetUserId: detail.targetUserId } : {}),
        ...(detail.previousState ? { previousState: detail.previousState } : {}),
        ...(detail.newState ? { newState: detail.newState } : {}),
      },
    },
    db,
  );
}

/**
 * Record an audit event for a usage-limit override grant. Requirement 54.6:
 * "log the granting actor's identity and role, the affected Student, the
 * Document Type, the reason, and a timestamp."
 */
export async function auditOverrideGrant(
  actor: AuthContext,
  detail: {
    userId: string;
    documentTypeId: string;
    departmentId?: string;
    reason: string;
    bounds: { additionalActions: number };
  },
  db: QueryExecutor,
): Promise<void> {
  await recordActivityEvent(
    {
      actorUserId: actor.userId,
      verb: 'override.granted',
      objectType: 'Override',
      objectRef: `${detail.userId}:${detail.documentTypeId}`,
      documentTypeId: detail.documentTypeId,
      departmentId: detail.departmentId,
      context: {
        role: actor.roles[0],
        affectedUserId: detail.userId,
        reason: detail.reason,
        bounds: detail.bounds,
      },
    },
    db,
  );
}

/**
 * Record an audit event for a no-ghostwriting guardrail outcome.
 * Requirement 11.5: "record, for each generated Feedback Item, evidence
 * (category, anchor, question text, and absence of replacement prose)
 * sufficient to verify compliance."
 * Requirement 38.4: "log detected prompt-injection mitigations."
 */
export async function auditGuardrailOutcome(
  detail: {
    documentId: string;
    documentTypeId?: string;
    outcome: 'passed' | 'violation_rejected' | 'violation_transformed' | 'injection_mitigated';
    description?: string;
  },
  db: QueryExecutor,
): Promise<void> {
  // Guardrail outcomes are system-level actions, not attributed to a Student
  // (the Student didn't "do" the guardrail check — the engine did). We use a
  // synthetic system actor id.
  await recordActivityEvent(
    {
      actorUserId: '__system__',
      verb: `guardrail.${detail.outcome}`,
      objectType: 'FeedbackGeneration',
      objectRef: detail.documentId,
      documentTypeId: detail.documentTypeId,
      context: {
        outcome: detail.outcome,
        ...(detail.description ? { description: detail.description } : {}),
      },
    },
    db,
  );
}
