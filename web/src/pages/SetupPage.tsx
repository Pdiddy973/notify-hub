import type { DiscordStatus, DiscordVerifyResult, SessionInfo, SetupFinishResult } from '@notify-hub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router';
import { PageSpinner, useRefreshSession } from '../components/Layout';
import { Button, Card, ErrorBox, SelectField, Spinner, TextField } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { keys, useChannels, useDiscordStatus, useSession } from '../lib/queries';

// View Channels, Send Messages, and Embed Links.
const BOT_PERMISSIONS = 1024 + 2048 + 16384;

const inviteUrl = (botId: string) =>
  `https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot&permissions=${BOT_PERMISSIONS}`;

function Steps({ current }: { current: number }) {
  const names = ['Admin account', 'Discord bot', 'Test channel'];
  return (
    <ol className="flex gap-2 text-xs">
      {names.map((name, index) => (
        <li
          key={name}
          className={`flex-1 border-t-4 pt-2 ${index + 1 <= current ? 'border-accent text-ink' : 'border-line text-muted'}`}
        >
          {index + 1}. {name}
        </li>
      ))}
    </ol>
  );
}

function Shell({ step, children }: { step: number; children: ReactNode }) {
  return (
    <div className="flex min-h-screen justify-center px-4 py-10">
      <Card className="h-fit w-full max-w-lg space-y-6 p-6">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-white">Set up Notify Hub</h1>
          <p className="text-sm text-muted">Three steps; you can change everything later.</p>
        </div>
        <Steps current={step} />
        {children}
      </Card>
    </div>
  );
}

function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiRequestError ? error.fieldErrors() : {};
}

function AccountStep() {
  const refresh = useRefreshSession();
  const [setupCode, setSetupCode] = useState('');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const create = useMutation({
    mutationFn: () => api('/setup/account', { method: 'POST', body: { setupCode, username, password } }),
    onSuccess: refresh,
  });
  const mismatch = confirm.length > 0 && confirm !== password;
  const fields = fieldErrors(create.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!mismatch) create.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm">Create the admin login for this hub.</p>
      {create.error && !Object.keys(fields).length && <ErrorBox>{create.error.message}</ErrorBox>}
      <TextField
        label="Setup code"
        autoComplete="off"
        spellCheck={false}
        value={setupCode}
        onChange={(e) => setSetupCode(e.target.value)}
        error={fields.setupCode}
        hint={
          <>
            Printed in the hub log when it starts: the installer output, <code>journalctl -u notify-hub</code>{' '}
            on the LXC, or the terminal running <code>npm run dev</code>.
          </>
        }
        autoFocus
      />
      <TextField
        label="Username"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={fields.username}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fields.password}
        hint="At least 8 characters."
      />
      <TextField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={mismatch ? 'The passwords do not match' : undefined}
      />
      <Button type="submit" disabled={create.isPending || mismatch || !password || !setupCode}>
        Create account
      </Button>
    </form>
  );
}

function DiscordStep({ onSaved }: { onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [botToken, setBotToken] = useState('');
  const [guildId, setGuildId] = useState('');
  const verify = useMutation({
    mutationFn: () => api<DiscordVerifyResult>('/discord/verify', { method: 'POST', body: { botToken } }),
    onSuccess: (result) => setGuildId(result.guilds[0]?.id ?? ''),
  });
  const save = useMutation({
    mutationFn: () => api<DiscordStatus>('/discord', { method: 'PUT', body: { botToken, guildId } }),
    onSuccess: (status) => {
      queryClient.setQueryData(keys.discord, status);
      onSaved();
    },
  });
  const fields = fieldErrors(verify.error);
  const bot = verify.data;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (bot && guildId) save.mutate();
    else verify.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2 text-sm">
        <p>Paste the token of your Discord bot.</p>
        <p className="text-muted">
          In the Discord Developer Portal, open your application, choose <b>Bot</b>, then <b>Reset Token</b>,
          and copy it. It has three parts separated by dots.
        </p>
      </div>
      {verify.error && !Object.keys(fields).length && <ErrorBox>{verify.error.message}</ErrorBox>}
      <TextField
        label="Bot token"
        type="password"
        autoComplete="off"
        value={botToken}
        onChange={(e) => {
          setBotToken(e.target.value);
          verify.reset();
        }}
        error={fields.botToken}
        autoFocus
      />

      {bot && (
        <div className="space-y-3 rounded border border-line bg-page p-3">
          <p className="text-sm">
            Signed in as <b className="text-white">{bot.botUser}</b>.
          </p>
          {bot.guilds.length > 0 ? (
            <SelectField label="Discord server" value={guildId} onChange={(e) => setGuildId(e.target.value)}>
              {bot.guilds.map((guild) => (
                <option key={guild.id} value={guild.id}>
                  {guild.name}
                </option>
              ))}
            </SelectField>
          ) : (
            <p className="text-sm text-warn">The bot is not in any server yet.</p>
          )}
          <p className="text-xs text-muted">
            Server missing?{' '}
            <a
              href={inviteUrl(bot.botId)}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              Invite the bot
            </a>{' '}
            with the View Channels, Send Messages, and Embed Links permissions, then check the token again.
          </p>
        </div>
      )}
      {save.error && <ErrorBox>{save.error.message}</ErrorBox>}

      <div className="flex gap-2">
        {bot ? (
          <>
            <Button type="submit" disabled={!guildId || save.isPending}>
              {save.isPending ? 'Connecting…' : 'Connect'}
            </Button>
            <Button variant="secondary" onClick={() => verify.mutate()} disabled={verify.isPending}>
              Check again
            </Button>
          </>
        ) : (
          <Button type="submit" disabled={!botToken || verify.isPending}>
            {verify.isPending ? 'Checking…' : 'Check token'}
          </Button>
        )}
      </div>
    </form>
  );
}

function ChannelStep({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const status = useDiscordStatus({ refetchInterval: 3000 });
  const waiting = !status.data?.connected;
  const channels = useChannels({ pollUntilFound: true });
  const [channelId, setChannelId] = useState('');
  const finish = useMutation({
    mutationFn: (id: string) =>
      api<SetupFinishResult>('/setup/finish', { method: 'POST', body: { channelId: id } }),
    onSuccess: () =>
      queryClient.setQueryData<SessionInfo>(keys.session, (info) => info && { ...info, setupComplete: true }),
  });
  const list = channels.data ?? [];
  const selected = channelId || list[0]?.id || '';

  if (finish.data) {
    const url = `${window.location.origin}${finish.data.hookPath}`;
    return (
      <div className="space-y-4 text-sm">
        <p>
          Setup is done. A <b>Test</b> source now sends to the channel you picked.
        </p>
        <div className="space-y-1">
          <div className="text-xs text-muted">Its webhook URL</div>
          <code className="block rounded bg-page p-2 text-xs break-all">{url}</code>
        </div>
        <Link to="/log" className="inline-block rounded bg-accent px-4 py-2 font-medium text-white">
          Open the live log
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {status.data?.connected
          ? `Connected to ${status.data.guildName ?? 'Discord'} as ${status.data.botUser}. Pick a channel for test messages.`
          : 'Connecting the bot to Discord…'}
      </p>
      {waiting ? (
        <Spinner label="Waiting for the bot to connect" />
      ) : list.length === 0 ? (
        <div className="space-y-2">
          <Spinner label="Loading the server's channels" />
          <p className="text-xs text-muted">
            If no channels appear, give the bot the View Channels permission in your server.
          </p>
        </div>
      ) : (
        <SelectField label="Channel" value={selected} onChange={(e) => setChannelId(e.target.value)}>
          {list.map((channel) => (
            <option key={channel.id} value={channel.id}>
              #{channel.name}
            </option>
          ))}
        </SelectField>
      )}
      {finish.error && <ErrorBox>{finish.error.message}</ErrorBox>}
      <div className="flex gap-2">
        <Button onClick={() => finish.mutate(selected)} disabled={!selected || finish.isPending}>
          Finish setup
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Change bot
        </Button>
      </div>
    </div>
  );
}

export function SetupPage() {
  const session = useSession();
  const authenticated = session.data?.authenticated ?? false;
  const discord = useDiscordStatus({ refetchInterval: false, enabled: authenticated });
  const [editingBot, setEditingBot] = useState(false);
  const enabled = authenticated && !discord.isPending;

  if (session.isPending) return <PageSpinner />;
  const info = session.data;
  if (!info) return <Navigate to="/login" replace />;
  if (info.hasAdmin && !info.authenticated) return <Navigate to="/login" replace />;

  if (!info.hasAdmin) {
    return (
      <Shell step={1}>
        <AccountStep />
      </Shell>
    );
  }
  if (!enabled) return <PageSpinner />;
  if (editingBot || !discord.data?.configured) {
    return (
      <Shell step={2}>
        <DiscordStep onSaved={() => setEditingBot(false)} />
      </Shell>
    );
  }
  return (
    <Shell step={3}>
      <ChannelStep onBack={() => setEditingBot(true)} />
    </Shell>
  );
}
