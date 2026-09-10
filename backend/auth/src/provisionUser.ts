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
 */
import type { QueryExecutor } from './identityMapping';

export interface ProvisionUserInput {
  readonly idpSubject: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Cognito group names from the verified JWT — used only at provisioning time. */
  readonly groups?: readonly string[];
  /** Exact subject allowlist. Missing or non-matching values disable admin bootstrap. */
  readonly technicalAdminBootstrapSubject?: string;
}

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

const SELECT_USER_ID_BY_EMAIL_SQL =
  'SELECT id FROM app_user WHERE lower(email) = $1';

const RELINK_IDP_SUBJECT_SQL = `
  UPDATE app_user
  SET idp_subject = $1,
      first_name = CASE
        WHEN first_name IS NULL OR first_name = '' OR first_name = 'User'
        THEN $3 ELSE first_name END,
      last_name = CASE
        WHEN last_name IS NULL OR last_name = '' OR last_name = 'Account'
        THEN $4 ELSE last_name END
  WHERE id = $2 AND idp_subject <> $1
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
 * operator-controlled signal set only by the guided deploy and stripped again
 * immediately after verification. Unlike {@link ensureAppUser}, this path does
 * NOT consult `cognito:groups`: the REST authorizer verifies access tokens,
 * which do not reliably carry `cognito:groups`, so a group claim cannot be
 * relied on here. The armed subject is sufficient and is never derived from the
 * token. Idempotent: the insert is a no-op if the role already exists, and this
 * is only invoked when the caller has confirmed the role is absent.
 */
export async function ensureTechnicalAdminForArmedSubject(
  db: QueryExecutor,
  userId: string,
): Promise<void> {
  await db.query(ENSURE_TECHNICAL_ADMIN_ROLE_SQL, [userId]);
}

/**
 * Ensure an `app_user` exists for the verified IdP subject and has at least the
 * default Student role. Idempotent under concurrent first-login requests.
 */
export async function ensureAppUser(
  db: QueryExecutor,
  input: ProvisionUserInput,
): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim() || 'User';
  const lastName = input.lastName.trim() || 'Account';

  let rows = await db.query<{ id: string }>(SELECT_USER_ID_SQL, [
    input.idpSubject,
  ]);
  let userId = rows[0]?.id;

  // Seeded / recycled users often already have this email with a different
  // Cognito `sub`. Relink instead of failing the unique email constraint.
  if (!userId) {
    const byEmail = await db.query<{ id: string }>(SELECT_USER_ID_BY_EMAIL_SQL, [
      email,
    ]);
    if (byEmail[0]) {
      await db.query(RELINK_IDP_SUBJECT_SQL, [input.idpSubject, byEmail[0].id, firstName, lastName]);
      userId = byEmail[0].id;
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
  // TECHNICAL_ADMIN_BOOTSTRAP_SUBJECT, set only by the guided deploy and
  // stripped immediately after verification. Do not treat this group check as
  // an independent constraint.
  const bootstrapAdmin =
    input.technicalAdminBootstrapSubject === input.idpSubject &&
    input.groups?.includes('SystemAdmin') === true;
  await db.query(ENSURE_STUDENT_ROLE_SQL, [userId]);
  if (bootstrapAdmin) {
    await db.query(ENSURE_TECHNICAL_ADMIN_ROLE_SQL, [userId]);
  }
  return userId;
}
