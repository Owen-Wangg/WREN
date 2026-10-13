/**
 * Validation schemas for the auth screens, colocated with the forms that use
 * them (frontend steering §9: "validation schemas live alongside the form").
 */
import { z } from 'zod';
import {
  isSignupEmailDomainAllowed,
  signupEmailDomainRestrictionMessage,
} from '@wren/types';

import { appConfig } from '@/config/env';

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required.').email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

export const PASSWORD_REQUIREMENTS = {
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
};

const passwordSchema = z
  .string()
  .min(PASSWORD_REQUIREMENTS.minLength, `Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters.`)
  .refine((pwd) => !PASSWORD_REQUIREMENTS.requireUppercase || /[A-Z]/.test(pwd), 'Must contain at least one uppercase letter.')
  .refine((pwd) => !PASSWORD_REQUIREMENTS.requireLowercase || /[a-z]/.test(pwd), 'Must contain at least one lowercase letter.')
  .refine((pwd) => !PASSWORD_REQUIREMENTS.requireNumbers || /\d/.test(pwd), 'Must contain at least one number.')
  .refine((pwd) => !PASSWORD_REQUIREMENTS.requireSpecialChars || /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd), 'Must contain at least one special character.');

export function createSignupSchema(allowedEmailDomains: readonly string[] = []) {
  return z
    .object({
      firstName: z.string().min(1, 'First name is required.'),
      lastName: z.string().min(1, 'Last name is required.'),
      email: z
        .string()
        .min(1, 'Email is required.')
        .email('Enter a valid email address.')
        // UX hint only; Cognito's PreSignUp trigger is the real gate. With no
        // list configured (e.g. local mock mode) skip the check and let the
        // server decide.
        .refine(
          (email) =>
            allowedEmailDomains.length === 0 ||
            isSignupEmailDomainAllowed(email, allowedEmailDomains),
          { message: signupEmailDomainRestrictionMessage(allowedEmailDomains) },
        ),
      password: passwordSchema,
      confirmPassword: z.string().min(1, 'Confirm your password.'),
    })
    .refine((values) => values.password === values.confirmPassword, {
      message: 'Passwords do not match.',
      path: ['confirmPassword'],
    });
}

export const signupSchema = createSignupSchema(appConfig.allowedEmailDomains);

export type SignupFormValues = z.infer<typeof signupSchema>;

export const confirmationSchema = z.object({
  code: z.string().min(1, 'Verification code is required.').regex(/^\d{6}$/, 'Code must be 6 digits.'),
});

export type ConfirmationFormValues = z.infer<typeof confirmationSchema>;

export const forgotPasswordEmailSchema = z.object({
  email: z.string().min(1, 'Email is required.').email('Enter a valid email address.'),
});

export type ForgotPasswordEmailValues = z.infer<typeof forgotPasswordEmailSchema>;

export const resetPasswordSchema = z
  .object({
    code: z.string().min(1, 'Reset code is required.').regex(/^\d{6}$/, 'Code must be 6 digits.'),
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
