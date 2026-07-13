import { useNavigate } from 'react-router-dom';

export function ProfilePage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-xl">
      <h1 className="text-title-page font-sans font-bold text-text-primary">
        Profile
      </h1>
      <div className="flex flex-col gap-lg rounded-md border border-border-subtle bg-surface-primary p-2xl">
        <div className="flex items-center gap-lg">
          <div className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-surface-muted">
            <span className="text-heading2 text-text-muted">U</span>
          </div>
          <div className="flex flex-col gap-xs">
            <p className="text-heading3 font-sans font-semibold text-text-primary">Student User</p>
            <p className="text-bodySmall text-text-muted">student@university.ca</p>
          </div>
        </div>

        <hr className="border-border-subtle" />

        <div className="flex flex-col gap-sm">
          <p className="text-body text-text-secondary">
            <span className="font-semibold">Role:</span> Student
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/')}
          className="self-start rounded-md border border-border-strong px-lg py-sm text-bodySmall font-sans font-medium text-text-primary hover:bg-surface-muted"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
