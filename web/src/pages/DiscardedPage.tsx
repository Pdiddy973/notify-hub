import type { DiscardedSettings, DiscardReason } from '@notify-hub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  ErrorBox,
  PageHeader,
  Spinner,
  TextField,
} from '../components/ui';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { formatFull, formatTime } from '../lib/format';
import { keys, useDiscarded, useDiscardedSettings } from '../lib/queries';

const PAGE_SIZE = 50;
const reasons: DiscardReason[] = [
  'wrong token',
  'missing token',
  'expired token',
  'unknown source',
  'disabled source',
];
const selectClass =
  'rounded border border-line bg-page px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none';

interface Filters {
  source: string;
  address: string;
  reason: DiscardReason | '';
}

function SettingsCard() {
  const queryClient = useQueryClient();
  const settings = useDiscardedSettings();
  const [draft, setDraft] = useState<Record<keyof DiscardedSettings, string>>();
  useEffect(() => {
    if (settings.data && !draft) {
      setDraft({
        retentionDays: String(settings.data.retentionDays),
        maxRows: String(settings.data.maxRows),
        blockThreshold: String(settings.data.blockThreshold),
        blockMinutes: String(settings.data.blockMinutes),
        spikeThreshold: String(settings.data.spikeThreshold),
        exemptRanges: settings.data.exemptRanges.join('\n'),
      });
    }
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: (body: DiscardedSettings) =>
      api<DiscardedSettings>('/discarded/settings', { method: 'PUT', body }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.discardedSettings, data);
      void queryClient.invalidateQueries({ queryKey: keys.discarded });
    },
  });

  if (!draft) return <Spinner />;
  const fields = save.error instanceof ApiRequestError ? save.error.fieldErrors() : {};
  const rangeError = Object.entries(fields).find(([path]) => path.startsWith('exemptRanges'))?.[1];
  const set = (key: keyof DiscardedSettings) => (e: { target: { value: string } }) =>
    setDraft((d) => d && { ...d, [key]: e.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      retentionDays: Number(draft.retentionDays),
      maxRows: Number(draft.maxRows),
      blockThreshold: Number(draft.blockThreshold),
      blockMinutes: Number(draft.blockMinutes),
      spikeThreshold: Number(draft.spikeThreshold),
      exemptRanges: draft.exemptRanges
        .split(/[\s,]+/)
        .map((range) => range.trim())
        .filter(Boolean),
    });
  };

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="font-semibold text-white">Settings</h2>
        {save.error && !Object.keys(fields).length && <ErrorBox>{save.error.message}</ErrorBox>}
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Keep for (days)"
            type="number"
            value={draft.retentionDays}
            onChange={set('retentionDays')}
            error={fields.retentionDays}
          />
          <TextField
            label="Most rows kept"
            type="number"
            value={draft.maxRows}
            onChange={set('maxRows')}
            error={fields.maxRows}
          />
          <TextField
            label="Block after (bad requests)"
            type="number"
            value={draft.blockThreshold}
            onChange={set('blockThreshold')}
            error={fields.blockThreshold}
            hint="From one address within 10 minutes."
          />
          <TextField
            label="Block for (minutes)"
            type="number"
            value={draft.blockMinutes}
            onChange={set('blockMinutes')}
            error={fields.blockMinutes}
          />
          <div className="sm:col-span-2">
            <TextField
              label="Spike alert at (discards)"
              type="number"
              value={draft.spikeThreshold}
              onChange={set('spikeThreshold')}
              error={fields.spikeThreshold}
              hint={
                <>
                  Within 10 minutes, posted to the alert channel set in{' '}
                  <Link to="/settings" className="text-accent hover:underline">
                    Settings
                  </Link>
                  ; 0 turns it off.
                </>
              }
            />
          </div>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="exempt-ranges"
            className="block text-xs font-semibold tracking-wide text-muted uppercase"
          >
            Never block
          </label>
          <textarea
            id="exempt-ranges"
            rows={3}
            value={draft.exemptRanges}
            onChange={set('exemptRanges')}
            placeholder={'192.168.1.0/24\n10.0.0.5'}
            className={`w-full rounded border bg-page px-3 py-2 font-mono text-xs text-ink focus:border-accent focus:outline-none ${
              rangeError ? 'border-bad' : 'border-line'
            }`}
          />
          {rangeError ? (
            <p className="text-sm text-bad">{rangeError}</p>
          ) : (
            <p className="text-xs text-muted">
              One address or range per line. A block stops every webhook from that address, so list hosts that
              run several services. Requests from these are still logged.
            </p>
          )}
        </div>
        <Button type="submit" disabled={save.isPending}>
          {save.isSuccess && !save.isPending ? 'Saved' : 'Save settings'}
        </Button>
      </form>
    </Card>
  );
}

export function DiscardedPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>({ source: '', address: '', reason: '' });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(filters);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters]);

  const page = useDiscarded({
    ...(applied.source.trim() ? { source: applied.source.trim() } : {}),
    ...(applied.address.trim() ? { address: applied.address.trim() } : {}),
    ...(applied.reason ? { reason: applied.reason } : {}),
    offset,
    limit: PAGE_SIZE,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.discarded });
    void queryClient.invalidateQueries({ queryKey: keys.dashboard });
  };
  const clear = useMutation({
    mutationFn: () => api<{ removed: number }>('/discarded', { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const unblock = useMutation({
    mutationFn: (address: string) => api('/discarded/unblock', { method: 'POST', body: { address } }),
    onSuccess: refresh,
  });

  const set = (key: keyof Filters) => (e: { target: { value: string } }) =>
    setFilters((f) => ({ ...f, [key]: e.target.value }));
  const data = page.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Discarded requests">
        <ConfirmButton onConfirm={() => clear.mutate()} disabled={clear.isPending || !data?.total}>
          Clear the log
        </ConfirmButton>
      </PageHeader>
      <p className="text-sm text-muted">
        Webhooks rejected for a wrong, missing, or expired token, an unknown source, or a source that is off.
        Bodies are never stored, and only the first 4 characters and the length of a token are kept.
      </p>
      {(clear.error ?? unblock.error) && <ErrorBox>{errorMessage(clear.error ?? unblock.error)}</ErrorBox>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {data && data.blocked.length > 0 && (
            <Card className="space-y-2 p-3">
              <h2 className="text-sm font-semibold text-white">Blocked now</h2>
              <ul className="space-y-1 text-sm">
                {data.blocked.map((entry) => (
                  <li key={entry.address} className="flex flex-wrap items-center gap-2">
                    <code>{entry.address}</code>
                    <span className="text-xs text-muted">until {formatTime(entry.until)}</span>
                    <Button
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => unblock.mutate(entry.address)}
                      disabled={unblock.isPending}
                    >
                      Unblock
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              aria-label="Source tried"
              placeholder="Source tried"
              className={`${selectClass} min-w-40 flex-1`}
              value={filters.source}
              onChange={set('source')}
            />
            <input
              type="search"
              aria-label="Address"
              placeholder="Address"
              className={`${selectClass} min-w-40 flex-1`}
              value={filters.address}
              onChange={set('address')}
            />
            <select
              aria-label="Reason"
              className={selectClass}
              value={filters.reason}
              onChange={set('reason')}
            >
              <option value="">Any reason</option>
              {reasons.map((reason) => (
                <option key={reason}>{reason}</option>
              ))}
            </select>
          </div>

          <Card className="min-w-0 overflow-x-auto">
            {page.isPending && (
              <div className="p-4">
                <Spinner />
              </div>
            )}
            {page.isError && (
              <div className="p-4">
                <ErrorBox>{errorMessage(page.error)}</ErrorBox>
              </div>
            )}
            {data && data.entries.length === 0 && (
              <p className="p-6 text-center text-sm text-muted">Nothing discarded.</p>
            )}
            {data && data.entries.length > 0 && (
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-normal">Last seen</th>
                    <th className="px-3 py-2 font-normal">Source tried</th>
                    <th className="px-3 py-2 font-normal">Reason</th>
                    <th className="px-3 py-2 font-normal">From</th>
                    <th className="px-3 py-2 text-right font-normal">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-line align-top">
                      <td
                        className="px-3 py-2 whitespace-nowrap text-muted"
                        title={`First seen ${formatFull(entry.firstSeen)}`}
                      >
                        {formatTime(entry.lastSeen)}
                      </td>
                      <td className="max-w-48 px-3 py-2">
                        {entry.sourceExists ? (
                          <Link
                            to={`/sources?s=${encodeURIComponent(entry.sourceTried)}`}
                            className="break-all text-accent hover:underline"
                          >
                            {entry.sourceTried}
                          </Link>
                        ) : (
                          <span className="break-all">{entry.sourceTried}</span>
                        )}
                        {entry.tokenHint && (
                          <div
                            className="text-xs text-muted"
                            title="First 4 characters and length of the token sent"
                          >
                            token {entry.tokenHint}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={entry.reason === 'expired token' ? 'warn' : 'bad'}>{entry.reason}</Badge>
                      </td>
                      <td className="max-w-56 px-3 py-2">
                        <code className="text-xs">{entry.clientAddress}</code>
                        <div className="truncate text-xs text-muted" title={entry.userAgent}>
                          {entry.method} · {entry.userAgent ?? 'no user agent'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{entry.repeatCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          {data && data.total > PAGE_SIZE && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Button
                variant="secondary"
                onClick={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
                disabled={offset === 0}
              >
                Newer
              </Button>
              <Button
                variant="secondary"
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= data.total}
              >
                Older
              </Button>
              <span>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
              </span>
            </div>
          )}
        </div>
        <SettingsCard />
      </div>
    </div>
  );
}
