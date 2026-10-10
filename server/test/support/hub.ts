import { vi } from 'vitest';
import { createSqliteDatabase, openSqlite, settingKeys } from '../../src/db/index.js';
import type { DiscordConnection, DiscordSender } from '../../src/discord/index.js';
import { createHub } from '../../src/hub.js';
import { createSecretBox } from '../../src/security/index.js';

export const APP_SECRET = 'test-secret-'.repeat(4);
export const SOURCE_ID = 'sonarr-main';
export const SOURCE_TOKEN = 'source-token-0123456789';

export interface TestHubOptions {
  // Whether the fake bot reports itself connected.
  ready?: boolean;
  // Whether a bot token and guild are saved.
  configured?: boolean;
  bodyLimitBytes?: number;
}

// A full hub on an in-memory database, with one source and route and a fake Discord connection.
export function createTestHub({
  ready = true,
  configured = true,
  bodyLimitBytes = 4096,
}: TestHubOptions = {}) {
  const sqlite = openSqlite(':memory:');
  const db = createSqliteDatabase(sqlite, createSecretBox(APP_SECRET));
  if (configured) {
    db.setSetting(settingKeys.discordToken, 'bot-token', { encrypted: true });
    db.setSetting(settingKeys.discordGuildId, 'guild-1');
  }
  db.saveSource({
    id: SOURCE_ID,
    name: 'Sonarr',
    type: 'standard',
    token: SOURCE_TOKEN,
    enabled: true,
    config: {},
  });
  db.replaceRoutes(SOURCE_ID, [{ priority: 1, channelId: 'channel-1', enabled: true }]);

  let isReady = ready;
  let sent = 0;
  const send = vi.fn<DiscordSender['send']>(async () => ({ messageId: `discord-${++sent}` }));
  const connect = vi.fn((): DiscordConnection => ({
    sender: { send },
    isReady: () => isReady,
    syncChannels: async () => 0,
    destroy: async () => {},
  }));

  const start = () => createHub({ sqlite, appSecret: APP_SECRET, bodyLimitBytes, connect, idleMs: 5 });
  let hub = start();

  return {
    get app() {
      return hub.app;
    },
    get db() {
      return hub.db;
    },
    sqlite,
    send,
    connect,
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

export function postHook(hub: TestHub, body: unknown, { token = SOURCE_TOKEN, sourceId = SOURCE_ID } = {}) {
  return hub.app.inject({
    method: 'POST',
    url: `/hook/${sourceId}/${token}`,
    headers: { 'content-type': 'application/json' },
    payload: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
