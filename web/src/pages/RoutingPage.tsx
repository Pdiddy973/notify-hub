import type {
  CreateRouteRequest,
  MessageDetail,
  RouteInfo,
  RoutePreview,
  RoutePreviewRequest,
  Severity,
  SettingsInfo,
  SourceSummary,
} from '@notify-hub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { MuteControl } from '../components/MuteControl';
import {
  Badge,
  Button,
  Card,
  ChannelSelect,
  ConfirmButton,
  ErrorBox,
  PageHeader,
  SelectField,
  SeverityDot,
  Spinner,
  TextField,
  Toggle,
} from '../components/ui';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { keys, useChannelNames, useChannels, useRoutes, useSettings, useSources } from '../lib/queries';

const severities: Severity[] = ['info', 'success', 'warning', 'error', 'debug'];
// The id the hub gives the unsaved rule in previews.
const DRAFT_ID = 0;
const fieldErrors = (error: unknown) => (error instanceof ApiRequestError ? error.fieldErrors() : {});

function describeConditions(rule: Pick<RouteInfo, 'conditions'>): string {
  const parts: string[] = [];
  if (rule.conditions.events?.length) parts.push(`event ${rule.conditions.events.join(' or ')}`);
  if (rule.conditions.severities?.length) parts.push(`severity ${rule.conditions.severities.join(' or ')}`);
  if (rule.conditions.text) parts.push(`text contains "${rule.conditions.text}"`);
  return parts.length ? parts.join(', ') : 'every message';
}

interface Draft {
  name: string;
  sourceId: string;
  events: string;
  severities: Severity[];
  text: string;
  action: 'send' | 'drop';
  channelId: string;
  mentions: string;
  enabled: boolean;
  continueMatching: boolean;
}

const emptyDraft: Draft = {
  name: '',
  sourceId: '',
  events: '',
  severities: [],
  text: '',
  action: 'send',
  channelId: '',
  mentions: '',
  enabled: true,
  continueMatching: false,
};

const draftOf = (rule: RouteInfo): Draft => ({
  name: rule.name,
  sourceId: rule.sourceId ?? '',
  events: rule.conditions.events?.join(', ') ?? '',
  severities: rule.conditions.severities ?? [],
  text: rule.conditions.text ?? '',
  action: rule.action,
  channelId: rule.channelId ?? '',
  mentions: rule.mentions.join(' '),
  enabled: rule.enabled,
  continueMatching: rule.continueMatching,
});

const requestOf = (draft: Draft): CreateRouteRequest => {
  const events = draft.events
    .split(',')
    .map((event) => event.trim())
    .filter(Boolean);
  const send = draft.action === 'send';
  return {
    name: draft.name.trim(),
    sourceId: draft.sourceId || null,
    conditions: {
      ...(events.length ? { events } : {}),
      ...(draft.severities.length ? { severities: draft.severities } : {}),
      ...(draft.text.trim() ? { text: draft.text.trim() } : {}),
    },
    action: draft.action,
    channelId: send ? draft.channelId || null : null,
    mentions: send ? draft.mentions.split(/\s+/).filter(Boolean) : [],
    enabled: draft.enabled,
    continueMatching: draft.continueMatching,
  };
};

// The rule being edited, for the tester; id is set when it replaces a saved rule.
export interface EditedRule {
  id?: number;
  request: CreateRouteRequest;
}

function RuleForm({
  rule,
  sources,
  onDone,
  onChange,
}: {
  rule?: RouteInfo;
  sources: SourceSummary[];
  onDone: () => void;
  onChange: (edited: EditedRule | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const channels = useChannels();
  const [draft, setDraft] = useState<Draft>(rule ? draftOf(rule) : emptyDraft);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const save = useMutation({
    mutationFn: () =>
      rule
        ? api<RouteInfo>(`/routes/${rule.id}`, { method: 'PATCH', body: requestOf(draft) })
        : api<RouteInfo>('/routes', { method: 'POST', body: requestOf(draft) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.routes });
      onDone();
    },
  });

  useEffect(() => {
    onChange({ ...(rule ? { id: rule.id } : {}), request: requestOf(draft) });
  }, [draft, rule, onChange]);
  useEffect(() => () => onChange(undefined), [onChange]);

  const fields = fieldErrors(save.error);
  const conditionError = Object.entries(fields).find(([path]) => path.startsWith('conditions'))?.[1];
  const mentionError = Object.entries(fields).find(([path]) => path.startsWith('mentions'))?.[1];
  const sending = draft.action === 'send';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="grid gap-4 border-b border-line bg-page/40 p-4 md:grid-cols-2">
      <h2 className="font-semibold text-white md:col-span-2">{rule ? 'Edit rule' : 'New rule'}</h2>
      {save.error && !Object.keys(fields).length && (
        <div className="md:col-span-2">
          <ErrorBox>{save.error.message}</ErrorBox>
        </div>
      )}
      <TextField
        label="Name"
        value={draft.name}
        onChange={(e) => set('name', e.target.value)}
        placeholder="Errors to #alerts"
        error={fields.name}
      />
      <SelectField
        label="Source"
        value={draft.sourceId}
        onChange={(e) => set('sourceId', e.target.value)}
        error={fields.sourceId}
      >
        <option value="">Any source</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Events"
        value={draft.events}
        onChange={(e) => set('events', e.target.value)}
        placeholder="download, grab"
        hint="Comma-separated; empty matches every event."
      />
      <TextField
        label="Text contains"
        value={draft.text}
        onChange={(e) => set('text', e.target.value)}
        placeholder="4K"
        hint="Searched in the title, body, and fields."
      />
      <fieldset className="space-y-1 md:col-span-2">
        <legend className="text-xs font-semibold tracking-wide text-muted uppercase">Severities</legend>
        <div className="flex flex-wrap gap-3">
          {severities.map((severity) => (
            <label key={severity} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={draft.severities.includes(severity)}
                onChange={(e) =>
                  set(
                    'severities',
                    e.target.checked
                      ? [...draft.severities, severity]
                      : draft.severities.filter((s) => s !== severity),
                  )
                }
              />
              <SeverityDot severity={severity} /> {severity}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">None checked matches every severity.</p>
      </fieldset>
      {conditionError && (
        <div className="md:col-span-2">
          <ErrorBox>{conditionError}</ErrorBox>
        </div>
      )}
      <SelectField
        label="When it matches"
        value={draft.action}
        onChange={(e) => set('action', e.target.value as Draft['action'])}
      >
        <option value="send">Send to a channel</option>
        <option value="drop">Drop it: send nothing, not even to the fallback</option>
      </SelectField>
      {sending ? (
        <ChannelSelect
          label="Send to"
          value={draft.channelId}
          onChange={(value) => set('channelId', value)}
          channels={channels.data ?? []}
          error={fields.channelId}
        />
      ) : (
        <p className="self-end text-xs text-muted">
          Dropped messages stay in the log with status dropped. Earlier rules that continue still send.
        </p>
      )}
      {sending && (
        <div className="md:col-span-2">
          <TextField
            label="Mentions"
            value={draft.mentions}
            onChange={(e) => set('mentions', e.target.value)}
            placeholder="<@&123456789012345678> @here"
            error={mentionError}
            spellCheck={false}
            hint={
              <>
                Space-separated: <code>@here</code>, <code>@everyone</code>, a role as{' '}
                <code>&lt;@&amp;role id&gt;</code>, or a user as <code>&lt;@user id&gt;</code>. In Discord,
                turn on Developer Mode and right-click a role or user to copy its id. The bot needs the
                Mention Everyone permission for @here, @everyone, and roles that are not mentionable.
              </>
            }
          />
        </div>
      )}
      <div className="space-y-3 md:col-span-2">
        <Toggle label="Rule is on" checked={draft.enabled} onChange={(value) => set('enabled', value)} />
        {sending && (
          <Toggle
            label="Also check later rules"
            checked={draft.continueMatching}
            onChange={(value) => set('continueMatching', value)}
            hint="Off: a match stops here. On: later rules can send the message to more channels."
          />
        )}
      </div>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit" disabled={save.isPending || (sending && !draft.channelId)}>
          {rule ? 'Save rule' : 'Add rule'}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RuleTarget({ rule, channelNames }: { rule: RouteInfo; channelNames: Map<string, string> }) {
  if (rule.action === 'drop') return <>drop</>;
  const channel = rule.channelId ? (channelNames.get(rule.channelId) ?? rule.channelId) : '?';
  return (
    <>
      #{channel}
      {rule.mentions.length > 0 && ` with ${rule.mentions.join(' ')}`}
    </>
  );
}

function RuleList({
  rules,
  sources,
  onEdit,
}: {
  rules: RouteInfo[];
  sources: SourceSummary[];
  onEdit: (edited: EditedRule | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const channelNames = useChannelNames();
  const sourceNames = new Map(sources.map((source) => [source.id, source.name]));
  const [editing, setEditing] = useState<number | 'new'>();
  const [dragged, setDragged] = useState<number>();

  const reorder = useMutation({
    mutationFn: (ids: number[]) => api<RouteInfo[]>('/routes/order', { method: 'PUT', body: { ids } }),
    onMutate: (ids) => {
      const byId = new Map(rules.map((rule) => [rule.id, rule]));
      queryClient.setQueryData<RouteInfo[]>(
        keys.routes,
        ids.map((id) => byId.get(id)!),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.routes }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      api(`/routes/${id}`, { method: 'PATCH', body: { enabled } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.routes }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/routes/${id}`, { method: 'DELETE' }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: keys.routes });
      void queryClient.invalidateQueries({ queryKey: keys.mutes });
    },
  });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rules.length || from === to) return;
    const ids = rules.map((rule) => rule.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id!);
    reorder.mutate(ids);
  };
  const error = reorder.error ?? toggle.error ?? remove.error;
  const stopEditing = () => setEditing(undefined);

  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        <span className="text-sm text-muted">Checked from the top; drag or use the arrows to reorder.</span>
        {editing !== 'new' && (
          <Button className="ml-auto" onClick={() => setEditing('new')}>
            Add rule
          </Button>
        )}
      </div>
      {error && (
        <div className="p-3">
          <ErrorBox>{errorMessage(error)}</ErrorBox>
        </div>
      )}
      {editing === 'new' && <RuleForm sources={sources} onDone={stopEditing} onChange={onEdit} />}
      {rules.length === 0 && editing !== 'new' && (
        <p className="p-6 text-center text-sm text-muted">
          No rules yet, so every message goes to the fallback channel, or is logged as unrouted.
        </p>
      )}
      <ol>
        {rules.map((rule, index) =>
          editing === rule.id ? (
            <li key={rule.id}>
              <RuleForm rule={rule} sources={sources} onDone={stopEditing} onChange={onEdit} />
            </li>
          ) : (
            <li
              key={rule.id}
              draggable
              onDragStart={() => setDragged(index)}
              onDragEnd={() => setDragged(undefined)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged !== undefined) move(dragged, index);
                setDragged(undefined);
              }}
              className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2.5 text-sm ${
                dragged === index ? 'opacity-50' : ''
              } ${rule.enabled ? '' : 'text-muted'}`}
            >
              <span className="cursor-grab text-muted select-none" aria-hidden>
                ⠿
              </span>
              <span className="w-5 text-right text-xs text-muted tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate text-white">
                  {rule.name || describeConditions(rule)}
                  {!rule.enabled && <span className="ml-2 text-xs text-muted">(off)</span>}
                </span>
                <span className="block truncate text-xs text-muted">
                  {rule.sourceId ? (sourceNames.get(rule.sourceId) ?? rule.sourceId) : 'Any source'} ·{' '}
                  {describeConditions(rule)} → <RuleTarget rule={rule} channelNames={channelNames} />
                </span>
              </span>
              {rule.action === 'drop' && <Badge tone="bad">drops</Badge>}
              {rule.continueMatching && rule.action === 'send' && <Badge>continues</Badge>}
              <span className="flex flex-wrap items-center gap-1">
                {rule.action === 'send' && <MuteControl scope="route" target={String(rule.id)} compact />}
                <Button
                  variant="ghost"
                  aria-label="Move up"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  aria-label="Move down"
                  onClick={() => move(index, index + 1)}
                  disabled={index === rules.length - 1}
                >
                  ↓
                </Button>
                <Toggle
                  label="Rule is on"
                  hideLabel
                  checked={rule.enabled}
                  onChange={(enabled) => toggle.mutate({ id: rule.id, enabled })}
                />
                <Button variant="ghost" onClick={() => setEditing(rule.id)}>
                  Edit
                </Button>
                <ConfirmButton
                  variant="ghost"
                  onConfirm={() => remove.mutate(rule.id)}
                  confirmLabel="Delete?"
                >
                  Delete
                </ConfirmButton>
              </span>
            </li>
          ),
        )}
      </ol>
    </Card>
  );
}

function FallbackChannel() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const channels = useChannels();
  const save = useMutation({
    mutationFn: (fallbackChannelId: string | null) =>
      api<SettingsInfo>('/settings', { method: 'PUT', body: { fallbackChannelId } }),
    onSuccess: (data) => queryClient.setQueryData(keys.settings, data),
  });
  if (!settings.data) return null;
  return (
    <Card className="space-y-2 p-4">
      <ChannelSelect
        label="Fallback channel"
        value={settings.data.fallbackChannelId ?? ''}
        onChange={(value) => save.mutate(value || null)}
        channels={channels.data ?? []}
        emptyLabel="None: log them as unrouted"
      />
      <p className="text-xs text-muted">Receives messages that no rule matched.</p>
      {save.error && <ErrorBox>{errorMessage(save.error)}</ErrorBox>}
    </Card>
  );
}

const outcomeText: Record<RoutePreview['outcome'], string> = {
  sent: '',
  dropped: 'nowhere; a drop rule matched',
  muted: 'nowhere; it is muted',
  unrouted: 'nowhere; it would be logged as unrouted',
};

function RuleTester({
  rules,
  sources,
  edited,
}: {
  rules: RouteInfo[];
  sources: SourceSummary[];
  edited?: EditedRule;
}) {
  const channelNames = useChannelNames();
  const [form, setForm] = useState<Required<Omit<RoutePreviewRequest, 'body' | 'draft'>> & { body: string }>({
    sourceId: '',
    event: '',
    severity: 'info',
    title: '',
    body: '',
  });
  const [useEdited, setUseEdited] = useState(true);
  const [messageId, setMessageId] = useState('');
  const sourceId = form.sourceId || sources[0]?.id || '';
  const withDraft = edited && useEdited;
  const preview = useMutation({
    mutationFn: () =>
      api<RoutePreview>('/routes/preview', {
        method: 'POST',
        body: {
          ...form,
          sourceId,
          ...(form.body ? {} : { body: undefined }),
          ...(withDraft ? { draft: { ...edited.request, ...(edited.id ? { id: edited.id } : {}) } } : {}),
        },
      }),
  });
  const load = useMutation({
    mutationFn: () => api<MessageDetail>(`/messages/${Number(messageId)}`),
    onSuccess: (message) => {
      const first = message.normalized?.[0];
      setForm({
        sourceId: message.sourceId,
        event: first?.event ?? '',
        severity: first?.severity ?? 'info',
        title: first?.title ?? '',
        body: first?.body ?? '',
      });
      preview.reset();
    },
  });
  const fields = fieldErrors(preview.error);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const ruleName = (routeId: number) => {
    if (routeId === DRAFT_ID) return edited?.request.name || 'Rule being edited (unsaved)';
    const rule = rules.find((r) => r.id === routeId);
    return rule ? rule.name || describeConditions(rule) : `Rule ${routeId}`;
  };

  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-semibold text-white">Rule tester</h2>
      <p className="text-xs text-muted">
        Checks the rules and active mutes against a message without sending anything.
      </p>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          load.mutate();
        }}
      >
        <div className="flex-1">
          <TextField
            label="Load from log message"
            value={messageId}
            onChange={(e) => setMessageId(e.target.value.replace(/\D/g, ''))}
            placeholder="Message number"
            inputMode="numeric"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!messageId || load.isPending}>
          Load
        </Button>
      </form>
      {load.error && <ErrorBox>{errorMessage(load.error)}</ErrorBox>}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          preview.mutate();
        }}
      >
        <SelectField label="Source" value={sourceId} onChange={set('sourceId')} error={fields.sourceId}>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Severity" value={form.severity} onChange={set('severity')}>
          {severities.map((severity) => (
            <option key={severity}>{severity}</option>
          ))}
        </SelectField>
        <TextField label="Event" value={form.event} onChange={set('event')} error={fields.event} />
        <TextField label="Title" value={form.title} onChange={set('title')} />
        <div className="sm:col-span-2">
          <TextField label="Body" value={form.body} onChange={set('body')} />
        </div>
        {edited && (
          <div className="sm:col-span-2">
            <Toggle
              label="Include the rule being edited, unsaved"
              checked={useEdited}
              onChange={setUseEdited}
            />
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!sourceId || !form.event || preview.isPending}>
            Test
          </Button>
        </div>
      </form>
      {preview.error && <ErrorBox>{errorMessage(preview.error)}</ErrorBox>}
      {preview.data && (
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-muted">Would send to: </span>
            {preview.data.deliveries.length ? (
              preview.data.deliveries
                .map(
                  (d) =>
                    `#${channelNames.get(d.channelId) ?? d.channelId}${d.routeId === null ? ' (fallback)' : ''}${
                      d.mentions.length ? ` with ${d.mentions.join(' ')}` : ''
                    }`,
                )
                .join(', ')
            ) : (
              <span className="text-warn">{outcomeText[preview.data.outcome]}</span>
            )}
          </div>
          {preview.data.mutedBy && <p className="text-warn">The {preview.data.mutedBy}.</p>}
          <ol className="space-y-1">
            {preview.data.checks.map((check, index) => (
              <li key={check.routeId} className="flex gap-2">
                <span className="w-5 text-right text-xs text-muted tabular-nums">{index + 1}</span>
                <span className={check.matched ? 'text-ok' : 'text-muted'}>{check.matched ? '✓' : '–'}</span>
                <span className="min-w-0">
                  <span className="text-ink">{ruleName(check.routeId)}</span>
                  {check.reason && <span className="text-muted">: {check.reason}</span>}
                  {check.note && <span className="text-warn">: {check.note}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}

export function RoutingPage() {
  const routes = useRoutes();
  const sources = useSources();
  const [edited, setEdited] = useState<EditedRule>();
  const ready = routes.data && sources.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Routing" />
      {(routes.isError || sources.isError) && (
        <ErrorBox>{errorMessage(routes.error ?? sources.error)}</ErrorBox>
      )}
      {!ready && !routes.isError && <Spinner />}
      {ready && (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
          <RuleList rules={routes.data} sources={sources.data} onEdit={setEdited} />
          <div className="flex flex-col gap-4">
            <FallbackChannel />
            <RuleTester rules={routes.data} sources={sources.data} edited={edited} />
          </div>
        </div>
      )}
    </div>
  );
}
