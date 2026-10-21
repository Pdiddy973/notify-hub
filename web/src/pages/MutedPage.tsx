import type { MuteScope } from '@notify-hub/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { describeUntil, muteDurations, useMuteActions } from '../components/MuteControl';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  PageHeader,
  SelectField,
  Spinner,
  TextField,
  Toggle,
} from '../components/ui';
import { ApiRequestError, errorMessage } from '../lib/api';
import { formatTime } from '../lib/format';
import { useMutes, useRoutes, useSources } from '../lib/queries';

const scopeLabels: Record<MuteScope, string> = { source: 'Source', route: 'Rule', event: 'Event' };

function AddMuteForm() {
  const sources = useSources();
  const routes = useRoutes();
  const { create } = useMuteActions();
  const [scope, setScope] = useState<MuteScope>('event');
  const [target, setTarget] = useState('');
  const [duration, setDuration] = useState(0);
  const [customHours, setCustomHours] = useState('2');
  const custom = duration === muteDurations.length;
  const [reason, setReason] = useState('');
  const [keepErrors, setKeepErrors] = useState(false);
  const fields = create.error instanceof ApiRequestError ? create.error.fieldErrors() : {};

  const targets =
    scope === 'source'
      ? (sources.data ?? []).map((source) => ({ id: source.id, name: source.name }))
      : scope === 'route'
        ? (routes.data ?? [])
            .filter((rule) => rule.action === 'send')
            .map((rule) => ({ id: String(rule.id), name: rule.name || `Rule ${rule.id}` }))
        : [];
  const chosen = scope === 'event' ? target : target || targets[0]?.id || '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        scope,
        target: chosen.trim(),
        minutes: custom ? Math.round(Number(customHours) * 60) : muteDurations[duration]!.minutes,
        reason,
        keepErrors,
      },
      {
        onSuccess: () => {
          setTarget('');
          setReason('');
        },
      },
    );
  };

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <h2 className="font-semibold text-white sm:col-span-2">Add a mute</h2>
        {create.error && !Object.keys(fields).length && (
          <div className="sm:col-span-2">
            <ErrorBox>{create.error.message}</ErrorBox>
          </div>
        )}
        <SelectField
          label="Mute"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as MuteScope);
            setTarget('');
          }}
        >
          <option value="event">An event, from every source</option>
          <option value="source">A source</option>
          <option value="route">A routing rule</option>
        </SelectField>
        {scope === 'event' ? (
          <TextField
            label="Event name"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="grab"
            error={fields.target}
            hint="Matched without case, as in the log's Event column."
          />
        ) : (
          <SelectField
            label={scope === 'source' ? 'Source' : 'Rule'}
            value={chosen}
            onChange={(e) => setTarget(e.target.value)}
            error={fields.target}
          >
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </SelectField>
        )}
        <div className="space-y-3">
          <SelectField label="For" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {muteDurations.map((item, index) => (
              <option key={item.label} value={index}>
                {item.label}
              </option>
            ))}
            <option value={muteDurations.length}>Custom</option>
          </SelectField>
          {custom && (
            <TextField
              label="Hours"
              type="number"
              min="0.1"
              step="0.5"
              value={customHours}
              onChange={(e) => setCustomHours(e.target.value)}
              error={fields.minutes}
            />
          )}
        </div>
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Upgrading the NAS"
          error={fields.reason}
        />
        <div className="sm:col-span-2">
          <Toggle
            label="Still send errors"
            checked={keepErrors}
            onChange={setKeepErrors}
            hint="Messages with severity error are posted even while muted."
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending || !chosen.trim()}>
            Mute
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function MutedPage() {
  const mutes = useMutes();
  const { remove } = useMuteActions();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Muted" />
      <p className="text-sm text-muted">
        Muted messages are still received and kept in the{' '}
        <Link to="/log?status=muted" className="text-accent hover:underline">
          log
        </Link>{' '}
        with status muted; they are just not posted to Discord. Mutes end on their own.
      </p>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <Card className="min-w-0 overflow-x-auto">
          {mutes.isPending && (
            <div className="p-4">
              <Spinner />
            </div>
          )}
          {mutes.isError && (
            <div className="p-4">
              <ErrorBox>{errorMessage(mutes.error)}</ErrorBox>
            </div>
          )}
          {remove.error && (
            <div className="p-3">
              <ErrorBox>{errorMessage(remove.error)}</ErrorBox>
            </div>
          )}
          {mutes.data?.length === 0 && (
            <p className="p-6 text-center text-sm text-muted">Nothing is muted.</p>
          )}
          {mutes.data && mutes.data.length > 0 && (
            <ul>
              {mutes.data.map((mute) => (
                <li
                  key={mute.id}
                  className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2.5 text-sm"
                >
                  <Badge>{scopeLabels[mute.scope]}</Badge>
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="block truncate text-white">{mute.targetName ?? mute.target}</span>
                    <span className="block truncate text-xs text-muted">
                      Muted {describeUntil(mute)} · since {formatTime(mute.createdAt)}
                      {mute.keepErrors && ' · errors still sent'}
                      {mute.reason && ` · ${mute.reason}`}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => remove.mutate(mute.id)}
                    disabled={remove.isPending}
                  >
                    Unmute
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <AddMuteForm />
      </div>
    </div>
  );
}
