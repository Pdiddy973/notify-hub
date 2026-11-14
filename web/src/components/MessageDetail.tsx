import type { MessageDetail as Detail, ResendResult } from '@notify-hub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { formatFull, prettyBody } from '../lib/format';
import { keys } from '../lib/queries';
import { EmbedPreview } from './EmbedPreview';
import { Button, ErrorBox, SeverityDot, Spinner, StatusBadge } from './ui';

const tabs = ['Embed', 'Normalized', 'Raw', 'Deliveries'] as const;
type Tab = (typeof tabs)[number];

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded bg-page p-3 text-xs leading-relaxed whitespace-pre-wrap text-ink">
      {children}
    </pre>
  );
}

// Copies text and says for two seconds whether it worked.
function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <Button
      variant="ghost"
      className="px-2 py-1 text-xs"
      onClick={async () => {
        setState((await copyText(text)) ? 'copied' : 'failed');
        setTimeout(() => setState('idle'), 2000);
      }}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  );
}

export function MessageDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('Embed');
  const query = useQuery({ queryKey: keys.message(id), queryFn: () => api<Detail>(`/messages/${id}`) });
  const queryClient = useQueryClient();
  const resend = useMutation({
    mutationFn: () => api<ResendResult>(`/messages/${id}/resend`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.message(id) }),
  });
  const status = query.data?.status;
  const hasFailed = query.data?.deliveries.some((delivery) => delivery.status === 'failed') ?? false;
  // Failed deliveries are queued again; unsent messages are routed again with the current rules.
  const canResend =
    hasFailed ||
    ((status === 'unrouted' || status === 'muted' || status === 'dropped') &&
      Boolean(query.data?.normalized?.length));

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`Message ${id}`}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate font-semibold text-white">
          {query.data?.title ?? `Message #${id}`}
        </h2>
        <Button variant="ghost" onClick={onClose} aria-label="Close details">
          Close
        </Button>
      </div>

      {query.isPending && (
        <div className="p-4">
          <Spinner />
        </div>
      )}
      {query.isError && (
        <div className="p-4">
          <ErrorBox>{errorMessage(query.error)}</ErrorBox>
        </div>
      )}

      {query.data && (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Status</dt>
            <dd>
              <StatusBadge status={query.data.status} />
            </dd>
            <dt className="text-muted">Source</dt>
            <dd>{query.data.sourceName}</dd>
            <dt className="text-muted">Event</dt>
            <dd className="flex items-center gap-2">
              <SeverityDot severity={query.data.severity} />
              {query.data.event ?? '—'}
            </dd>
            <dt className="text-muted">Received</dt>
            <dd>{formatFull(query.data.receivedAt)}</dd>
            <dt className="text-muted">Sent to</dt>
            <dd>{query.data.destinations.map((d) => `#${d}`).join(', ') || '—'}</dd>
          </dl>

          {query.data.error && (
            <ErrorBox>
              <div className="font-semibold">Adapter error</div>
              <div className="whitespace-pre-wrap">{query.data.error}</div>
            </ErrorBox>
          )}
          {query.data.deliveries
            .filter((delivery) => delivery.error)
            .map((delivery) => (
              <ErrorBox key={delivery.id}>
                <div className="font-semibold">
                  Discord rejected the message in #{delivery.channelName ?? delivery.channelId}
                </div>
                <div>{delivery.error}</div>
              </ErrorBox>
            ))}
          {query.data.status === 'unrouted' && <ErrorBox>No route matched, so nothing was sent.</ErrorBox>}
          {query.data.status === 'muted' && (
            <p className="text-sm text-warn">A mute kept this message from being posted.</p>
          )}
          {(canResend || resend.data || resend.error) && (
            <div className="flex flex-wrap items-center gap-2">
              {canResend && (
                <>
                  <Button variant="secondary" onClick={() => resend.mutate()} disabled={resend.isPending}>
                    {hasFailed ? 'Resend failed deliveries' : 'Route again'}
                  </Button>
                  {!hasFailed && (
                    <span className="text-xs text-muted">Uses the current rules and mutes.</span>
                  )}
                </>
              )}
              {resend.data && (
                <span className="text-xs text-ok">
                  {resend.data.rerouted ? 'Routed again.' : `Queued ${resend.data.requeued} again.`}
                </span>
              )}
              {resend.error && <span className="text-xs text-bad">{errorMessage(resend.error)}</span>}
            </div>
          )}

          <div className="flex gap-1 border-b border-line" role="tablist">
            {tabs.map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  tab === name ? 'border-accent text-white' : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          {tab === 'Embed' &&
            (query.data.deliveries.length ? (
              <div className="space-y-3">
                {query.data.deliveries.map((delivery) => (
                  <div key={delivery.id} className="space-y-1">
                    <div className="text-xs text-muted">#{delivery.channelName ?? delivery.channelId}</div>
                    {delivery.content && <div className="text-sm text-ink">{delivery.content}</div>}
                    <EmbedPreview embed={delivery.embed} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No embed was built for this message.</p>
            ))}

          {tab === 'Normalized' &&
            (query.data.normalized ? (
              <Code>{JSON.stringify(query.data.normalized, null, 2)}</Code>
            ) : (
              <p className="text-sm text-muted">The adapter has not produced a message yet.</p>
            ))}

          {tab === 'Raw' && (
            <div className="space-y-3">
              <div className="text-xs text-muted">Headers</div>
              <Code>
                {Object.entries(query.data.headers)
                  .map(([name, value]) => `${name}: ${value}`)
                  .join('\n')}
              </Code>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span className="flex-1">Body ({query.data.rawContentType || 'no content type'})</span>
                {query.data.rawPayload && (
                  <CopyButton text={prettyBody(query.data.rawPayload)} label="Copy body" />
                )}
              </div>
              <Code>{prettyBody(query.data.rawPayload) || '(empty)'}</Code>
            </div>
          )}

          {tab === 'Deliveries' &&
            (query.data.deliveries.length ? (
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Channel</th>
                    <th className="py-1 pr-3 font-normal">Status</th>
                    <th className="py-1 pr-3 font-normal">Attempts</th>
                    <th className="py-1 font-normal">Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.deliveries.map((delivery) => (
                    <tr key={delivery.id} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3">
                        #{delivery.channelName ?? delivery.channelId}
                        {delivery.fallback && (
                          <div className="text-xs text-warn">fallback: no rule matched</div>
                        )}
                        {delivery.content && <div className="text-xs text-muted">{delivery.content}</div>}
                      </td>
                      <td className="py-1.5 pr-3">
                        {delivery.status}
                        {delivery.error && <div className="text-xs text-bad">{delivery.error}</div>}
                      </td>
                      <td className="py-1.5 pr-3">{delivery.attempt}</td>
                      <td className="py-1.5">{delivery.sentAt ? formatFull(delivery.sentAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted">Nothing was queued for Discord.</p>
            ))}
        </div>
      )}
    </section>
  );
}
