import { PASSWORD_REQUIREMENTS } from '../authSchemas';

interface PasswordCriteriaDisplayProps {
  password: string;
}

export function PasswordCriteriaDisplay({ password }: PasswordCriteriaDisplayProps) {
  const criteria = [
    {
      label: `At least ${PASSWORD_REQUIREMENTS.minLength} characters`,
      met: password.length >= PASSWORD_REQUIREMENTS.minLength,
    },
    {
      label: 'At least one uppercase letter (A-Z)',
      met: /[A-Z]/.test(password),
    },
    {
      label: 'At least one lowercase letter (a-z)',
      met: /[a-z]/.test(password),
    },
    {
      label: 'At least one number (0-9)',
      met: /\d/.test(password),
    },
    {
      label: 'At least one special character (!@#$%^&*...)',
      met: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    },
  ];

  const allMet = criteria.every((c) => c.met);

  return (
    <div className="flex flex-col gap-md rounded-md border border-border-subtle bg-surface-subtle p-md">
      <p className="text-bodySmall font-sans font-medium text-text-secondary">
        Password requirements:
      </p>
      <div className="flex flex-col gap-sm">
        {criteria.map((criterion) => (
          <div key={criterion.label} className="flex items-center gap-sm">
            <div
              className={`h-4 w-4 rounded-full flex items-center justify-center text-bodySmall font-bold ${
                criterion.met
                  ? 'bg-signal-positive text-text-on-accent'
                  : 'bg-surface-panel text-text-muted'
              }`}
            >
              {criterion.met ? '✓' : '○'}
            </div>
            <span
              className={`text-bodySmall font-sans ${
                criterion.met ? 'text-text-primary' : 'text-text-muted'
              }`}
            >
              {criterion.label}
            </span>
          </div>
        ))}
      </div>
      {allMet && (
        <p className="text-bodySmall font-sans text-signal-positive">
          ✓ All requirements met
        </p>
      )}
    </div>
  );
}
