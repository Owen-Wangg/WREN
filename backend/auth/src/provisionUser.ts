/**
 * First-login / signup provisioning (REQ-SEC-AUTHDECOUPLE-01).
 *
 * Cognito proves identity only. This module creates the application-side
 * `app_user` + default `Student` role when a verified IdP subject has no row
 * yet. Roles remain owned by Postgres — never copied from IdP claims.
 *
 * Exception: members of the Cognito "SystemAdmin" group are provisioned as
 * TechnicalAdmin on their first login. This is a one-time bootstrap path only —
 * after provisioning the DB is the sole source of truth and groups are ignored.
 */
import type { QueryExecutor } from './identityMapping';

export interface ProvisionUserInput {
  readonly idpSubject: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  /** Cognito group names from the verified JWT — used only at provisioning time. */
  readonly groups?: readonly string[];
}

const UPSERT_USER_SQL = `
INSERT INTO app_user (email, first_name, last_name, idp_subject)
VALUES ($1, $2, $3, $4)
ON CONFLICT (idp_subject) DO NOTHING
`;

const SELECT_USER_ID_SQL =
  'SELECT id FROM app_user WHERE idp_subject = $1';

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

  await db.query(UPSERT_USER_SQL, [
    email,
    firstName,
    lastName,
    input.idpSubject,
  ]);

  const rows = await db.query<{ id: string }>(SELECT_USER_ID_SQL, [
    input.idpSubject,
  ]);
  const userId = rows[0]?.id;
  if (!userId) {
    throw new Error(
      `Failed to provision app_user for idp_subject=${input.idpSubject}`,
    );
  }

  if (input.groups?.includes('SystemAdmin')) {
    await db.query(ENSURE_TECHNICAL_ADMIN_ROLE_SQL, [userId]);
  } else {
    await db.query(ENSURE_STUDENT_ROLE_SQL, [userId]);
  }
  return userId;
}
