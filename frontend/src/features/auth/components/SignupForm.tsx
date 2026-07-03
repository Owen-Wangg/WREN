/**
 * `SignupForm` — account-creation screen for the Auth surface (task 17.3;
 * Requirement 37.1). See `LoginForm` for the shared conventions (RHF + Zod,
 * `AuthService` abstraction, semantic HTML, token-derived styling).
 */
import { useState } from 'react';

import { AuthError } from '../authService';
import { authService } from '../defaultAuthService';
import { signupSchema, type SignupFormValues } from '../authSchemas';

import { useZodForm } from '@/forms/useZodForm';

export interface SignupFormProps {
  /** Called after a successful sign-up (the account may still require IdP confirmation). */
  readonly onSuccess?: (result: { readonly confirmationRequired: boolean }) => void;
}

export function SignupForm({ onSuccess }: SignupFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useZodForm(signupSchema);

  const onSubmit = async (values: SignupFormValues) => {
    setSubmitError(null);
    try {
      const result = await authService.signUp(values);
      onSuccess?.(result);
    } catch (cause) {
      setSubmitError(
        cause instanceof AuthError
          ? cause.message
          : 'Something went wrong creating your account. Please try again.',
      );
    }
  };

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-lg"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="flex gap-md">
        <div className="flex flex-1 flex-col gap-xs">
          <label
            htmlFor="signup-first-name"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            First name
          </label>
          <input
            id="signup-first-name"
            type="text"
            autoComplete="given-name"
            aria-invalid={errors.firstName ? 'true' : undefined}
            aria-describedby={
              errors.firstName ? 'signup-first-name-error' : undefined
            }
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('firstName')}
          />
          {errors.firstName && (
            <p
              id="signup-first-name-error"
              className="text-bodySmall text-signal-critical"
            >
              {errors.firstName.message}
            </p>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-xs">
          <label
            htmlFor="signup-last-name"
            className="text-bodySmall font-sans font-medium text-text-secondary"
          >
            Last name
          </label>
          <input
            id="signup-last-name"
            type="text"
            autoComplete="family-name"
            aria-invalid={errors.lastName ? 'true' : undefined}
            aria-describedby={
              errors.lastName ? 'signup-last-name-error' : undefined
            }
            className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
            {...register('lastName')}
          />
          {errors.lastName && (
            <p
              id="signup-last-name-error"
              className="text-bodySmall text-signal-critical"
            >
              {errors.lastName.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-xs">
        <label
          htmlFor="signup-email"
          className="text-bodySmall font-sans font-medium text-text-secondary"
        >
          Email
        </label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={errors.email ? 'signup-email-error' : undefined}
          className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
          {...register('email')}
        />
        {errors.email && (
          <p id="signup-email-error" className="text-bodySmall text-signal-critical">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xs">
        <label
          htmlFor="signup-password"
          className="text-bodySmall font-sans font-medium text-text-secondary"
        >
          Password
        </label>
        <input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.password ? 'true' : undefined}
          aria-describedby={
            errors.password ? 'signup-password-error' : undefined
          }
          className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
          {...register('password')}
        />
        {errors.password && (
          <p
            id="signup-password-error"
            className="text-bodySmall text-signal-critical"
          >
            {errors.password.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xs">
        <label
          htmlFor="signup-confirm-password"
          className="text-bodySmall font-sans font-medium text-text-secondary"
        >
          Confirm password
        </label>
        <input
          id="signup-confirm-password"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.confirmPassword ? 'true' : undefined}
          aria-describedby={
            errors.confirmPassword
              ? 'signup-confirm-password-error'
              : undefined
          }
          className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p
            id="signup-confirm-password-error"
            className="text-bodySmall text-signal-critical"
          >
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      {submitError && (
        <p role="alert" className="text-bodySmall text-signal-critical">
          {submitError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-md bg-text-primary px-md py-sm text-body font-sans font-medium text-text-on-accent disabled:opacity-60"
      >
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
