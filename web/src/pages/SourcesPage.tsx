import type { CreateSourceRequest, SourceDetail, SourceSummary, SourceUrl } from '@notify-hub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MuteControl } from '../components/MuteControl';
import {
  Badge,
  Notice,
  Button,
  Card,
  ConfirmButton,
  ErrorBox,
  PageHeader,
  SelectField,
  Spinner,
  TextField,
  Toggle,
} from '../components/ui';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { formatFull, formatTime, slugify } from '../lib/format';
import { keys, useAdapters, useHookBase, useMutes, useSource, useSources } from '../lib/queries';

const fieldErrors = (error: unknown) => (error instanceof ApiRequestError ? error.fieldErrors() : {});

function useInvalidateSources() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: keys.sources });
    void queryClient.invalidateQueries({ queryKey: keys.dashboard });
    if (id) void queryClient.invalidateQueries({ queryKey: keys.source(id) });
  };
}

function AddSourceForm({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const adapters = useAdapters();
  const invalidate = useInvalidateSources();
  const [type, setType] = useState('');
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idEdited, setIdEdited] = useState(false);
  // Built-in adapters that a file overrides are not offered.
  const types = adapters.data?.adapters.filter((adapter) => adapter.active) ?? [];
  const chosenType = type || types[0]?.id || '';
  const chosen = types.find((adapter) => adapter.id === chosenType);

  const create = useMutation({
    mutationFn: (body: CreateSourceRequest) => api<SourceDetail>('/sources', { method: 'POST', body }),
    onSuccess: (source) => {
      invalidate(source.id);
      onCreated(source.id);
    },
  });
  const fields = fieldErrors(create.error);
  const sourceId = idEdited ? id : slugify(name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ id: sourceId, name, type: chosenType });
  };

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
        <h2 className="font-semibold text-white md:col-span-3">Add a source</h2>
        {create.error && !Object.keys(fields).length && (
          <div className="md:col-span-3">
            <ErrorBox>{create.error.message}</ErrorBox>
          </div>
        )}
        <SelectField
          label="Type"
          value={chosenType}
          onChange={(e) => setType(e.target.value)}
          error={fields.type}
        >
          {types.map((adapter) => (
            <option key={adapter.id} value={adapter.id}>
              {adapter.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sonarr 4K"
          error={fields.name}
          autoFocus
        />
        <TextField
          label="Id"
          value={sourceId}
          onChange={(e) => {
            setIdEdited(true);
            setId(e.target.value);
          }}
          error={fields.id}
          hint="Part of the webhook URL; it cannot be changed later."
          spellCheck={false}
        />
        {chosen?.help && (
          <p className="text-xs whitespace-pre-wrap text-muted md:col-span-3">{chosen.help}</p>
        )}
        <div className="flex gap-2 md:col-span-3">
          <Button type="submit" disabled={create.isPending || !name || !sourceId || !chosenType}>
            {create.isPending ? 'Adding…' : 'Add source'}
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <p className="text-xs text-muted md:col-span-3">
          The hub creates a random token for the source; you copy the full webhook URL on the next step.
        </p>
      </form>
    </Card>
  );
}

function SourceList({
  sources,
  selected,
  onSelect,
}: {
  sources: SourceSummary[];
  selected?: string;
  onSelect: (id: string) => void;
}) {
  const invalidate = useInvalidateSources();
  const mutes = useMutes();
  const mutedIds = new Set(
    (mutes.data ?? []).filter((mute) => mute.scope === 'source').map((mute) => mute.target),
  );
  const setEnabled = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api<SourceDetail>(`/sources/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled } }),
    onSettled: (_data, _error, { id }) => invalidate(id),
  });
  if (sources.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted">No sources yet. Add one to get a webhook URL.</p>
    );
  }
  return (
    <ul>
      {setEnabled.error && (
        <li className="p-3">
          <ErrorBox>{errorMessage(setEnabled.error)}</ErrorBox>
        </li>
      )}
      {sources.map((source) => (
        <li
          key={source.id}
          className={`flex items-center gap-2 border-b border-line pr-3 ${
            source.id === selected ? 'bg-raised' : 'hover:bg-raised'
          }`}
        >
          <button
            onClick={() => onSelect(source.id)}
            aria-current={source.id === selected}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-sm"
          >
            <span className={`size-2 shrink-0 rounded-full ${source.enabled ? 'bg-ok' : 'bg-line'}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-white">{source.name}</span>
              <span className="block truncate text-xs text-muted">
                {source.id} · {source.type}
              </span>
            </span>
            {!source.enabled && <Badge>off</Badge>}
            {mutedIds.has(source.id) && <Badge tone="warn">muted</Badge>}
            {source.previousTokenValidUntil && <Badge tone="warn">rotating</Badge>}
          </button>
          <Toggle
            label={`Accept webhooks for ${source.name}`}
            hideLabel
            checked={source.enabled}
            disabled={setEnabled.isPending}
            onChange={(enabled) => setEnabled.mutate({ id: source.id, enabled })}
          />
        </li>
      ))}
    </ul>
  );
}

// The full webhook URL is fetched only when asked for, and kept only in this component.
function WebhookUrl({ source }: { source: SourceDetail }) {
  const { base, fromSettings, ready } = useHookBase();
  const [url, setUrl] = useState<string>();
  const [copied, setCopied] = useState(false);
  const reveal = useMutation({
    // Keeps the token-bearing response out of the mutation cache.
    gcTime: 0,
    mutationFn: () => api<SourceUrl>(`/sources/${encodeURIComponent(source.id)}/url`, { method: 'POST' }),
    onSuccess: ({ hookPath }) => setUrl(`${base}${hookPath}`),
  });
  const copy = useMutation({
    // Keeps the token-bearing response out of the mutation cache.
    gcTime: 0,
    mutationFn: async () => {
      const { hookPath } = await api<SourceUrl>(`/sources/${encodeURIComponent(source.id)}/url`, {
        method: 'POST',
      });
      const full = `${base}${hookPath}`;
      if (!(await copyText(full))) {
        setUrl(full);
        throw new Error('Copying is blocked here; select the URL below and copy it by hand');
      }
    },
    onSuccess: () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
  });
  const masked = `${base}/hook/${source.id}/••••••••`;
  const local = !fromSettings && /^(localhost|127\.|\[::1\])/.test(window.location.hostname);

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-wide text-muted uppercase">Webhook URL</div>
      {local && (
        <Notice>
          This URL uses this computer's own address, which other machines cannot reach. Set the hub's LAN
          address under{' '}
          <Link to="/settings" className="text-accent hover:underline">
            Settings, Webhook address
          </Link>
          .
        </Notice>
      )}
      <input
        readOnly
        aria-label="Webhook URL"
        value={url ?? masked}
        onFocus={(e) => e.target.select()}
        className="w-full rounded border border-line bg-page px-3 py-2 font-mono text-xs text-ink"
      />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => copy.mutate()} disabled={copy.isPending || !ready}>
          {copied ? 'Copied' : 'Copy URL'}
        </Button>
        {url ? (
          <Button variant="secondary" onClick={() => setUrl(undefined)}>
            Hide
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => reveal.mutate()} disabled={reveal.isPending || !ready}>
            Show
          </Button>
        )}
      </div>
      {(copy.error || reveal.error) && <ErrorBox>{errorMessage(copy.error ?? reveal.error)}</ErrorBox>}
      <p className="text-xs text-muted">
        Services that cannot use a long URL can post to{' '}
        <code>
          {base}/hook/{source.id}
        </code>{' '}
        with the token in an <code>X-Hub-Token</code> header instead.
      </p>
      {url && source.type === 'standard' && (
        <pre className="overflow-x-auto rounded bg-page p-2 text-xs whitespace-pre-wrap text-muted">
          {`curl -X POST -H "Content-Type: application/json" \\\n  -d '{"event":"test","severity":"info","title":"Hello"}' \\\n  ${url}`}
        </pre>
      )}
    </div>
  );
}

function SourcePanel({ id, onClose, onDeleted }: { id: string; onClose: () => void; onDeleted: () => void }) {
  const source = useSource(id);
  const invalidate = useInvalidateSources();
  const [name, setName] = useState<string>();

  const update = useMutation({
    mutationFn: (body: { name?: string; enabled?: boolean }) =>
      api<SourceDetail>(`/sources/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    onSuccess: () => {
      setName(undefined);
      invalidate(id);
    },
  });
  const rotate = useMutation({
    mutationFn: () =>
      api<SourceDetail>(`/sources/${encodeURIComponent(id)}/rotate-token`, { method: 'POST' }),
    onSuccess: () => invalidate(id),
  });
  const test = useMutation({
    mutationFn: () =>
      api<{ messageId: number }>(`/sources/${encodeURIComponent(id)}/test`, { method: 'POST' }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/sources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate();
      onDeleted();
    },
  });

  if (source.isPending) return <Spinner />;
  if (source.isError) return <ErrorBox>{errorMessage(source.error)}</ErrorBox>;
  const data = source.data;
  const editedName = name ?? data.name;
  const nameError = fieldErrors(update.error).name;
  const actionError =
    update.error && !nameError ? update.error : (rotate.error ?? test.error ?? remove.error);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-white">{data.name}</h2>
          <p className="text-xs text-muted">
            {data.id} · {data.adapterName ?? data.type} · added {formatFull(data.createdAt)}
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>

      {actionError && <ErrorBox>{errorMessage(actionError)}</ErrorBox>}
      {data.adapterProblem && (
        <Notice>
          {data.adapterProblem}{' '}
          <Link to="/adapters" className="text-accent hover:underline">
            Open Adapters
          </Link>
        </Notice>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          update.mutate({ name: editedName });
        }}
      >
        <div className="flex-1">
          <TextField
            label="Name"
            value={editedName}
            onChange={(e) => setName(e.target.value)}
            error={nameError}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={editedName === data.name || update.isPending}>
          Save
        </Button>
      </form>

      <div className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-muted uppercase">Status</div>
        <Toggle
          label="Accept webhooks"
          checked={data.enabled}
          disabled={update.isPending}
          onChange={(enabled) => update.mutate({ enabled })}
          hint={
            data.enabled
              ? 'On. Turn it off to pause this source: its webhooks are then discarded and logged, and nothing is deleted.'
              : 'Off. Webhooks for this source are discarded and logged as "disabled source" until you turn it back on.'
          }
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <MuteControl scope="source" target={data.id} />
        </div>
        <p className="text-xs text-muted">
          Muting keeps accepting and logging this source's messages, with status muted, but posts nothing to
          Discord until the mute ends. More options are on the{' '}
          <Link to="/muted" className="text-accent hover:underline">
            Muted
          </Link>{' '}
          page.
        </p>
      </div>

      <WebhookUrl key={data.previousTokenValidUntil ?? 'current'} source={data} />

      <div className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-muted uppercase">Token</div>
        {data.previousTokenValidUntil ? (
          <p className="text-sm text-warn">
            Rotated. The old token keeps working until {formatTime(data.previousTokenValidUntil)}; update the
            sender before then.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Rotating creates a new token. The old one keeps working for 10 minutes so you can update the
            sender.
          </p>
        )}
        <ConfirmButton onConfirm={() => rotate.mutate()} disabled={rotate.isPending}>
          Rotate token
        </ConfirmButton>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-muted uppercase">Test</div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => test.mutate()}
            disabled={test.isPending || !data.enabled}
          >
            Send a test message
          </Button>
          {test.data && (
            <Link to={`/log?m=${test.data.messageId}`} className="text-sm text-accent hover:underline">
              Sent; open it in the log
            </Link>
          )}
        </div>
        <p className="text-xs text-muted">
          Sends the adapter's sample through the same path as a real webhook.
        </p>
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold tracking-wide text-muted uppercase">Setup</div>
        <p className="text-sm whitespace-pre-wrap">
          {data.help ?? 'Paste the webhook URL into the service as a webhook or notification target.'}
        </p>
        <p className="text-xs text-muted">
          Messages go where the{' '}
          <Link to="/routing" className="text-accent hover:underline">
            routing rules
          </Link>{' '}
          send them.
        </p>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <ConfirmButton
          onConfirm={() => remove.mutate()}
          disabled={remove.isPending}
          confirmLabel="Delete for good"
        >
          Delete source
        </ConfirmButton>
        <p className="text-xs text-muted">
          Removes the source and the rules made only for it. Its messages stay in the log.
        </p>
      </div>
    </div>
  );
}

export function SourcesPage() {
  const sources = useSources();
  const [params, setParams] = useSearchParams();
  const selected = params.get('s') ?? undefined;
  const [adding, setAdding] = useState(false);
  const select = (id?: string) => setParams(id ? { s: id } : {}, { replace: true });

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <PageHeader title="Sources">
          {!adding && <Button onClick={() => setAdding(true)}>Add source</Button>}
        </PageHeader>
        {adding && (
          <AddSourceForm
            onCancel={() => setAdding(false)}
            onCreated={(id) => {
              setAdding(false);
              select(id);
            }}
          />
        )}
        <Card className="min-w-0 overflow-hidden">
          {sources.isPending && (
            <div className="p-4">
              <Spinner />
            </div>
          )}
          {sources.isError && (
            <div className="p-4">
              <ErrorBox>{errorMessage(sources.error)}</ErrorBox>
            </div>
          )}
          {sources.data && <SourceList sources={sources.data} selected={selected} onSelect={select} />}
        </Card>
      </div>

      {selected && (
        <aside className="fixed inset-0 z-20 overflow-y-auto bg-surface p-4 lg:static lg:inset-auto lg:z-auto lg:w-[45%] lg:shrink-0 lg:rounded-lg lg:border lg:border-line">
          <SourcePanel key={selected} id={selected} onClose={() => select()} onDeleted={() => select()} />
        </aside>
      )}
    </div>
  );
}
