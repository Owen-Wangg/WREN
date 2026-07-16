import { useState } from 'react';
import { confirmationSchema, type ConfirmationFormValues } from '../authSchemas';
import { useZodForm } from '@/forms/useZodForm';

interface VerificationCodeDialogProps {
  email: string;
  onConfirm: (code: string) => Promise<void>;
  isOpen: boolean;
}

export function VerificationCodeDialog({ email, onConfirm, isOpen }: VerificationCodeDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useZodForm(confirmationSchema);

  const onSubmit = async (values: ConfirmationFormValues) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await onConfirm(values.code);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Failed to verify code. Please try again.',
      );
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
      <div className="flex w-full max-w-[480px] flex-col gap-lg rounded-md border border-border-subtle bg-surface-primary p-2xl shadow-lg">
        <div className="flex flex-col gap-md">
          <h2 className="text-heading2 font-sans font-bold text-text-primary">
            Verify your email
          </h2>
          <p className="text-body text-text-secondary">
            We sent a 6-digit code to <strong>{email}</strong>. Enter it below.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-lg noValidate">
          <div className="flex flex-col gap-xs">
            <label
              htmlFor="verification-code"
              className="text-bodySmall font-sans font-medium text-text-secondary"
            >
              Verification code
            </label>
            <input
              id="verification-code"
              type="text"
              inputMode="numeric"
              placeholder="000000"
              maxLength={6}
              aria-invalid={errors.code ? 'true' : undefined}
              aria-describedby={
                errors.code ? 'verification-code-error' : undefined
              }
              className="rounded-md border border-border-subtle bg-surface-primary px-lg py-sm text-body text-text-primary placeholder:text-text-muted/60 text-center font-mono text-lg tracking-widest"
              {...register('code')}
            />
            {errors.code && (
              <p
                id="verification-code-error"
                className="text-bodySmall text-signal-critical"
              >
                {errors.code.message}
              </p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-bodySmall text-signal-critical">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-accent-primary px-lg py-sm text-body font-sans font-semibold text-text-on-accent shadow-md disabled:opacity-60"
          >
            {isSubmitting ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <p className="text-bodySmall text-text-muted text-center">
          Didn&apos;t receive a code?{' '}
          <button
            type="button"
            className="text-text-secondary underline"
            disabled={isSubmitting}
          >
            Resend
          </button>
        </p>
      </div>
    </div>
  );
}
