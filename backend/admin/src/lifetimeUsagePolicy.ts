/**
 * Platform lifetime usage policy — read + enforcement helpers.
 *
 * Configured by TechnicalAdmin via {@link updatePlatformUsagePolicy}.
 * Document / Feedback Lambdas call the assert helpers before mutating.
 */
import {
  platformUsagePolicySchema,
  updatePlatformUsagePolicyInputSchema,
  type AuthContext,
  type PlatformUsagePolicy,
  type UpdatePlatformUsagePolicyInput,
} from '@wren/types';

import { requireCapability } from './capabilityGuard';
import type { QueryExecutor } from './db';
import { UsageLimitReachedError } from './errors';

interface PolicyRow {
  readonly message_limit: number;
  readonly debrief_generation_limit: number;
  readonly document_upload_limit: number;
  readonly drafts_per_document_limit: number;
}

const DEFAULT_POLICY: PlatformUsagePolicy = {
  messageLimit: 100,
  debriefGenerationLimit: 15,
  documentUploadLimit: 30,
  draftsPerDocumentLimit: 15,
};

function toPolicy(row: PolicyRow | undefined): PlatformUsagePolicy {
  if (!row) return DEFAULT_POLICY;
  return platformUsagePolicySchema.parse({
    messageLimit: row.message_limit,
    debriefGenerationLimit: row.debrief_generation_limit,
    documentUploadLimit: row.document_upload_limit,
    draftsPerDocumentLimit: row.drafts_per_document_limit,
  });
}

/** Read the single-row platform lifetime usage policy (no auth). */
export async function getPlatformUsagePolicy(
  db: QueryExecutor,
): Promise<PlatformUsagePolicy> {
  const rows = await db.query<PolicyRow>(
    `SELECT message_limit, debrief_generation_limit, document_upload_limit,
            drafts_per_document_limit
     FROM platform_usage_policy WHERE id = 1`,
  );
  return toPolicy(rows[0]);
}

/** TechnicalAdmin-only update of the platform lifetime usage policy. */
export async function updatePlatformUsagePolicy(
  actor: AuthContext,
  input: UpdatePlatformUsagePolicyInput,
  db: QueryExecutor,
): Promise<PlatformUsagePolicy> {
  requireCapability(actor, {
    capability: 'usageLimit.configure',
    scope: { kind: 'platform' },
  });

  const parsed = updatePlatformUsagePolicyInputSchema.parse(input);
  const rows = await db.query<PolicyRow>(
    `UPDATE platform_usage_policy SET
       message_limit = $1,
       debrief_generation_limit = $2,
       document_upload_limit = $3,
       drafts_per_document_limit = $4,
       updated_at = now()
     WHERE id = 1
     RETURNING message_limit, debrief_generation_limit, document_upload_limit,
               drafts_per_document_limit`,
    [
      parsed.messageLimit,
      parsed.debriefGenerationLimit,
      parsed.documentUploadLimit,
      parsed.draftsPerDocumentLimit,
    ],
  );

  if (!rows[0]) {
    // Row should always exist after migration 0010; insert if somehow missing.
    await db.query(
      `INSERT INTO platform_usage_policy (
         id, message_limit, debrief_generation_limit,
         document_upload_limit, drafts_per_document_limit
       ) VALUES (1, $1, $2, $3, $4)`,
      [
        parsed.messageLimit,
        parsed.debriefGenerationLimit,
        parsed.documentUploadLimit,
        parsed.draftsPerDocumentLimit,
      ],
    );
    return parsed;
  }

  return toPolicy(rows[0]);
}

/** TechnicalAdmin read of the policy (capability-gated). */
export async function getPlatformUsagePolicyForAdmin(
  actor: AuthContext,
  db: QueryExecutor,
): Promise<PlatformUsagePolicy> {
  requireCapability(actor, {
    capability: 'usageLimit.configure',
    scope: { kind: 'platform' },
  });
  return getPlatformUsagePolicy(db);
}

export async function countDocumentsOwnedByUser(
  userId: string,
  db: QueryExecutor,
): Promise<number> {
  const rows = await db.query<{ document_upload_count: number }>(
    'SELECT document_upload_count FROM user_lifetime_usage WHERE user_id = $1',
    [userId],
  );
  return rows[0]?.document_upload_count ?? 0;
}

export async function countDraftsForDocument(
  documentId: string,
  db: QueryExecutor,
): Promise<number> {
  const rows = await db.query<{ draft_create_count: number }>(
    'SELECT draft_create_count FROM document WHERE id = $1',
    [documentId],
  );
  return rows[0]?.draft_create_count ?? 0;
}

export async function getDebriefGenerationCount(
  documentId: string,
  db: QueryExecutor,
): Promise<number> {
  const rows = await db.query<{ debrief_generation_count: number }>(
    'SELECT debrief_generation_count FROM document WHERE id = $1',
    [documentId],
  );
  return rows[0]?.debrief_generation_count ?? 0;
}

/**
 * Atomically reserve one debrief generation if under the lifetime cap.
 * Returns the new count, or throws {@link UsageLimitReachedError}.
 */
export async function reserveDebriefGeneration(
  documentId: string,
  db: QueryExecutor,
): Promise<number> {
  const policy = await getPlatformUsagePolicy(db);
  const rows = await db.query<{ debrief_generation_count: number }>(
    `UPDATE document
     SET debrief_generation_count = debrief_generation_count + 1
     WHERE id = $1 AND debrief_generation_count < $2
     RETURNING debrief_generation_count`,
    [documentId, policy.debriefGenerationLimit],
  );
  if (!rows[0]) {
    throw new UsageLimitReachedError(
      `AI Debrief generation limit of ${policy.debriefGenerationLimit} reached for this document.`,
    );
  }
  return rows[0].debrief_generation_count;
}

/**
 * Atomically reserve one lifetime document-upload slot for this user.
 * Survives subsequent document deletion.
 */
export async function reserveDocumentUpload(
  userId: string,
  db: QueryExecutor,
): Promise<number> {
  const policy = await getPlatformUsagePolicy(db);
  const rows = await db.query<{ document_upload_count: number }>(
    `INSERT INTO user_lifetime_usage (user_id, document_upload_count)
     SELECT $1, 1
     WHERE $2 > 0
     ON CONFLICT (user_id) DO UPDATE
       SET document_upload_count = user_lifetime_usage.document_upload_count + 1
       WHERE user_lifetime_usage.document_upload_count < $2
     RETURNING document_upload_count`,
    [userId, policy.documentUploadLimit],
  );
  if (!rows[0]) {
    throw new UsageLimitReachedError(
      `Document upload limit of ${policy.documentUploadLimit} reached.`,
    );
  }
  return rows[0].document_upload_count;
}

/**
 * Atomically reserve one draft-create slot for this document.
 * The counter is not decremented when drafts are deleted.
 */
export async function reserveDraftCreate(
  documentId: string,
  db: QueryExecutor,
): Promise<number> {
  const policy = await getPlatformUsagePolicy(db);
  const rows = await db.query<{ draft_create_count: number }>(
    `UPDATE document
     SET draft_create_count = draft_create_count + 1
     WHERE id = $1 AND draft_create_count < $2
     RETURNING draft_create_count`,
    [documentId, policy.draftsPerDocumentLimit],
  );
  if (!rows[0]) {
    throw new UsageLimitReachedError(
      `Draft limit of ${policy.draftsPerDocumentLimit} reached for this document.`,
    );
  }
  return rows[0].draft_create_count;
}

export async function assertDocumentUploadAllowed(
  userId: string,
  db: QueryExecutor,
): Promise<void> {
  const policy = await getPlatformUsagePolicy(db);
  const owned = await countDocumentsOwnedByUser(userId, db);
  if (owned >= policy.documentUploadLimit) {
    throw new UsageLimitReachedError(
      `Document upload limit of ${policy.documentUploadLimit} reached.`,
    );
  }
}

export async function assertDraftCreateAllowed(
  documentId: string,
  db: QueryExecutor,
): Promise<void> {
  const policy = await getPlatformUsagePolicy(db);
  const drafts = await countDraftsForDocument(documentId, db);
  if (drafts >= policy.draftsPerDocumentLimit) {
    throw new UsageLimitReachedError(
      `Draft limit of ${policy.draftsPerDocumentLimit} reached for this document.`,
    );
  }
}

export async function assertAskMessageAllowed(
  userMessageCount: number,
  db: QueryExecutor,
): Promise<void> {
  const policy = await getPlatformUsagePolicy(db);
  if (userMessageCount >= policy.messageLimit) {
    throw new UsageLimitReachedError(
      `Ask message limit of ${policy.messageLimit} reached for this document.`,
    );
  }
}

export { UsageLimitReachedError };
