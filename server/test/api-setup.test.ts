import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingKeys } from '../src/db/index.js';
import { BOT_TOKEN, CHANNEL_ID, createTestHub, GUILD_ID, login, type TestHub } from './support/hub.js';

describe('first-run Discord setup', () => {
  let hub: TestHub;
  afterEach(() => hub.close());

  const request = async (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) => {
    const cookie = await login(hub);
    return hub.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  };

  it('explains a value that is not a bot token', async () => {
    hub = createTestHub({ configured: false });
    const response = await request('POST', '/api/discord/verify', { botToken: '1234567890123456789' });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual([
      { path: 'botToken', message: 'That is an ID (probably the Application ID), not the bot token.' },
    ]);
  });

  it('reports a token Discord rejects', async () => {
    hub = createTestHub({ configured: false });
    const response = await request('POST', '/api/discord/verify', { botToken: BOT_TOKEN.replace('a', 'b') });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0].message).toMatch(/Discord rejected/);
  });

  it('lists the servers a valid token can see', async () => {
    hub = createTestHub({ configured: false });
    const response = await request('POST', '/api/discord/verify', { botToken: BOT_TOKEN });
    expect(response.json()).toEqual({
      botUser: 'NotifyBot',
      botId: '123456789012345678',
      guilds: [{ id: GUILD_ID, name: 'Homelab' }],
    });
  });

  it('saves the connection encrypted, connects, and syncs channels', async () => {
    hub = createTestHub({ configured: false });
    expect(hub.connect).not.toHaveBeenCalled();

    const saved = await request('PUT', '/api/discord', { botToken: BOT_TOKEN, guildId: GUILD_ID });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({
      configured: true,
      connected: true,
      botUser: 'NotifyBot',
      guildId: GUILD_ID,
      guildName: 'Homelab',
    });
    expect(hub.connect).toHaveBeenCalledWith(
      expect.objectContaining({ token: BOT_TOKEN, guildId: GUILD_ID }),
    );
    const stored = hub.sqlite.sqlite.prepare("SELECT value FROM settings WHERE key = 'discord.token'").get();
    expect(JSON.stringify(stored)).not.toContain(BOT_TOKEN);

    const synced = await request('POST', '/api/discord/sync-channels');
    expect(synced.json()).toEqual({ channels: [{ id: CHANNEL_ID, name: 'alerts', type: 'GuildText' }] });
    expect((await request('GET', '/api/channels')).json()).toEqual([
      { id: CHANNEL_ID, name: 'alerts', type: 'GuildText' },
    ]);
  });

  it('keeps the saved token when only the server changes', async () => {
    hub = createTestHub();
    const response = await request('PUT', '/api/discord', { guildId: '333333333333333333' });
    expect(response.statusCode).toBe(200);
    expect(hub.db.getSetting(settingKeys.discordToken)).toBe(BOT_TOKEN);
    expect(hub.connect).toHaveBeenLastCalledWith(expect.objectContaining({ guildId: '333333333333333333' }));
  });

  it('refuses to finish before Discord is connected', async () => {
    hub = createTestHub({ configured: false });
    const response = await request('POST', '/api/setup/finish', { channelId: CHANNEL_ID });
    expect(response.statusCode).toBe(409);
  });

  it('finishes by creating a test source routed to the chosen channel', async () => {
    hub = createTestHub();
    const finished = await request('POST', '/api/setup/finish', { channelId: CHANNEL_ID });
    const { sourceId, hookPath } = finished.json();
    expect(sourceId).toBe('test');
    expect((await request('GET', '/api/session')).json().setupComplete).toBe(true);
    expect(hub.db.listRoutes('test')).toMatchObject([{ channelId: CHANNEL_ID, enabled: true }]);

    const posted = await hub.app.inject({
      method: 'POST',
      url: hookPath,
      headers: { 'content-type': 'application/json' },
      payload: { event: 'test', severity: 'info', title: 'From the hook path' },
    });
    expect(posted.statusCode).toBe(202);
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledWith(CHANNEL_ID, expect.anything()));
  });

  it('keeps the test source token when setup is finished again', async () => {
    hub = createTestHub();
    const first = (await request('POST', '/api/setup/finish', { channelId: CHANNEL_ID })).json();
    const second = (await request('POST', '/api/setup/finish', { channelId: CHANNEL_ID })).json();
    expect(second.hookPath).toBe(first.hookPath);
  });
});
