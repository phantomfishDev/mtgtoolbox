import type { ReactNode } from 'react';

/** Small shared primitives, kept here so views stay about behaviour. */

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-edge bg-panel p-4 ${className}`}>{children}</div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  type = 'button',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
}) {
  const styles = {
    primary: 'bg-accent text-surface hover:opacity-90',
    default: 'border border-edge bg-surface hover:border-accent',
    ghost: 'hover:bg-edge/50',
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="rounded-md border border-edge bg-surface px-2 py-1.5 text-sm"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 accent-accent"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'good' | 'warn';
}) {
  const styles = {
    neutral: 'bg-edge text-muted',
    good: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  }[tone];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${styles}`}>{children}</span>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted">
      <span className="size-3 animate-spin rounded-full border-2 border-edge border-t-accent" />
      {label}
    </span>
  );
}
