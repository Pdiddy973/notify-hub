import type { MessagePage, MessageSummary } from '@notify-hub/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { MessageDetail } from '../components/MessageDetail';
import { Button, ErrorBox, SeverityDot, Spinner, StatusBadge } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { filtersFromParams, mergeRow, messagesQuery, type LogFilters, type LogPages } from '../lib/filters';
import { formatTime } from '../lib/format';
import { keys, useSources } from '../lib/queries';
import { useMessageStream, type StreamState } from '../lib/stream';

const statuses = ['received', 'normalized', 'queued', 'delivered', 'failed', 'unrouted', 'dropped', 'muted'];
const severities = ['info', 'success', 'warning', 'error', 'debug'];
const TEST_SOURCE_ID = 'test';

const selectClass =
  'rounded border border-line bg-page px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none';

function StreamIndicator({ state }: { state: StreamState }) {
  const live = state === 'live';
  return (
    <span className="flex items-center gap-2 text-xs text-muted" role="status">
      <span className={`size-2 rounded-full ${live ? 'animate-pulse bg-ok' : 'bg-warn'}`} />
      {live ? 'Live' : state === 'connecting' ? 'Connecting' : 'Reconnecting'}
    </span>
  );
}

function Filters({ filters, onChange }: { filters: LogFilters; onChange: (next: LogFilters) => void }) {
  const sources = useSources();
  const [search, setSearch] = useState(filters.q ?? '');

  useEffect(() => {
    const timer = setTimeout(() => {
      if ((filters.q ?? '') !== search.trim()) onChange({ ...filters, q: search.trim() || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [search, filters, onChange]);

  const set = (key: keyof LogFilters) => (event: { target: { value: string } }) =>
    onChange({ ...filters, [key]: event.target.value || undefined });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Source"
        className={selectClass}
        value={filters.source ?? ''}
        onChange={set('source')}
      >
        <option value="">All sources</option>
        {sources.data?.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
        <option value="hub">Notify Hub (alerts)</option>
      </select>
      <select
        aria-label="Status"
        className={selectClass}
        value={filters.status ?? ''}
        onChange={set('status')}
      >
        <option value="">Any status</option>
        {statuses.map((status) => (
          <option key={status}>{status}</option>
        ))}
      </select>
      <select
        aria-label="Severity"
        className={selectClass}
        value={filters.severity ?? ''}
        onChange={set('severity')}
      >
        <option value="">Any severity</option>
        {severities.map((severity) => (
          <option key={severity}>{severity}</option>
        ))}
      </select>
      <input
        type="search"
        aria-label="Search"
        placeholder="Search titles and payloads"
        className={`${selectClass} min-w-48 flex-1`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </div>
  );
}

function Row({
  row,
  selected,
  fresh,
  onSelect,
}: {
  row: MessageSummary;
  selected: boolean;
  fresh: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        aria-current={selected}
        className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 text-left text-sm md:grid-cols-[6rem_9rem_minmax(0,1fr)_10rem_6rem] ${
          selected ? 'bg-raised' : row.hasError ? 'bg-bad/5 hover:bg-raised' : 'hover:bg-raised'
        } ${fresh ? 'row-new' : ''}`}
      >
        <span className="text-xs text-muted tabular-nums md:text-sm">{formatTime(row.receivedAt)}</span>
        <span className="truncate text-xs text-muted md:text-sm md:text-ink">{row.sourceName}</span>
        <span className="col-span-3 flex min-w-0 items-center gap-2 md:col-span-1">
          <SeverityDot severity={row.severity} />
          <span className="truncate text-white">
            {row.title ?? <span className="text-muted">(no title)</span>}
          </span>
          {row.event && <span className="hidden shrink-0 text-xs text-muted lg:inline">{row.event}</span>}
        </span>
        <span className="hidden truncate text-muted md:inline">
          {row.destinations.map((d) => `#${d}`).join(', ') || '—'}
          {row.fallback && <span className="ml-1 text-xs text-warn">fallback</span>}
        </span>
        <span className="col-start-3 row-start-1 justify-self-end md:col-start-auto md:row-start-auto">
          <StatusBadge status={row.status} />
        </span>
      </button>
    </li>
  );
}

export function LogPage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const selected = Number(params.get('m')) || undefined;
  const queryClient = useQueryClient();
  const queryKey = [...keys.messages, filters] as const;
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const sources = useSources();
  const hasTestSource = sources.data?.some((source) => source.id === TEST_SOURCE_ID) ?? false;

  const log = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api<MessagePage>(`/messages${messagesQuery(filters, pageParam)}`),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore,
  });

  const stream = useMessageStream((row) => {
    const before = queryClient.getQueryData<LogPages>(queryKey);
    const known =
      before?.pages.some((page) => page.messages.some((message) => message.id === row.id)) ?? false;
    queryClient.setQueryData<LogPages>(queryKey, (data) => mergeRow(data, row, filters));
    if (!known) {
      setFresh((ids) => new Set(ids).add(row.id));
      setTimeout(() => setFresh((ids) => new Set([...ids].filter((id) => id !== row.id))), 3500);
    }
    if (row.id === selected) void queryClient.invalidateQueries({ queryKey: keys.message(row.id) });
  });

  const sendTest = useMutation({
    mutationFn: () => api(`/sources/${TEST_SOURCE_ID}/test`, { method: 'POST' }),
  });

  const update = (next: { filters?: LogFilters; message?: number | null }) => {
    const nextParams = new URLSearchParams();
    const nextFilters = next.filters ?? filters;
    for (const [key, value] of Object.entries(nextFilters)) if (value) nextParams.set(key, value);
    const message = next.message === undefined ? selected : next.message;
    if (message) nextParams.set('m', String(message));
    setParams(nextParams, { replace: next.filters !== undefined });
  };

  const rows = log.data?.pages.flatMap((page) => page.messages) ?? [];

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-semibold text-white">Live log</h1>
          <StreamIndicator state={stream} />
          {hasTestSource && (
            <Button
              variant="secondary"
              className="ml-auto"
              onClick={() => sendTest.mutate()}
              disabled={sendTest.isPending}
            >
              Send test message
            </Button>
          )}
        </div>
        {sendTest.error && <ErrorBox>{errorMessage(sendTest.error)}</ErrorBox>}
        <Filters filters={filters} onChange={(next) => update({ filters: next })} />

        <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-surface">
          <div className="hidden grid-cols-[6rem_9rem_minmax(0,1fr)_10rem_6rem] gap-x-3 border-b border-line px-3 py-2 text-xs text-muted md:grid">
            <span>Time</span>
            <span>Source</span>
            <span>Message</span>
            <span>Sent to</span>
            <span className="justify-self-end">Status</span>
          </div>
          {log.isPending && (
            <div className="p-4">
              <Spinner />
            </div>
          )}
          {log.isError && (
            <div className="p-4">
              <ErrorBox>{errorMessage(log.error)}</ErrorBox>
            </div>
          )}
          {log.isSuccess && rows.length === 0 && (
            <p className="p-6 text-center text-sm text-muted">
              {Object.keys(filters).length
                ? 'No messages match these filters.'
                : 'No messages yet. They appear here the moment a service sends one.'}
            </p>
          )}
          <ul>
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                selected={row.id === selected}
                fresh={fresh.has(row.id)}
                onSelect={() => update({ message: row.id })}
              />
            ))}
          </ul>
          {log.hasNextPage && (
            <div className="p-3 text-center">
              <Button
                variant="secondary"
                onClick={() => log.fetchNextPage()}
                disabled={log.isFetchingNextPage}
              >
                {log.isFetchingNextPage ? 'Loading…' : 'Load older messages'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <aside className="fixed inset-0 z-20 bg-surface lg:static lg:inset-auto lg:z-auto lg:w-[45%] lg:shrink-0 lg:rounded-lg lg:border lg:border-line">
          <div className="h-full lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)]">
            <MessageDetail key={selected} id={selected} onClose={() => update({ message: null })} />
          </div>
        </aside>
      )}
    </div>
  );
}
