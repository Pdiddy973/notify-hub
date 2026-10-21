import type { MessageStatus, Severity } from '@notify-hub/shared';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useEffect, useId, useState } from 'react';

const join = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button
      type="button"
      {...props}
      className={join(
        'inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-strong',
        variant === 'secondary' && 'bg-raised text-ink hover:bg-line',
        variant === 'ghost' && 'text-muted hover:bg-raised hover:text-ink',
        className,
      )}
    />
  );
}

const fieldClass =
  'w-full rounded border border-line bg-page px-3 py-2 text-sm text-ink placeholder:text-muted ' +
  'focus:border-accent focus:outline-none';

interface FieldProps {
  label: string;
  error?: string;
  hint?: ReactNode;
}

export function TextField({
  label,
  error,
  hint,
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </label>
      <input id={id} {...props} className={join(fieldClass, error && 'border-bad')} aria-invalid={!!error} />
      {error ? (
        <p className="text-sm text-bad">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

export function SelectField({
  label,
  error,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </label>
      <select id={id} {...props} className={join(fieldClass, error && 'border-bad')}>
        {children}
      </select>
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={join('rounded-lg border border-line bg-surface', className)}>{children}</div>;
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded border border-bad/50 bg-bad/10 px-3 py-2 text-sm text-ink">
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-muted border-t-transparent" />
      {label}
    </div>
  );
}

const severityClass: Record<Severity, string> = {
  info: 'bg-info',
  success: 'bg-ok',
  warning: 'bg-warn',
  error: 'bg-bad',
  debug: 'bg-muted',
};

export function SeverityDot({ severity }: { severity?: Severity }) {
  return (
    <span
      title={severity ?? 'no severity'}
      className={join(
        'inline-block size-2.5 shrink-0 rounded-full',
        severity ? severityClass[severity] : 'bg-line',
      )}
    />
  );
}

const statusClass: Record<MessageStatus, string> = {
  received: 'bg-raised text-muted',
  normalized: 'bg-raised text-muted',
  queued: 'bg-warn/15 text-warn',
  delivered: 'bg-ok/15 text-ok',
  failed: 'bg-bad/15 text-bad',
  unrouted: 'bg-warn/15 text-warn',
  dropped: 'bg-raised text-muted',
  muted: 'bg-warn/15 text-warn',
};

export function StatusBadge({ status }: { status: MessageStatus }) {
  return (
    <span
      className={join('rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', statusClass[status])}
    >
      {status}
    </span>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
  hideLabel = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
  // Keeps the label for screen readers only.
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex cursor-pointer items-center gap-3 text-sm">
        <span className="relative inline-flex">
          <input
            id={id}
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="h-5 w-9 rounded-full bg-line transition-colors peer-checked:bg-ok peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-disabled:opacity-50" />
          <span className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
        </span>
        <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
      </label>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-ink">{children}</div>
  );
}

export function Badge({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'ok' | 'warn' | 'bad';
}) {
  return (
    <span
      className={join(
        'rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
        tone === 'muted' && 'bg-raised text-muted',
        tone === 'ok' && 'bg-ok/15 text-ok',
        tone === 'warn' && 'bg-warn/15 text-warn',
        tone === 'bad' && 'bg-bad/15 text-bad',
      )}
    >
      {children}
    </span>
  );
}

// A channel dropdown; emptyLabel adds a "none" choice with an empty value.
export function ChannelSelect({
  label,
  value,
  onChange,
  channels,
  emptyLabel,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  channels: { id: string; name: string }[];
  emptyLabel?: string;
  error?: string;
}) {
  const known = channels.some((channel) => channel.id === value);
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error}>
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {emptyLabel === undefined && !value && <option value="">Pick a channel</option>}
      {value && !known && <option value={value}>Unknown channel {value}</option>}
      {channels.map((channel) => (
        <option key={channel.id} value={channel.id}>
          #{channel.name}
        </option>
      ))}
    </SelectField>
  );
}

// Asks for a second click before acting; the request resets after a few seconds.
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = 'Click again to confirm',
  variant = 'secondary',
  disabled,
}: {
  onConfirm: () => void;
  children: ReactNode;
  confirmLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <Button
      variant={variant}
      disabled={disabled}
      className={armed ? 'ring-2 ring-bad' : undefined}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
}
