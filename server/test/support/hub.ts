import { vi } from 'vitest';
import { createSqliteDatabase, openSqlite, settingKeys } from '../../src/db/index.js';
import {
  DiscordTokenRejected,
  type ConnectOptions,
  type DiscordConnection,
  type DiscordRest,
  type DiscordSender,
} from '../../src/discord/index.js';
import { createHub, type HubDeps } from '../../src/hub.js';
import { createSecretBox } from '../../src/security/index.js';

export const APP_SECRET = 'test-secret-'.repeat(4);
export const SOURCE_ID = 'sonarr-main';
export const SOURCE_TOKEN = 'source-token-0123456789';
export const SETUP_CODE = 'ABCD-EFGH-JKMN';
export const ADMIN = { username: 'admin', password: 'correct horse battery' };
// Shaped like a bot token; not a real one.
export const BOT_TOKEN = `${Buffer.from('123456789012345678').toString('base64url')}.GhIjKl.${'a'.repeat(38)}`;
export const GUILD_ID = '111111111111111111';
export const CHANNEL_ID = '222222222222222222';

export interface TestHubOptions {
  // Whether the fake bot reports itself connected.
  ready?: boolean;
  // Whether a bot token and guild are saved.
  configured?: boolean;
  // Null uses the body limit setting, as a real start does.
  bodyLimitBytes?: number | null;
  webRoot?: string;
  keepAliveMs?: number;
  // Records every log line at trace level in `logs`.
  captureLogs?: boolean;
  adaptersDir?: string;
  adapterHost?: HubDeps['adapterHost'];
}

// A full hub on an in-memory database, with one source and route and a fake Discord connection.
export function createTestHub({
  ready = true,
  configured = true,
  bodyLimitBytes = 4096,
  webRoot,
  keepAliveMs,
  captureLogs = false,
  adaptersDir,
  adapterHost,
}: TestHubOptions = {}) {
  const logs: string[] = [];
  const sqlite = openSqlite(':memory:');
  const db = createSqliteDatabase(sqlite, createSecretBox(APP_SECRET));
  if (configured) {
    db.setSetting(settingKeys.discordToken, BOT_TOKEN, { encrypted: true });
    db.setSetting(settingKeys.discordGuildId, GUILD_ID);
  }
  db.saveSource({
    id: SOURCE_ID,
    name: 'Sonarr',
    type: 'standard',
    token: SOURCE_TOKEN,
    enabled: true,
    config: {},
  });
  db.replaceRoutes(SOURCE_ID, [{ channelId: 'channel-1' }]);

  let isReady = ready;
  let sent = 0;
  const send = vi.fn<DiscordSender['send']>(async () => ({ messageId: `discord-${++sent}` }));
  const connect = vi.fn(({ api, guildId }: ConnectOptions): DiscordConnection => ({
    sender: { send },
    isReady: () => isReady,
    botUser: () => (isReady ? 'NotifyBot' : undefined),
    guildName: () => (isReady ? 'Homelab' : undefined),
    async syncChannels() {
      await api.saveChannels(guildId, [{ id: CHANNEL_ID, name: 'alerts', type: 'GuildText' }]);
      return 1;
    },
    destroy: async () => {},
  }));
  const discordRest: DiscordRest = {
    async verifyToken(token) {
      if (token !== BOT_TOKEN) throw new DiscordTokenRejected();
      return {
        botUser: 'NotifyBot',
        botId: '123456789012345678',
        guilds: [{ id: GUILD_ID, name: 'Homelab' }],
      };
    },
  };

  const start = () =>
    createHub({
      sqlite,
      appSecret: APP_SECRET,
      ...(bodyLimitBytes === null ? {} : { bodyLimitBytes }),
      connect,
      discordRest,
      webRoot,
      idleMs: 5,
      keepAliveMs,
      setupCode: SETUP_CODE,
      ...(adaptersDir ? { adaptersDir } : {}),
      ...(adapterHost ? { adapterHost } : {}),
      ...(captureLogs
        ? { logger: { level: 'trace', stream: { write: (line: string) => void logs.push(line) } } }
        : {}),
    });
  let hub = start();

  return {
    get app() {
      return hub.app;
    },
    get db() {
      return hub.db;
    },
    get ready() {
      return hub.ready;
    },
    sqlite,
    send,
    connect,
    logs,
    setReady(value: boolean) {
      isReady = value;
    },
    count(table: string): number {
      return (sqlite.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    },
    // Stops the hub and starts a new one on the same database.
    async restart() {
      await hub.close();
      hub = start();
    },
    async close() {
      await hub.close();
      sqlite.sqlite.close();
    },
  };
}

export type TestHub = ReturnType<typeof createTestHub>;

// Waits for the adapters first, so a busy machine does not stretch the wait for the result.
export async function postHook(
  hub: TestHub,
  body: unknown,
  { token = SOURCE_TOKEN, sourceId = SOURCE_ID } = {},
) {
  await hub.ready;
  return hub.app.inject({
    method: 'POST',
    url: `/hook/${sourceId}/${token}`,
    headers: { 'content-type': 'application/json' },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// Creates the admin account on first use, otherwise logs in; returns the cookie header.
export async function login(hub: TestHub): Promise<string> {
  const session = (await hub.app.inject({ method: 'GET', url: '/api/session' })).json<{
    hasAdmin: boolean;
  }>();
  const response = await hub.app.inject({
    method: 'POST',
    url: session.hasAdmin ? '/api/login' : '/api/setup/account',
    payload: session.hasAdmin ? ADMIN : { ...ADMIN, setupCode: SETUP_CODE },
  });
  const cookie = response.cookies.find((c) => c.name === 'nh_session');
  if (!cookie) throw new Error(`Login failed: ${response.statusCode} ${response.body}`);
  return `nh_session=${cookie.value}`;
}

// Logs in once and returns a function for admin API calls with that session.
export async function adminClient(hub: TestHub) {
  const cookie = await login(hub);
  return (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    hub.app.inject({
      method,
      url,
      headers: { cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
}
