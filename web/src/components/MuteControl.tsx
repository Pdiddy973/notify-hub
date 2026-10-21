import type { CreateMuteRequest, MuteInfo, MuteScope } from '@notify-hub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../lib/api';
import { formatTime } from '../lib/format';
import { keys, useMutes } from '../lib/queries';
import { Button } from './ui';

export const muteDurations: { label: string; minutes: number | null }[] = [
  { label: '1 hour', minutes: 60 },
  { label: '8 hours', minutes: 8 * 60 },
  { label: '24 hours', minutes: 24 * 60 },
  { label: '1 week', minutes: 7 * 24 * 60 },
  { label: 'Until unmuted', minutes: null },
];

export const describeUntil = (mute: Pick<MuteInfo, 'until'>) =>
  mute.until ? `until ${formatTime(mute.until)}` : 'until unmuted';

export function useMuteActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.mutes });
    void queryClient.invalidateQueries({ queryKey: keys.dashboard });
  };
  const create = useMutation({
    mutationFn: (body: CreateMuteRequest) => api<MuteInfo>('/mutes', { method: 'POST', body }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/mutes/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return { create, remove };
}

// Shows the active mute of a source or rule with Unmute, or a menu to mute it.
export function MuteControl({
  scope,
  target,
  compact = false,
}: {
  scope: MuteScope;
  target: string;
  compact?: boolean;
}) {
  const mutes = useMutes();
  const { create, remove } = useMuteActions();
  const active = mutes.data?.find((mute) => mute.scope === scope && mute.target === target);
  const error = create.error ?? remove.error;
  const selectClass =
    'rounded border border-line bg-page px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none';

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {active ? (
        <>
          <span className="text-xs text-warn">
            Muted {describeUntil(active)}
            {active.keepErrors && ', errors still sent'}
          </span>
          <Button
            variant={compact ? 'ghost' : 'secondary'}
            onClick={() => remove.mutate(active.id)}
            disabled={remove.isPending}
          >
            Unmute
          </Button>
        </>
      ) : (
        <select
          aria-label="Mute"
          className={selectClass}
          value=""
          disabled={create.isPending || mutes.isPending}
          onChange={(e) => {
            const choice = muteDurations[Number(e.target.value)];
            if (choice) create.mutate({ scope, target, minutes: choice.minutes });
          }}
        >
          <option value="">Mute…</option>
          {muteDurations.map((duration, index) => (
            <option key={duration.label} value={index}>
              {duration.label}
            </option>
          ))}
        </select>
      )}
      {error && <span className="text-xs text-bad">{errorMessage(error)}</span>}
    </span>
  );
}
