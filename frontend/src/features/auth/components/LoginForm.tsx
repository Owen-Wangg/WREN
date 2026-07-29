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
import {
  loginSchema,
  forgotPasswordEmailSchema,
  resetPasswordSchema,
  type LoginFormValues,
  type ForgotPasswordEmailValues,
  type ResetPasswordValues,
} from '../authSchemas';

import { useZodForm } from '@/forms/useZodForm';

export interface LoginFormProps {
  /** Called after a successful sign-in with email and password for auth context to fetch roles. */
  readonly onSuccess?: (email: string, password: string) => void | Promise<void>;
}

type ForgotStep = 'idle' | 'request' | 'reset' | 'done';

function ForgotPasswordFlow({ onCancel }: { onCancel: () => void }) {
  const [step, setStep] = useState<ForgotStep>('request');
  const [resetEmail, setResetEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const emailForm = useZodForm(forgotPasswordEmailSchema);
  const resetForm = useZodForm(resetPasswordSchema);

  const onRequestCode = async (values: ForgotPasswordEmailValues) => {
    setError(null);
    try {
      await authService.forgotPassword(values.email);
      setResetEmail(values.email);
      setStep('reset');
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : 'Something went wrong. Please try again.',
      );
    }
  };

  const onResetPassword = async (values: ResetPasswordValues) => {
    setError(null);
    try {
      await authService.confirmForgotPassword(resetEmail, values.code, values.password);
      setStep('done');
    } catch (cause) {
      setError(
        cause instanceof AuthError
          ? cause.message
          : 'Something went wrong. Please try again.',
      );
    }
  };

  if (step === 'done') {
    return (
      <div className="flex flex-col gap-lg">
        <div className="flex flex-col gap-xs">
          <p className="text-body font-sans font-semibold text-text-primary">Password reset</p>
          <p className="text-bodySmall text-text-secondary">
            Your password has been reset successfully. You can now sign in.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md bg-accent-primary px-lg py-sm text-body font-sans font-semibold text-text-on-accent disabled:opacity-60"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (step === 'reset') {
    return (
      <form
        className="flex flex-col gap-lg"
        noValidate
        onSubmit={resetForm.handleSubmit(onResetPassword)}
      >
        <div className="flex flex-col gap-xs">
          <p className="text-body font-sans font-semibold text-text-primary">Reset your password</p>
          <p className="text-bodySmall text-text-secondary">
            We sent a 6-digit code to <span className="font-medium text-text-primary">{resetEmail}</span>. Enter it below along with your new password.
          </p>
        </div>

        <div className="flex flex-col gap-xs">
          <label htmlFor="reset-code" className="text-bodySmall font-sans font-medium text-text-secondary">
            Reset code
          </label>
          <input
            id="reset-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-invalid={resetForm.formState.errors.code ? 'true' : undefined}
            className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary placeholder:text-text-muted/60"
            {...resetForm.register('code')}
          />
          {resetForm.formState.errors.code && (
            <p className="text-bodySmall text-signal-critical">{resetForm.formState.errors.code.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-xs">
          <label htmlFor="reset-password" className="text-bodySmall font-sans font-medium text-text-secondary">
            New password
          </label>
          <input
            id="reset-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={resetForm.formState.errors.password ? 'true' : undefined}
            className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary placeholder:text-text-muted/60"
            {...resetForm.register('password')}
          />
          {resetForm.formState.errors.password && (
            <p className="text-bodySmall text-signal-critical">{resetForm.formState.errors.password.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-xs">
          <label htmlFor="reset-confirm" className="text-bodySmall font-sans font-medium text-text-secondary">
            Confirm new password
          </label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={resetForm.formState.errors.confirmPassword ? 'true' : undefined}
            className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary placeholder:text-text-muted/60"
            {...resetForm.register('confirmPassword')}
          />
          {resetForm.formState.errors.confirmPassword && (
            <p className="text-bodySmall text-signal-critical">{resetForm.formState.errors.confirmPassword.message}</p>
          )}
        </div>

        {error && <p role="alert" className="text-bodySmall text-signal-critical">{error}</p>}

        <button
          type="submit"
          disabled={resetForm.formState.isSubmitting}
          className="rounded-md bg-accent-primary px-lg py-sm text-body font-sans font-semibold text-text-on-accent disabled:opacity-60"
        >
          {resetForm.formState.isSubmitting ? 'Resetting…' : 'Reset password'}
        </button>
        <button type="button" onClick={onCancel} className="self-center text-bodySmall font-sans text-text-secondary underline">
          Cancel
        </button>
      </form>
    );
  }

  // step === 'request'
  return (
    <form
      className="flex flex-col gap-lg"
      noValidate
      onSubmit={emailForm.handleSubmit(onRequestCode)}
    >
      <div className="flex flex-col gap-xs">
        <p className="text-body font-sans font-semibold text-text-primary">Forgot your password?</p>
        <p className="text-bodySmall text-text-secondary">
          Enter your email and we'll send you a reset code.
        </p>
      </div>

      <div className="flex flex-col gap-xs">
        <label htmlFor="forgot-email" className="text-bodySmall font-sans font-medium text-text-secondary">
          Email
        </label>
        <input
          id="forgot-email"
          type="email"
          autoComplete="email"
          aria-invalid={emailForm.formState.errors.email ? 'true' : undefined}
          className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary placeholder:text-text-muted/60"
          {...emailForm.register('email')}
        />
        {emailForm.formState.errors.email && (
          <p className="text-bodySmall text-signal-critical">{emailForm.formState.errors.email.message}</p>
        )}
      </div>

      {error && <p role="alert" className="text-bodySmall text-signal-critical">{error}</p>}

      <button
        type="submit"
        disabled={emailForm.formState.isSubmitting}
        className="rounded-md bg-accent-primary px-lg py-sm text-body font-sans font-semibold text-text-on-accent disabled:opacity-60"
      >
        {emailForm.formState.isSubmitting ? 'Sending…' : 'Send reset code'}
      </button>
      <button type="button" onClick={onCancel} className="self-center text-bodySmall font-sans text-text-secondary underline">
        Back to sign in
      </button>
    </form>
  );
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useZodForm(loginSchema);

  const onSubmit = async (values: LoginFormValues) => {
    setSubmitError(null);
    try {
      await authService.signIn(values);
      // Call onSuccess with credentials so auth context can sign in and fetch roles
      await onSuccess?.(values.email, values.password);
    } catch (cause) {
      setSubmitError(
        cause instanceof AuthError
          ? cause.message
          : 'Something went wrong signing in. Please try again.',
      );
    }
  };

  if (showForgotPassword) {
    return (
      <div className="flex w-full max-w-[720px] flex-col gap-lg rounded-md border border-border-subtle bg-surface-primary p-2xl">
        <ForgotPasswordFlow onCancel={() => setShowForgotPassword(false)} />
      </div>
    );
  }

  return (
    <form
      className="flex w-full max-w-[720px] flex-col gap-lg rounded-md border border-border-subtle bg-surface-primary p-2xl"
      noValidate
      onSubmit={handleSubmit(onSubmit)}
    >
      <div className="flex flex-col gap-xs">
        <label
          htmlFor="login-email"
          className="text-body font-sans font-medium text-text-secondary"
        >
          Email
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          placeholder="Email"
          aria-invalid={errors.email ? 'true' : undefined}
          aria-describedby={errors.email ? 'login-email-error' : undefined}
          className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary placeholder:text-text-muted/60"
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
          className="text-body font-sans font-medium text-text-secondary"
        >
          Password
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          aria-invalid={errors.password ? 'true' : undefined}
          aria-describedby={
            errors.password ? 'login-password-error' : undefined
          }
          className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary placeholder:text-text-muted/60"
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
        className="rounded-md bg-accent-primary px-lg py-sm text-body font-sans font-semibold text-text-on-accent disabled:opacity-60"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>

      <button
        type="button"
        onClick={() => setShowForgotPassword(true)}
        className="self-center text-body font-sans text-text-secondary underline"
      >
        Forgot password?
      </button>
    </form>
  );
}
