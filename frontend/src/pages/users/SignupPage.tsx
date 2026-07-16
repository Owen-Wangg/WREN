import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { SignupForm } from '@/features/auth/components/SignupForm';
import { VerificationCodeDialog } from '@/features/auth/components/VerificationCodeDialog';
import { authService } from '@/features/auth/defaultAuthService';

export function SignupPage() {
  const navigate = useNavigate();
  const [showVerification, setShowVerification] = useState(false);
  const [email, setEmail] = useState('');

  const handleSignupSuccess = (result: {
    readonly confirmationRequired: boolean;
    readonly email: string;
  }) => {
    if (result.confirmationRequired) {
      setEmail(result.email);
      setShowVerification(true);
    } else {
      navigate('/dashboard');
    }
  };

  const handleVerificationConfirm = async (code: string) => {
    try {
      await authService.confirmSignUp(email, code);
      navigate('/dashboard');
    } catch (cause) {
      console.error('Verification failed:', cause);
      throw cause;
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted">
      <div className="flex w-full max-w-[480px] flex-col gap-xl">
        <SignupForm onSuccess={handleSignupSuccess} />

        <div className="flex flex-col items-center gap-sm">
          <span className="text-bodySmall text-text-muted">
            Already have an account?
          </span>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-bodySmall font-sans text-text-secondary underline"
          >
            Log in
          </button>
        </div>
      </div>

      <VerificationCodeDialog
        email={email}
        isOpen={showVerification}
        onConfirm={handleVerificationConfirm}
      />
    </div>
  );
}
