/**
 * UPDATE /v1/document-types/{id}/config
 *
 * Example service handler that:
 * 1. Receives AuthContext from Lambda Authorizer
 * 2. RE-CHECKS DATABASE for permissions (dual enforcement)
 * 3. NEVER trusts token claims alone
 *
 * CRITICAL: This is fine-grained enforcement
 * Lambda Authorizer provides coarse enforcement, but this is the source of truth
 */
import type { APIGatewayProxyHandler } from 'aws-lambda';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const authContext = parseAuthContext(event);
    const { documentTypeId } = event.pathParameters || {};

    // Step 1: Get the document type's department
    const docType = await queryDatabase(
      `SELECT department_id FROM document_types WHERE id = $1`,
      [documentTypeId],
    );

    if (!docType) {
      return { statusCode: 404, body: JSON.stringify({ code: 'NOT_FOUND' }) };
    }

    // Step 2: CRITICAL - Re-check database for permission
    // Do NOT trust AuthContext.administeredDepartmentIds
    // Always query database to ensure this user administers this department
    const userRole = await queryDatabase(
      `SELECT role FROM user_roles 
       WHERE user_id = $1 AND role = 'DepartmentAdmin' AND scope_id = $2`,
      [authContext.userId, docType.department_id],
    );

    // Step 3: Also check TechnicalAdmin (but with prompt restriction)
    let isTechAdmin = false;
    if (!userRole) {
      const techRole = await queryDatabase(
        `SELECT role FROM user_roles 
         WHERE user_id = $1 AND role = 'TechnicalAdmin'`,
        [authContext.userId],
      );
      isTechAdmin = !!techRole;
    }

    if (!userRole && !isTechAdmin) {
      return { statusCode: 403, body: JSON.stringify({ code: 'FORBIDDEN' }) };
    }

    // Step 4: Parse request body
    const body = JSON.parse(event.body || '{}');

    // Step 5: Check prompt editing restriction for TechAdmin
    if (isTechAdmin && body.promptText) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          code: 'FORBIDDEN',
          message: 'Technical admins cannot edit prompt text',
        }),
      };
    }

    // Step 6: Update database
    if (documentTypeId) {
      await updateDocumentTypeConfig(documentTypeId, body);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ documentTypeId, ...body }),
    };
  } catch (error) {
    console.error('Error updating document type config:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ code: 'INTERNAL_ERROR' }),
    };
  }
};

async function queryDatabase(_query: string, _params: any[]): Promise<any> {
  return null;
}

async function updateDocumentTypeConfig(_typeId: string, _config: any): Promise<void> {
  // not yet implemented
}

function parseAuthContext(event: any) {
  const context = event.requestContext?.authorizer;
  if (!context) throw new Error('Missing authorization context');
  return {
    userId: context.userId,
    roles: JSON.parse(context.roles || '[]'),
    administeredDepartmentIds: JSON.parse(context.administeredDepartmentIds || '[]'),
  };
}

