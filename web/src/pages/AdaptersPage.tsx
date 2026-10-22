import type { AdapterInfo, AdapterStatus, SampleRun } from '@notify-hub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EmbedPreview } from '../components/EmbedPreview';
import { Badge, Button, Card, ConfirmButton, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatTime } from '../lib/format';
import { keys, useAdapters } from '../lib/queries';

const statusBadges: Record<AdapterStatus, { label: string; tone: 'ok' | 'warn' | 'bad' }> = {
  ok: { label: 'Loaded', tone: 'ok' },
  'samples-failing': { label: 'Samples failing', tone: 'warn' },
  error: { label: 'Error', tone: 'bad' },
};

function Problem({ children }: { children: string }) {
  return <pre className="overflow-x-auto text-xs leading-relaxed whitespace-pre-wrap">{children}</pre>;
}

function SampleResults({ runs }: { runs: SampleRun[] }) {
  return (
    <div className="space-y-4">
      {runs.map((run) => (
        <div key={run.name} className="space-y-2">
          <div className="text-xs text-muted">Sample "{run.name}"</div>
          {run.error ? (
            <ErrorBox>
              <Problem>{run.error}</Problem>
            </ErrorBox>
          ) : run.embeds?.length ? (
            run.embeds.map((embed, index) => <EmbedPreview key={index} embed={embed} />)
          ) : (
            <p className="text-sm text-muted">Ignored: the adapter returned no messages for this sample.</p>
          )}
        </div>
      ))}
    </div>
  );
}

function Permissions({ adapter }: { adapter: AdapterInfo }) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (approved: string[]) =>
      api<AdapterInfo>(`/adapters/${encodeURIComponent(adapter.id)}/permissions`, {
        method: 'PUT',
        body: { approved },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.adapters }),
  });
  const { requested, approved } = adapter.permissions;
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold tracking-wide text-muted uppercase">Network access</div>
      {requested.map((permission) => {
        const host = permission.slice('fetch:'.length);
        const isApproved = approved.includes(permission);
        return (
          <div key={permission} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 break-all">
              fetch from <code className="text-white">{host}</code>
            </span>
            <Badge tone={isApproved ? 'ok' : 'warn'}>{isApproved ? 'Approved' : 'Not approved'}</Badge>
            {isApproved ? (
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                disabled={save.isPending}
                onClick={() => save.mutate(approved.filter((item) => item !== permission))}
              >
                Revoke
              </Button>
            ) : (
              <ConfirmButton
                variant="secondary"
                confirmLabel={`Allow requests to ${host}?`}
                disabled={save.isPending}
                onConfirm={() => save.mutate([...approved, permission])}
              >
                Approve
              </ConfirmButton>
            )}
          </div>
        );
      })}
      {save.error && <p className="text-xs text-bad">{errorMessage(save.error)}</p>}
      <p className="text-xs text-muted">
        Without approval the adapter runs without fetch. Approve only hosts you expect this adapter to call.
      </p>
    </div>
  );
}

function AdapterCard({ adapter }: { adapter: AdapterInfo }) {
  const run = useMutation({
    mutationFn: () =>
      api<SampleRun[]>(`/adapters/${encodeURIComponent(adapter.id)}/run-samples`, { method: 'POST' }),
  });
  const badge = statusBadges[adapter.status];
  return (
    <Card className="min-w-0 space-y-4 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-white">{adapter.name}</h2>
          <p className="text-xs break-all text-muted">
            {adapter.id} · {adapter.file}
            {adapter.version !== undefined && ` · version ${adapter.version}`} · loaded{' '}
            {formatTime(adapter.loadedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge>{adapter.origin === 'built-in' ? 'Built-in' : 'File'}</Badge>
          {!adapter.active && <Badge tone="warn">Overridden by a file</Badge>}
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </div>
      </div>

      {adapter.error && (
        <ErrorBox>
          {adapter.status === 'error' && (
            <div className="mb-1 font-semibold">
              The file has a problem; the last working version keeps running.
            </div>
          )}
          <Problem>{adapter.error}</Problem>
        </ErrorBox>
      )}

      {adapter.permissions.requested.length > 0 && <Permissions adapter={adapter} />}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? 'Running…' : 'Run samples'}
          </Button>
          <span className="text-xs text-muted">
            {adapter.samples.length} sample{adapter.samples.length === 1 ? '' : 's'}:{' '}
            {adapter.samples.join(', ')}
          </span>
        </div>
        {run.error && <ErrorBox>{errorMessage(run.error)}</ErrorBox>}
        {run.data && <SampleResults runs={run.data} />}
      </div>
    </Card>
  );
}

export function AdaptersPage() {
  const adapters = useAdapters({ live: true });
  return (
    <div className="space-y-4">
      <PageHeader title="Adapters" />
      {adapters.isPending && <Spinner />}
      {adapters.isError && <ErrorBox>{errorMessage(adapters.error)}</ErrorBox>}
      {adapters.data && (
        <>
          <p className="text-sm text-muted">
            {adapters.data.folder ? (
              <>
                Your adapter files live in <code className="break-all text-ink">{adapters.data.folder}</code>.
                Copy <code className="text-ink">_template.js</code> there to start one; saved changes load
                within a second, and a broken change never replaces the version that works.
              </>
            ) : (
              'Only the built-in adapters are loaded.'
            )}
          </p>
          {adapters.data.failed.map((file) => (
            <ErrorBox key={file.file}>
              <div className="mb-1 font-semibold">{file.file} could not load</div>
              <Problem>{file.error}</Problem>
            </ErrorBox>
          ))}
          <div className="grid gap-4 xl:grid-cols-2">
            {adapters.data.adapters.map((adapter) => (
              <AdapterCard key={`${adapter.origin}:${adapter.id}`} adapter={adapter} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
