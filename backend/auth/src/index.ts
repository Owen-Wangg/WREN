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
export {
  ensureAppUser,
  IdentityProvisioningRefusedError,
  type ProvisionUserInput,
  type ProvisionUserDeps,
  type ProvisioningDb,
  type ProvisioningRefusalReason,
} from './provisionUser';
export {
  createCognitoProfileLookup,
  createCognitoSubjectLivenessCheck,
  type CognitoProfile,
  type CognitoProfileLookup,
  type CognitoSubjectLivenessCheck,
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
  checkSubmissionAccess,
  submissionAccessDeniedResponse,
  type SubmissionAccessResult,
  type SubmissionAccessPermitted,
  type SubmissionAccessDenied,
  type SubmissionAccessDeniedCode,
} from './submissionAccess';
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
export {
  bindCorsOrigin,
  corsResponseHeaders,
  originFromEvent,
  resolveAllowedOrigin,
  withCorsHeaders,
} from './cors';
export {
  signSerializedAuthContext,
  verifySerializedAuthContext,
  rejectIfForgedAuthContext,
  computeAuthContextSignature,
  loadAuthContextSigningSecret,
  getAuthContextSigningSecret,
  resetAuthContextSigningSecretCache,
  resolveAuthContextVerifyMode,
  isAuthContextSigningConfigured,
  ForgedAuthContextError,
  AUTH_CONTEXT_SIGNING_SECRET_ENV,
  AUTH_CONTEXT_VERIFY_MODE_ENV,
  AUTH_CONTEXT_SIG_FIELD,
  type AuthContextVerifyMode,
  type VerifyAuthContextOptions,
} from './authContextSigning';

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
