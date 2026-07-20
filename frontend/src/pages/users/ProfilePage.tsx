import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthContext';

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const displayName = user?.email ?? 'Student User';
  const initial = displayName.charAt(0).toUpperCase();
  const role = user?.roles?.[0] ?? 'Student';

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="flex flex-col gap-xl">
      <h1 className="text-title-page font-sans font-bold text-text-primary">
        Profile
      </h1>
      <div className="flex flex-col gap-lg rounded-md border border-border-subtle bg-surface-primary p-2xl">
        <div className="flex items-center gap-lg">
          <div className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-surface-muted">
            <span className="text-heading2 text-text-muted">{initial}</span>
          </div>
          <div className="flex flex-col gap-xs">
            <p className="text-heading3 font-sans font-semibold text-text-primary">{displayName}</p>
            {user?.email && (
              <p className="text-bodySmall text-text-muted">{user.email}</p>
            )}
          </div>
        </div>

        <hr className="border-border-subtle" />

        <div className="flex flex-col gap-sm">
          <p className="text-body text-text-secondary">
            <span className="font-semibold">Role:</span> {role}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="self-start rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
