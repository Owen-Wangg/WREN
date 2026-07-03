/**
 * `LoginForm` — sign-in screen for the Auth surface (task 17.3; Requirement
 * 37.1). Authenticates against the IdP via {@link AuthService} (not a direct
 * Cognito SDK call — see `../authService`), using React Hook Form + Zod
 * validation at the boundary (frontend steering §9) with the schema colocated
 * in `../authSchemas`.
 *
 * Semantic HTML first (steering §8): a `<form>` with associated `<label>`s;
 * the submission error is announced via `role="alert"`. No raw hex/px values —
 * all styling uses token-derived Tailwind utilities (steering §9).
 */
import { useState } from 'react';

import { AuthError } from '../authService';
import { authService } from '../defaultAuthService';
import { loginSchema, type LoginFormValues } from '../authSchemas';

import { useZodForm } from '@/forms/useZodForm';

export interface LoginFormProps {
  /** Called with the resulting session after a successful sign-in. */
  readonly onSuccess?: (session: { readonly idToken: string }) => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useZodForm(loginSchema);

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    try {
      const session = await authService.signIn(values);
      onSuccess?.(session);
    } catch (cause) {
      setSubmitError(
        cause instanceof AuthError
          ? cause.message
          : 'Something went wrong signing in. Please try again.',
      );
    }
  };

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-lg"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="flex flex-col gap-xs">
        <label
          htmlFor="login-email"
          className="text-bodySmall font-sans font-medium text-text-secondary"
        >
          Email
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={errors.email ? 'login-email-error' : undefined}
          className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
          {...register('email')}
        />
        {errors.email && (
          <p id="login-email-error" className="text-bodySmall text-signal-critical">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xs">
        <label
          htmlFor="login-password"
          className="text-bodySmall font-sans font-medium text-text-secondary"
        >
          Password
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? 'true' : undefined}
          aria-describedby={
            errors.password ? 'login-password-error' : undefined
          }
          className="rounded-md border border-border-strong bg-surface-primary px-md py-sm text-body text-text-primary"
          {...register('password')}
        />
        {errors.password && (
          <p
            id="login-password-error"
            className="text-bodySmall text-signal-critical"
          >
            {errors.password.message}
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
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
