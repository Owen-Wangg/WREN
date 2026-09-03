/**
 * `@wren/auth` — Auth_Service for WREN Writing Coach (Node 22).
 *
 * Cognito JWT verification (`aws-jwt-verify`) for authentication only, plus
 * app-database identity mapping that resolves roles, Department scopes, and
 * Access Grants into an {@link AuthContext} for the API Gateway Lambda
 * authorizer. Authorization is decoupled from the identity provider: the app DB
 * is the single source of truth (REQ-SEC-AUTHDECOUPLE-01).
 */
export {
  createAuthorizerHandler,
  handler,
  extractBearerToken,
  stageWildcardResource,
  serializeAuthContext,
  UNAUTHORIZED,
  type AuthorizerDeps,
  type DepsProvider,
} from './authorizer';
export {
  mapSubjectToAuthContext,
  type QueryExecutor,
  type AppUserRow,
  type RoleAssignmentRow,
  type AccessGrantRow,
} from './identityMapping';
export { ensureAppUser, type ProvisionUserInput } from './provisionUser';
export {
  createCognitoProfileLookup,
  type CognitoProfile,
  type CognitoProfileLookup,
} from './cognitoProfile';
export {
  CognitoTokenVerifier,
  type TokenVerifier,
  type VerifiedIdentity,
  type CognitoVerifierConfig,
} from './tokenVerifier';
export {
  resolveCognitoVerifierConfig,
  AUTHORIZER_ENV_KEYS,
  type AuthorizerEnv,
} from './config';
export {
  resolveAccess,
  hasApplicableGrant,
  isSubmissionPermitted,
  shouldOfferAccessRequest,
  type AccessResolutionInput,
  type DocumentTypeAccessInput,
} from './accessResolution';
export {
  authorizeCapability,
  isCapabilityAllowed,
} from './capabilityMatrix';
export {
  canDiscoverDepartment,
  type DepartmentVisibilityInput,
} from './departmentVisibility';
export {
  authorizeRoleAssignment,
  isRoleAssignmentAllowed,
  type RoleAssignmentRequest,
} from './roleAssignment';

export type {
  AccessDecision,
  AuthContext,
  AuthorizationDecision,
  AssignmentAction,
  AssignmentScope,
  Capability,
  CapabilityRequest,
  OperationScope,
} from '@wren/types';
