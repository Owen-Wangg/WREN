/**
 * Shared toolbar primitives for the document editor (Phase 1+).
 * Active/disabled state is owned by callers (derived from TipTap selection).
 */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';

export function ToolbarGroup({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly 'aria-label'?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={['flex items-center gap-xs', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}

export function ToolbarDivider({ className }: { readonly className?: string } = {}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={['mx-xs h-5 w-px shrink-0 bg-border-subtle', className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}

export interface ToolbarButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  readonly label: string;
  readonly icon: ReactNode;
  /** Toggle marks / list / heading — maps to aria-pressed. */
  readonly pressed?: boolean;
  readonly shortcutHint?: string;
}

export const ToolbarButton = forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    {
      label,
      icon,
      pressed = false,
      disabled,
      shortcutHint,
      className,
      type = 'button',
      ...rest
    },
    ref,
  ) {
    const title = shortcutHint ? `${label} (${shortcutHint})` : label;
    return (
      <button
        ref={ref}
        type={type}
        title={title}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        className={[
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
          'text-text-secondary transition-colors',
          'hover:bg-surface-muted hover:text-text-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40',
          'disabled:pointer-events-none disabled:opacity-40',
          pressed
            ? 'bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/15'
            : '',
          className ?? '',
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      >
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      </button>
    );
  },
);

ToolbarButton.displayName = 'ToolbarButton';
