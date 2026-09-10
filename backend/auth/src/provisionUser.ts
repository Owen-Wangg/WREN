/**
 * First-login / signup provisioning (REQ-SEC-AUTHDECOUPLE-01).
 *
 * Cognito proves identity only. This module creates the application-side
 * `app_user` + default `Student` role when a verified IdP subject has no row
 * yet. Roles remain owned by Postgres — never copied from IdP claims.
 *
 * Exception: an explicitly configured exact Cognito subject may receive
 * TechnicalAdmin only while a genuinely new app_user is provisioned and the
 * verified token also contains SystemAdmin. Missing configuration is default-off;
 * existing or email-relinked users never escalate from group membership.
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
  let createdNewUser = false;

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
    createdNewUser = userId !== undefined;
  }

  if (!userId) {
    throw new Error(
      `Failed to provision app_user for idp_subject=${input.idpSubject}`,
    );
  }

  const bootstrapAdmin =
    createdNewUser &&
    input.technicalAdminBootstrapSubject === input.idpSubject &&
    input.groups?.includes('SystemAdmin') === true;
  if (bootstrapAdmin) {
    await db.query(ENSURE_TECHNICAL_ADMIN_ROLE_SQL, [userId]);
  } else {
    await db.query(ENSURE_STUDENT_ROLE_SQL, [userId]);
  }
  return userId;
}
