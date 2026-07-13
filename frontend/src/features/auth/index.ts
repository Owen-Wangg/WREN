/**
 * Barrel for the auth feature (task 17.3).
 */
export { LoginForm, type LoginFormProps } from './components/LoginForm';
export { SignupForm, type SignupFormProps } from './components/SignupForm';

export {
  AuthError,
  type AuthErrorKind,
  type AuthService,
  type AuthSession,
  type SignInCredentials,
  type SignUpInput,
  type SignUpResult,
} from './authService';
export { authService } from './defaultAuthService';
export { MockAuthService } from './mockAuthService';
export { CognitoAuthService } from './cognitoAuthService';
export {
  loginSchema,
  signupSchema,
  type LoginFormValues,
  type SignupFormValues,
} from './authSchemas';
