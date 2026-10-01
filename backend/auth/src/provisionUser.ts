/**
 * First-login / signup provisioning (REQ-SEC-AUTHDECOUPLE-01).
 *
 * Cognito proves identity only. This module creates the application-side
 * `app_user` + default `Student` role when a verified IdP subject has no row
 * yet. Roles remain owned by Postgres — never copied from IdP claims.
 *
 * Exception: an explicitly configured exact Cognito subject may receive
 * TechnicalAdmin when the verified token also contains SystemAdmin. This applies
 * whether or not the app_user already exists, so a first-admin candidate who
 * signed in once before the bootstrap gate was armed can still be elevated (they
 * keep Student and also gain TechnicalAdmin). Missing configuration is
 * default-off; a non-matching subject or a token without SystemAdmin never
 * escalates from group membership.
 *
 * Email reconciliation (security finding f-4531f8e7). The durable identity key
 * is the IdP `sub`. Email is only consulted to let a *recreated* Cognito user
 * (same email, new `sub`) reclaim their previous, unprivileged app_user row.
 * That one-time claim is allowed only when ALL of the following hold:
 *   1. Cognito reports the email as verified (an unverified email never
 *      provisions or selects an identity);
 *   2. the matched row is not bound to a live identity — its `idp_subject` is
 *      a `seed:` placeholder, or no longer exists in the user pool;
 *   3. the matched row holds nothing beyond the default Student role (no
 *      DepartmentAdmin / TechnicalAdmin, no scoped role, no active access or
 *      department-visibility grant).
 * Anything else fails closed with {@link IdentityProvisioningRefusedError}; an
 * operator must reassign the identity explicitly. Every successful relink
 * writes an `identity.relinked` activity_event in the same transaction.
 */
import type { RecordActivityEventInput } from '@wren/db-node';

import type { CognitoSubjectLivenessCheck } from './cognitoProfile';
import type { QueryExecutor } from './identityMapping';

export interface ProvisionUserInput {
  readonly idpSubject: string;
  readonly email: string;
  /** Cognito `email_verified`. Provisioning is refused unless this is true. */
  readonly emailVerified: boolean;
  readonly firstName: string;
  readonly lastName: string;
  /** Cognito group names from the verified JWT — used only at provisioning time. */
  readonly groups?: readonly string[];
  /** Exact subject allowlist. Missing or non-matching values disable admin bootstrap. */
  readonly technicalAdminBootstrapSubject?: string;
}

/**
 * Data access for provisioning. `transaction` is provided by the production
 * `@wren/db-node` DataAccess so the relink and its audit record commit
 * atomically. It is optional only because ordinary provisioning does not need
 * it; an email relink fails closed when it is missing.
 */
export interface ProvisioningDb extends QueryExecutor {
  transaction?<T>(fn: (tx: QueryExecutor) => Promise<T>): Promise<T>;
}

/** Collaborators for the email-reconciliation path. */
export interface ProvisionUserDeps {
  /** Whether a previously linked subject still exists in the user pool. */
  readonly isSubjectLive: CognitoSubjectLivenessCheck;
  /** Durable audit writer (the shared INSERT-only `@wren/db-node` `appendActivityEventRow`). */
  readonly recordActivityEvent: (
    input: RecordActivityEventInput,
    db: QueryExecutor,
  ) => Promise<unknown>;
  /** Structured log sink; defaults to `console.warn` of a JSON line. */
  readonly log?: (line: Record<string, unknown>) => void;
}

export type ProvisioningRefusalReason =
  /** Cognito has not verified the email, so it cannot provision or match an identity. */
  | 'email_unverified'
  /** The email matches a row still bound to a live Cognito subject. */
  | 'identity_still_bound'
  /** The email matches a row holding more than the default Student role. */
  | 'privileged_identity'
  /** Ambiguous match, or the row changed between check and relink. */
  | 'relink_conflict';

/**
 * Provisioning was refused on purpose. The authorizer maps this to a Deny
 * (not a 5xx) and logs the reason; no row was modified.
 */
export class IdentityProvisioningRefusedError extends Error {
  public override readonly name = 'IdentityProvisioningRefusedError';

  public constructor(
    public readonly reason: ProvisioningRefusalReason,
    public readonly matchedUserId?: string,
  ) {
    super(`First-login provisioning refused: ${reason}`);
  }
}

/** `idp_subject` prefix marking a row that was seeded and never claimed. */
export const SEED_SUBJECT_PREFIX = 'seed:';

/** Synthetic audit actor for relinks performed by first-login provisioning. */
export const PROVISIONING_AUDIT_ACTOR = '__system:first-login-provisioning__';

const UPSERT_USER_SQL = `
INSERT INTO app_user (email, first_name, last_name, idp_subject)
VALUES ($1, $2, $3, $4)
ON CONFLICT (idp_subject) DO UPDATE
  SET first_name = CASE
        WHEN app_user.first_name IS NULL OR app_user.first_name = '' OR app_user.first_name = 'User'
        THEN EXCLUDED.first_name ELSE app_user.first_name END,
      last_name = CASE
        WHEN app_user.last_name IS NULL OR app_user.last_name = '' OR app_user.last_name = 'Account'
        THEN EXCLUDED.last_name ELSE app_user.last_name END
`;

const SELECT_USER_ID_SQL =
  'SELECT id FROM app_user WHERE idp_subject = $1';

const SELECT_USER_BY_EMAIL_SQL =
  'SELECT id, idp_subject FROM app_user WHERE lower(email) = $1';

/**
 * Anything beyond a plain, unscoped Student role makes a row ineligible for an
 * automatic relink. Shared by the pre-check and the guarded UPDATE so the
 * condition is re-evaluated atomically at write time.
 */
const PRIVILEGE_PREDICATES = {
  elevatedRole: `EXISTS (SELECT 1 FROM role_assignment
      WHERE user_id = $1::uuid AND (role <> 'Student' OR scope IS NOT NULL))`,
  accessGrant: `EXISTS (SELECT 1 FROM access_grant
      WHERE user_id = $1::uuid AND revoked_at IS NULL)`,
  visibilityGrant: `EXISTS (SELECT 1 FROM department_visibility_grant
      WHERE user_id = $1::uuid AND revoked_at IS NULL)`,
} as const;

const SELECT_RELINK_PRIVILEGES_SQL = `
SELECT
  ${PRIVILEGE_PREDICATES.elevatedRole} AS has_elevated_role,
  ${PRIVILEGE_PREDICATES.accessGrant} AS has_access_grant,
  ${PRIVILEGE_PREDICATES.visibilityGrant} AS has_visibility_grant,
  COALESCE(
    (SELECT array_agg(DISTINCT role ORDER BY role) FROM role_assignment WHERE user_id = $1::uuid),
    '{}'
  ) AS roles
`;

/**
 * Compare-and-set relink: only succeeds if the row still carries the subject
 * we inspected and still holds no privilege. Zero rows returned => conflict.
 */
const RELINK_IDP_SUBJECT_SQL = `
UPDATE app_user
SET idp_subject = $2,
    first_name = CASE
      WHEN first_name IS NULL OR first_name = '' OR first_name = 'User'
      THEN $4 ELSE first_name END,
    last_name = CASE
      WHEN last_name IS NULL OR last_name = '' OR last_name = 'Account'
      THEN $5 ELSE last_name END
WHERE id = $1::uuid
  AND idp_subject = $3
  AND NOT ${PRIVILEGE_PREDICATES.elevatedRole}
  AND NOT ${PRIVILEGE_PREDICATES.accessGrant}
  AND NOT ${PRIVILEGE_PREDICATES.visibilityGrant}
RETURNING id
`;

const ENSURE_STUDENT_ROLE_SQL = `
INSERT INTO role_assignment (user_id, role, scope)
SELECT $1::uuid, 'Student', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM role_assignment WHERE user_id = $1::uuid AND role = 'Student'
)
`;

const ENSURE_TECHNICAL_ADMIN_ROLE_SQL = `
INSERT INTO role_assignment (user_id, role, scope)
SELECT $1::uuid, 'TechnicalAdmin', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM role_assignment WHERE user_id = $1::uuid AND role = 'TechnicalAdmin'
)
`;

interface RelinkPrivilegeRow {
  readonly has_elevated_role: boolean;
  readonly has_access_grant: boolean;
  readonly has_visibility_grant: boolean;
  readonly roles: readonly string[] | null;
}

function defaultLog(line: Record<string, unknown>): void {
  console.warn(JSON.stringify(line));
}

/**
 * Grant TechnicalAdmin to an ALREADY-PROVISIONED user during first-admin
 * bootstrap (REQ-SEC-ROLE-01).
 *
 * The authorizer only calls {@link ensureAppUser} when a subject has no
 * app_user row yet, so its group-seeded elevation is unreachable for a
 * candidate who already signed in (which the app forces immediately after
 * signup by auto-loading the dashboard). This function closes that gap: it is
 * called on any authenticated request while the deploy has armed the exact
 * candidate subject, and adds the TechnicalAdmin role in place.
 *
 * Safety: the SOLE gate is the operator-armed exact-subject match, which the
 * caller MUST verify before calling (`armedSubject === idpSubject`). That is an
 * operator-controlled signal set by the guided deploy; elevation happens on
 * the candidate's authenticated application request. Unlike {@link ensureAppUser},
 * this path does NOT consult `cognito:groups`: the REST authorizer verifies
 * access tokens, which do not reliably carry `cognito:groups`, so a group claim
 * cannot be relied on here. The armed subject is sufficient and is never derived
 * from the token. Idempotent: the insert is a no-op if the role already exists,
 * and this is only invoked when the caller has confirmed the role is absent.
 */
export async function ensureTechnicalAdminForArmedSubject(
  db: QueryExecutor,
  userId: string,
): Promise<void> {
  await db.query(ENSURE_TECHNICAL_ADMIN_ROLE_SQL, [userId]);
}

/**
 * Reclaim an existing row for a new subject, or refuse. Returns the row id on
 * success; throws {@link IdentityProvisioningRefusedError} otherwise. Never
 * modifies a row unless every guard passes.
 */
async function reclaimByEmail(
  db: ProvisioningDb,
  input: ProvisionUserInput,
  deps: ProvisionUserDeps,
  candidate: { readonly id: string; readonly idp_subject: string },
  firstName: string,
  lastName: string,
): Promise<string> {
  const log = deps.log ?? defaultLog;
  // The relink and its audit record must commit together; without a
  // transaction a failed audit write would leave an unaudited rebind. Fail
  // closed before touching anything.
  if (typeof db.transaction !== 'function') {
    throw new Error('Identity relink requires a transactional data-access handle');
  }
  const refuse = (reason: ProvisioningRefusalReason): never => {
    log({
      event: 'identity_relink_refused',
      reason,
      userId: candidate.id,
      previousSubject: candidate.idp_subject,
      attemptedSubject: input.idpSubject,
    });
    throw new IdentityProvisioningRefusedError(reason, candidate.id);
  };

  // (2) Only an unclaimed row may be reclaimed. A seed placeholder is unclaimed
  // by definition; otherwise the previous subject must be gone from the pool.
  // isSubjectLive errors propagate (fail closed: no relink on an outage).
  const isSeedRow = candidate.idp_subject.startsWith(SEED_SUBJECT_PREFIX);
  if (!isSeedRow && (await deps.isSubjectLive(candidate.idp_subject))) {
    refuse('identity_still_bound');
  }

  // (3) Never transfer privilege as a side effect of an email match.
  const [privileges] = await db.query<RelinkPrivilegeRow>(
    SELECT_RELINK_PRIVILEGES_SQL,
    [candidate.id],
  );
  if (
    !privileges ||
    privileges.has_elevated_role ||
    privileges.has_access_grant ||
    privileges.has_visibility_grant
  ) {
    refuse('privileged_identity');
  }
  const rolesAtRelink = [...(privileges?.roles ?? [])];

  const relinkAndAudit = async (tx: QueryExecutor): Promise<boolean> => {
    const updated = await tx.query<{ id: string }>(RELINK_IDP_SUBJECT_SQL, [
      candidate.id,
      input.idpSubject,
      candidate.idp_subject,
      firstName,
      lastName,
    ]);
    if (updated.length === 0) return false;
    await deps.recordActivityEvent(
      {
        actorUserId: PROVISIONING_AUDIT_ACTOR,
        verb: 'identity.relinked',
        objectType: 'AppUser',
        objectRef: candidate.id,
        // No email here: the activity log is pseudonymized, and the row's
        // email is not changed by a relink, so `objectRef` already resolves it.
        context: {
          userId: candidate.id,
          previousIdpSubject: candidate.idp_subject,
          newIdpSubject: input.idpSubject,
          rolesAtRelink,
          claimKind: isSeedRow ? 'seed' : 'stale_subject',
        },
      },
      tx,
    );
    return true;
  };

  const relinked = await db.transaction(relinkAndAudit);
  if (!relinked) {
    // A concurrent first-login request for this SAME subject may have won the
    // compare-and-set (and written the audit record). That is not a conflict.
    const [current] = await db.query<{ id: string }>(SELECT_USER_ID_SQL, [input.idpSubject]);
    if (current?.id === candidate.id) return candidate.id;
    // Otherwise the row changed (claimed by someone else, re-subjected, or
    // gained a privilege) between inspection and write.
    refuse('relink_conflict');
  }

  log({
    event: 'identity_relinked',
    userId: candidate.id,
    previousSubject: candidate.idp_subject,
    newSubject: input.idpSubject,
    rolesAtRelink,
  });
  return candidate.id;
}

/**
 * Ensure an `app_user` exists for the verified IdP subject and has at least the
 * default Student role. Idempotent under concurrent first-login requests.
 *
 * @throws IdentityProvisioningRefusedError when the email is unverified or an
 *   email match may not be reclaimed (see module docs). Nothing is written.
 */
export async function ensureAppUser(
  db: ProvisioningDb,
  input: ProvisionUserInput,
  deps: ProvisionUserDeps,
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim() || 'User';
  const lastName = input.lastName.trim() || 'Account';

  let rows = await db.query<{ id: string }>(SELECT_USER_ID_SQL, [
    input.idpSubject,
  ]);
  let userId = rows[0]?.id;

  if (!userId) {
    // (1) An unverified email must never provision or select an identity.
    // Self-signup confirms by emailed code, so a genuine new user is verified.
    if (input.emailVerified !== true) {
      (deps.log ?? defaultLog)({
        event: 'identity_relink_refused',
        reason: 'email_unverified',
        attemptedSubject: input.idpSubject,
      });
      throw new IdentityProvisioningRefusedError('email_unverified');
    }

    // A recreated Cognito user (same email, new `sub`) may reclaim their old,
    // unprivileged row. Everything else fails closed in reclaimByEmail.
    const byEmail = await db.query<{ id: string; idp_subject: string }>(
      SELECT_USER_BY_EMAIL_SQL,
      [email],
    );
    if (byEmail.length > 1) {
      // Case-variant duplicates: refuse rather than guess which identity to hand over.
      (deps.log ?? defaultLog)({
        event: 'identity_relink_refused',
        reason: 'relink_conflict',
        attemptedSubject: input.idpSubject,
        matchCount: byEmail.length,
      });
      throw new IdentityProvisioningRefusedError('relink_conflict');
    }
    if (byEmail[0]) {
      userId = await reclaimByEmail(db, input, deps, byEmail[0], firstName, lastName);
    }
  }

  if (!userId) {
    await db.query(UPSERT_USER_SQL, [
      email,
      firstName,
      lastName,
      input.idpSubject,
    ]);
    rows = await db.query<{ id: string }>(SELECT_USER_ID_SQL, [
      input.idpSubject,
    ]);
    userId = rows[0]?.id;
  }

  if (!userId) {
    throw new Error(
      `Failed to provision app_user for idp_subject=${input.idpSubject}`,
    );
  }

  // Bootstrap gate. This intentionally does NOT require a brand-new app_user:
  // the guided deploy adds the candidate to SystemAdmin and arms their exact
  // Cognito sub, but the candidate may have already signed in once (creating a
  // Student row) before the gate was armed. Requiring `createdNewUser` would
  // permanently lock those deployments out of first-admin setup. Safety is
  // preserved by the two operator-controlled conditions that remain: the exact
  // armed subject must match, and the verified token must carry SystemAdmin.
  // A normal user can satisfy neither. The candidate keeps Student and also
  // gains TechnicalAdmin.
  // NOTE: the `groups.includes('SystemAdmin')` half of this gate is NOT a hard
  // second factor. It only constrains this first-login provisioning path. The
  // authorizer additionally re-evaluates elevation for an already-provisioned
  // user via ensureTechnicalAdminForArmedSubject, gated ONLY on the armed
  // exact-subject match (no group check, because access tokens do not reliably
  // carry cognito:groups). So an armed subject that fails this group check on
  // first login is elevated on their very next request regardless. The real
  // security boundary for both paths is the operator-armed
  // TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT, set by the guided deploy. Elevation
  // happens on the candidate's authenticated application request. Do not treat
  // this group check as an independent constraint.
  const bootstrapAdmin =
    input.technicalAdminBootstrapSubject === input.idpSubject &&
    input.groups?.includes('SystemAdmin') === true;
  await db.query(ENSURE_STUDENT_ROLE_SQL, [userId]);
  if (bootstrapAdmin) {
    await db.query(ENSURE_TECHNICAL_ADMIN_ROLE_SQL, [userId]);
  }
  return userId;
}
