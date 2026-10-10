import type { MessageStatus, Severity } from '@notify-hub/shared';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';

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
