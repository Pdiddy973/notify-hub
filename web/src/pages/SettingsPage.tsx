import type { ChangePasswordRequest, SettingsInfo, UpdateHubSettingsRequest } from '@notify-hub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Button,
  Card,
  ChannelSelect,
  ErrorBox,
  Notice,
  PageHeader,
  Spinner,
  TextField,
} from '../components/ui';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { keys, useChannels, useDiscordStatus, useSettings } from '../lib/queries';
import { DiscordStep } from './SetupPage';

const fieldErrors = (error: unknown) => (error instanceof ApiRequestError ? error.fieldErrors() : {});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-semibold text-white">{title}</h2>
      {children}
    </Card>
  );
}

function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateHubSettingsRequest) => api<SettingsInfo>('/settings', { method: 'PUT', body }),
    onSuccess: (data) => queryClient.setQueryData(keys.settings, data),
  });
}

function DiscordSection() {
  const queryClient = useQueryClient();
  const status = useDiscordStatus();
  const [editing, setEditing] = useState(false);
  const sync = useMutation({
    mutationFn: () => api('/discord/sync-channels', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.channels }),
  });
  const channels = useChannels();

  return (
    <Section title="Discord connection">
      {editing ? (
        <>
          <DiscordStep onSaved={() => setEditing(false)} />
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Status</dt>
            <dd>
              {status.data?.connected ? 'Connected' : status.data?.configured ? 'Offline' : 'Not set up'}
            </dd>
            <dt className="text-muted">Bot</dt>
            <dd>{status.data?.botUser ?? '—'}</dd>
            <dt className="text-muted">Server</dt>
            <dd>{status.data?.guildName ?? status.data?.guildId ?? '—'}</dd>
            <dt className="text-muted">Channels</dt>
            <dd>{channels.data?.length ?? 0} known</dd>
          </dl>
          <p className="text-xs text-muted">The bot token is never shown again after it is saved.</p>
          {sync.error && <ErrorBox>{errorMessage(sync.error)}</ErrorBox>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Change bot token or server
            </Button>
            <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? 'Syncing…' : 'Sync channels'}
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

function ChannelsSection({ settings }: { settings: SettingsInfo }) {
  const channels = useChannels();
  const save = useSaveSettings();
  return (
    <Section title="Channels">
      <ChannelSelect
        label="Alert channel"
        value={settings.alertChannelId ?? ''}
        onChange={(value) => save.mutate({ alertChannelId: value || null })}
        channels={channels.data ?? []}
        emptyLabel="None"
      />
      <p className="text-xs text-muted">
        Receives the hub's own alerts, such as a spike in discarded requests. Self-check alerts will use it
        too.
      </p>
      <ChannelSelect
        label="Fallback channel"
        value={settings.fallbackChannelId ?? ''}
        onChange={(value) => save.mutate({ fallbackChannelId: value || null })}
        channels={channels.data ?? []}
        emptyLabel="None: log them as unrouted"
      />
      <p className="text-xs text-muted">Receives messages that no routing rule matched.</p>
      {save.error && <ErrorBox>{errorMessage(save.error)}</ErrorBox>}
    </Section>
  );
}

function WebhookSection({ settings }: { settings: SettingsInfo }) {
  const save = useSaveSettings();
  const [address, setAddress] = useState(settings.webhookBaseUrl ?? '');
  useEffect(() => setAddress(settings.webhookBaseUrl ?? ''), [settings.webhookBaseUrl]);
  const error = fieldErrors(save.error).webhookBaseUrl;
  const value = address.trim().replace(/\/+$/, '');

  return (
    <Section title="Webhook address">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ webhookBaseUrl: value || null });
        }}
      >
        <TextField
          label="Address services use to reach the hub"
          value={address}
          onChange={(e) => {
            save.reset();
            setAddress(e.target.value);
          }}
          placeholder={window.location.origin}
          error={error}
          spellCheck={false}
          hint="The start of every webhook URL on the Sources page, such as http://192.168.1.20:8080. Leave it empty to use the address in this browser."
        />
        {save.error && !error && <ErrorBox>{save.error.message}</ErrorBox>}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={save.isPending || value === (settings.webhookBaseUrl ?? '')}>
            Save
          </Button>
          {save.isSuccess && <span className="text-xs text-ok">Saved</span>}
        </div>
      </form>
    </Section>
  );
}

function LimitsSection({ settings }: { settings: SettingsInfo }) {
  const save = useSaveSettings();
  const [retention, setRetention] = useState(String(settings.messageRetentionDays));
  const [bodyLimit, setBodyLimit] = useState(String(settings.bodyLimitKb));
  useEffect(() => {
    setRetention(String(settings.messageRetentionDays));
    setBodyLimit(String(settings.bodyLimitKb));
  }, [settings.messageRetentionDays, settings.bodyLimitKb]);
  const fields = fieldErrors(save.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ messageRetentionDays: Number(retention), bodyLimitKb: Number(bodyLimit) });
  };

  return (
    <Section title="Messages and webhooks">
      <form onSubmit={submit} className="space-y-4">
        {save.error && !Object.keys(fields).length && <ErrorBox>{save.error.message}</ErrorBox>}
        <TextField
          label="Keep messages for (days)"
          type="number"
          value={retention}
          onChange={(e) => setRetention(e.target.value)}
          error={fields.messageRetentionDays}
        />
        <Notice>
          Not active yet: the daily cleanup that deletes old messages comes in Phase 7. Nothing is deleted
          until then.
        </Notice>
        <TextField
          label="Largest webhook body (KB)"
          type="number"
          value={bodyLimit}
          onChange={(e) => setBodyLimit(e.target.value)}
          error={fields.bodyLimitKb}
          hint={`Applies after the hub restarts. In use now: ${settings.activeBodyLimitKb} KB.`}
        />
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const [form, setForm] = useState<ChangePasswordRequest & { confirm: string }>({
    currentPassword: '',
    newPassword: '',
    confirm: '',
  });
  const change = useMutation({
    mutationFn: () =>
      api('/settings/password', {
        method: 'PUT',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      }),
    onSuccess: () => setForm({ currentPassword: '', newPassword: '', confirm: '' }),
  });
  const fields = fieldErrors(change.error);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.newPassword;
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    change.reset();
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  return (
    <Section title="Admin password">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) change.mutate();
        }}
      >
        {change.error && !Object.keys(fields).length && <ErrorBox>{change.error.message}</ErrorBox>}
        {change.isSuccess && (
          <p className="text-sm text-ok">Password changed. Every other session was logged out.</p>
        )}
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={set('currentPassword')}
          error={fields.currentPassword}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={set('newPassword')}
          error={fields.newPassword}
          hint="At least 8 characters."
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={mismatch ? 'The passwords do not match' : undefined}
        />
        <Button
          type="submit"
          disabled={change.isPending || mismatch || !form.currentPassword || !form.newPassword}
        >
          Change password
        </Button>
        <p className="text-xs text-muted">Changing it logs out every other browser.</p>
      </form>
    </Section>
  );
}

function BackupSection({ version }: { version: string }) {
  return (
    <Section title="Backup and about">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled>
          Export settings
        </Button>
        <Button variant="secondary" disabled>
          Import settings
        </Button>
      </div>
      <Notice>Not active yet: export and import come in Phase 7. Exports will leave secrets out.</Notice>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
        <dt className="text-muted">Version</dt>
        <dd>{version}</dd>
      </dl>
    </Section>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" />
      {settings.isPending && <Spinner />}
      {settings.isError && <ErrorBox>{errorMessage(settings.error)}</ErrorBox>}
      {settings.data && (
        <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <DiscordSection />
          <ChannelsSection settings={settings.data} />
          <WebhookSection settings={settings.data} />
          <LimitsSection settings={settings.data} />
          <PasswordSection />
          <BackupSection version={settings.data.version} />
        </div>
      )}
    </div>
  );
}
