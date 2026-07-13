import { useNavigate } from 'react-router-dom';

import { SignupForm } from '@/features/auth';

export function SignupPage() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted">
      <div className="flex w-full max-w-[480px] flex-col gap-xl">
        <SignupForm onSuccess={() => navigate('/dashboard')} />

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
    </div>
  );
}
