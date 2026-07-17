import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { SignupForm } from '@/features/auth/components/SignupForm';
import { VerificationCodeDialog } from '@/features/auth/components/VerificationCodeDialog';
import { authService } from '@/features/auth/defaultAuthService';
import { useAuth } from '@/features/auth/AuthContext';

export function SignupPage() {
  const navigate = useNavigate();
  const { signIn, user } = useAuth();
  const [showVerification, setShowVerification] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSignupSuccess = (result: {
    readonly confirmationRequired: boolean;
    readonly email: string;
    readonly password?: string;
  }) => {
    if (result.confirmationRequired) {
      setEmail(result.email);
      if (result.password) {
        setPassword(result.password);
      }
      setShowVerification(true);
    } else {
      navigate('/dashboard');
    }
  };

  const handleVerificationConfirm = async (code: string) => {
    try {
      await authService.confirmSignUp(email, code);

      // Sign in user to populate roles from database
      await signIn(email, password);

      // Redirect based on role
      if (!user) {
        navigate('/dashboard');
        return;
      }

      const primaryRole = user.roles[0];
      if (primaryRole === 'TechnicalAdmin') {
        navigate('/system-admin');
      } else if (primaryRole === 'DepartmentAdmin') {
        navigate('/dept-admin');
      } else {
        navigate('/dashboard');
      }
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
