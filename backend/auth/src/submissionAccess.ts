/**
 * DB-backed submission access check (REQ-DOC-SUBMIT-01 / Requirement 6.8,
 * REQ-DOMAIN-ACCESS-01 / Requirement 4).
 *
 * Every operation that submits work to a Document Type — creating a Document,
 * recording a new Draft version, autosaving the current Draft, requesting an
 * AI Debrief, or sending an Ask WREN turn — MUST run this check server-side on
 * every request. Checking only at document creation lets a Student who created
 * a Document while access was open keep submitting after the department is
 * LOCKED, their Access Grant is revoked, or the department is archived.
 *
 * The check loads current facts from the database on each call (never from the
 * authorizer context or UI state) and fails closed:
 *   - unknown Document Type            -> DOCUMENT_TYPE_NOT_FOUND (400)
 *   - archived department              -> DEPARTMENT_ARCHIVED (400)
 *   - LOCKED without an active grant   -> ACCESS_REQUEST_REQUIRED (403)
 *   - missing caller identity or an unrecognised access state is treated as
 *     LOCKED, so it can only be permitted by an explicit active grant.
 *
 * The OPEN/LOCKED decision itself is delegated to the pure
 * {@link resolveAccess}; this module only gathers its inputs.
 */
import type { AccessDecision, AccessGrant } from '@wren/types';

import { resolveAccess } from './accessResolution';
import type { QueryExecutor } from './identityMapping';

export type SubmissionAccessDeniedCode =
  | 'DOCUMENT_TYPE_NOT_FOUND'
  | 'DEPARTMENT_ARCHIVED'
  | 'ACCESS_REQUEST_REQUIRED';

export interface SubmissionAccessPermitted {
  readonly ok: true;
  readonly decision: Extract<AccessDecision, 'OPEN' | 'GRANTED'>;
  readonly documentTypeId: string;
  /** Per-Document-Type word limit override (null when not configured). */
  readonly sizeLimitWords: number | null;
}

export interface SubmissionAccessDenied {
  readonly ok: false;
  readonly statusCode: 400 | 403;
  readonly code: SubmissionAccessDeniedCode;
  readonly message: string;
  readonly documentTypeId: string;
}

export type SubmissionAccessResult = SubmissionAccessPermitted | SubmissionAccessDenied;

interface DocumentTypeAccessRow {
  readonly id: string;
  readonly access_state: string | null;
  readonly size_limit_words: number | null;
  readonly archived_at: unknown;
}

interface AccessGrantDbRow {
  readonly id: string;
  readonly userId: string;
  readonly documentTypeId: string;
  readonly grantedBy: string | null;
  readonly grantedAt: string | null;
}

const DOCUMENT_TYPE_ACCESS_SQL = `SELECT dt.id, d.access_state AS access_state, dt.size_limit_words, d.archived_at
     FROM document_type dt
     INNER JOIN department d ON d.id = dt.department_id
     WHERE dt.id = $1`;

const ACTIVE_GRANTS_SQL = `SELECT id,
            user_id AS "userId",
            document_type_id AS "documentTypeId",
            granted_by AS "grantedBy",
            granted_at::text AS "grantedAt"
     FROM access_grant
     WHERE user_id = $1
       AND document_type_id = $2
       AND revoked_at IS NULL`;

function denied(
  statusCode: 400 | 403,
  code: SubmissionAccessDeniedCode,
  message: string,
  documentTypeId: string,
): SubmissionAccessDenied {
  return { ok: false, statusCode, code, message, documentTypeId };
}

/**
 * Resolve whether `userId` may currently submit to `documentTypeId`.
 * Callers MUST NOT perform the submission (create/modify a Draft, reserve a
 * usage slot, enqueue a paid job, call Bedrock) unless `ok` is true.
 */
export async function checkSubmissionAccess(
  db: QueryExecutor,
  userId: string | null | undefined,
  documentTypeId: string,
): Promise<SubmissionAccessResult> {
  const typeRows = await db.query<DocumentTypeAccessRow>(DOCUMENT_TYPE_ACCESS_SQL, [
    documentTypeId,
  ]);
  const typeRow = typeRows[0];
  if (!typeRow) {
    return denied(
      400,
      'DOCUMENT_TYPE_NOT_FOUND',
      `Document type '${documentTypeId}' was not found`,
      documentTypeId,
    );
  }

  if (typeRow.archived_at) {
    return denied(
      400,
      'DEPARTMENT_ARCHIVED',
      'This department is no longer accepting submissions.',
      documentTypeId,
    );
  }

  // Fail closed: anything other than an explicit OPEN is treated as LOCKED.
  const accessState: 'OPEN' | 'LOCKED' = typeRow.access_state === 'OPEN' ? 'OPEN' : 'LOCKED';

  // Without a caller identity no grant can apply; skip the lookup.
  const grants: AccessGrant[] = userId
    ? (await db.query<AccessGrantDbRow>(ACTIVE_GRANTS_SQL, [userId, documentTypeId]))
        .filter((row) => row.userId === userId && row.documentTypeId === documentTypeId)
        .map((row) => ({
          id: row.id,
          userId: row.userId,
          documentTypeId: row.documentTypeId,
          grantedBy: row.grantedBy ?? '',
          grantedAt: row.grantedAt ?? '',
        }))
    : [];

  const decision = resolveAccess({
    documentType: { id: documentTypeId, accessState },
    grants,
  });

  // OPEN never needs an identity-bound grant, but an unauthenticated caller
  // must still not be permitted to submit.
  if (!userId || (decision !== 'OPEN' && decision !== 'GRANTED')) {
    return denied(
      403,
      'ACCESS_REQUEST_REQUIRED',
      'This department is locked. Request access from a department admin.',
      documentTypeId,
    );
  }

  return {
    ok: true,
    decision,
    documentTypeId,
    sizeLimitWords: typeof typeRow.size_limit_words === 'number' ? typeRow.size_limit_words : null,
  };
}

/**
 * Map a denied result to the API Gateway response shape. The 400 not-found case
 * keeps the historical `BAD_REQUEST` code so existing clients are unaffected.
 */
export function submissionAccessDeniedResponse(result: SubmissionAccessDenied): {
  statusCode: number;
  body: string;
} {
  const code = result.code === 'DOCUMENT_TYPE_NOT_FOUND' ? 'BAD_REQUEST' : result.code;
  return {
    statusCode: result.statusCode,
    body: JSON.stringify({
      code,
      message: result.message,
      ...(result.code === 'ACCESS_REQUEST_REQUIRED'
        ? { documentTypeId: result.documentTypeId }
        : {}),
    }),
  };
}
