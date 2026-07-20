/**
 * sync-cognito-admins — one-shot admin role sync
 *
 * Queries Cognito for all members of the "SystemAdmin" group, matches them
 * to app_user rows by idp_subject (Cognito sub), and upserts TechnicalAdmin
 * into role_assignment for any who don't already have it.
 *
 * Run via Lambda invoke:
 *   aws lambda invoke \
 *     --function-name wren-dev-admin \
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
import { getDataAccess } from '@wren/db-node';

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID!;
const REGION = process.env.AWS_REGION ?? 'ca-central-1';
const GROUP_NAME = 'SystemAdmin';

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
    const userRows = await db.query<{ id: string; email: string }>(
      'SELECT id, email FROM app_user WHERE idp_subject = $1',
      [sub],
    );
    if (userRows.length === 0) {
      console.warn(`  sub=${sub} — no app_user row (user has never logged in)`);
      notFound.push(sub);
      continue;
    }
    const { id: userId, email } = userRows[0]!;

    // 3. Check existing role
    const existing = await db.query<{ role: string }>(
      "SELECT role FROM role_assignment WHERE user_id = $1 AND role = 'TechnicalAdmin'",
      [userId],
    );
    if (existing.length > 0) {
      console.log(`  ${email} — already TechnicalAdmin, skipping`);
      alreadyAdmin.push(email);
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
    console.log(`  ${email} — granted TechnicalAdmin`);
    upserted.push(email);
  }

  return { checked: subs.length, upserted, alreadyAdmin, notFound };
}

// Allow the admin Lambda handler to delegate here when it sees _script
export async function handler(event: Record<string, unknown>) {
  if (event['_script'] !== 'sync-cognito-admins') {
    return { statusCode: 400, body: 'wrong script name' };
  }
  const result = await syncCognitoAdmins();
  console.log('Result:', JSON.stringify(result, null, 2));
  return { statusCode: 200, body: JSON.stringify(result) };
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
