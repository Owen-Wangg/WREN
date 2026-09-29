/**
 * sync-cognito-admins — one-shot admin role sync
 *
 * Queries Cognito for all members of the "SystemAdmin" group, matches them
 * to app_user rows by idp_subject (Cognito sub), and upserts TechnicalAdmin
 * into role_assignment for any who don't already have it.
 *
 * This grants the most privileged application role, so it is NOT reachable
 * from the API-facing Admin Lambda. It runs only in its own dedicated Lambda
 * (`${StackPrefix}-sync-cognito-admins`, entry `../lambda-sync-cognito-admins.ts`)
 * which has no API Gateway permission — invoking it requires a
 * `lambda:InvokeFunction` grant on that function. The caller's identity is
 * recorded by the `${prefix}-privileged-invokes` CloudTrail trail in the
 * CloudWatch log group `/aws/cloudtrail/${prefix}-privileged-invokes`.
 *
 * Run via Lambda invoke (payload must be exactly this object):
 *   aws lambda invoke \
 *     --function-name wren-dev-sync-cognito-admins \
 *     --region ca-central-1 \
 *     --cli-binary-format raw-in-base64-out \
 *     --payload '{"_script":"sync-cognito-admins"}' \
 *     /dev/stdout
 *
 * Or directly with ts-node from inside the VPC (e.g. a bastion / Cloud9):
 *   npx ts-node backend/admin/src/scripts/sync-cognito-admins.ts
 */
import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { getDataAccess, recordActivityEventRow } from '@wren/db-node';

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const REGION = process.env.AWS_REGION ?? 'ca-central-1';
const GROUP_NAME = 'SystemAdmin';

/**
 * Synthetic actor id for role grants performed by this out-of-band script
 * rather than an interactive administrator (Issue #187). It has no real
 * `AuthContext` — a script is not a logged-in user — so we attribute the audit
 * event to a stable synthetic id, mirroring the `__system__` actor the audit
 * service already uses for engine-driven guardrail events. The shared writer
 * pseudonymizes it like any other actor.
 */
const SCRIPT_ACTOR_ID = '__script:sync-cognito-admins__';

export async function syncCognitoAdmins(): Promise<{
  checked: number;
  upserted: string[];
  alreadyAdmin: string[];
  notFound: string[];
}> {
  const cognito = new CognitoIdentityProviderClient({ region: REGION });
  const db = await getDataAccess();

  // 1. Collect all Cognito subs from the SystemAdmin group
  const subs: string[] = [];
  let paginationToken: string | undefined;
  do {
    const cmd = new ListUsersInGroupCommand({
      UserPoolId: USER_POOL_ID,
      GroupName: GROUP_NAME,
      NextToken: paginationToken,
    });
    const resp = await cognito.send(cmd);
    for (const user of resp.Users ?? []) {
      const sub = user.Attributes?.find((a) => a.Name === 'sub')?.Value;
      if (sub) subs.push(sub);
    }
    paginationToken = resp.NextToken;
  } while (paginationToken);

  console.log(`Found ${subs.length} user(s) in Cognito group "${GROUP_NAME}"`);

  const upserted: string[] = [];
  const alreadyAdmin: string[] = [];
  const notFound: string[] = [];

  for (const sub of subs) {
    // 2. Find the app_user row by idp_subject
    const userRows = await db.query<{ id: string }>(
      'SELECT id FROM app_user WHERE idp_subject = $1',
      [sub],
    );
    if (userRows.length === 0) {
      console.warn(`  sub=${sub} — no app_user row (user has never logged in)`);
      notFound.push(sub);
      continue;
    }
    const { id: userId } = userRows[0]!;

    // 3. Check existing role
    const existing = await db.query<{ role: string }>(
      "SELECT role FROM role_assignment WHERE user_id = $1 AND role = 'TechnicalAdmin'",
      [userId],
    );
    if (existing.length > 0) {
      console.log(`  userId=${userId} — already TechnicalAdmin, skipping`);
      alreadyAdmin.push(userId);
      continue;
    }

    // 4. Insert TechnicalAdmin if not already present
    await db.query(
      `INSERT INTO role_assignment (user_id, role, scope)
       SELECT $1::uuid, 'TechnicalAdmin', NULL
       WHERE NOT EXISTS (
         SELECT 1 FROM role_assignment WHERE user_id = $1::uuid AND role = 'TechnicalAdmin'
       )`,
      [userId],
    );
    console.log(`  userId=${userId} — granted TechnicalAdmin`);

    // Audit the privileged role grant (Issue #187 / Requirement 45.2): granting
    // TechnicalAdmin is a security event and must leave an audit record, even
    // when performed by this script rather than an interactive admin. Shape
    // mirrors auditRoleOrGrantChange's 'role.assigned' event. Best-effort and
    // non-fatal: the grant already succeeded, so an audit-write failure must
    // not abort the sync — record it visibly instead.
    try {
      await recordActivityEventRow(
        {
          actorUserId: SCRIPT_ACTOR_ID,
          verb: 'role.assigned',
          objectType: 'RoleAssignment',
          objectRef: userId,
          context: {
            action: 'role.assigned',
            targetUserId: userId,
            targetRole: 'TechnicalAdmin',
            source: 'sync-cognito-admins',
          },
        },
        db,
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: 'audit_write_failed',
          action: 'role.assigned',
          targetUserId: userId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    upserted.push(userId);
  }

  return { checked: subs.length, upserted, alreadyAdmin, notFound };
}

// Direct invocation (ts-node / npx tsx)
if (
  process.argv[1] &&
  process.argv[1].includes('sync-cognito-admins')
) {
  syncCognitoAdmins()
    .then((r) => {
      console.log('\nDone:', JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
