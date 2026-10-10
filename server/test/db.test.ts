import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDatabase, openSqlite, type Database, type SqliteHandle } from '../src/db/index.js';
import { createSecretBox } from '../src/security/index.js';
import { APP_SECRET } from './support/hub.js';

describe('sqlite database', () => {
  let handle: SqliteHandle;
  let db: Database;

  beforeEach(() => {
    handle = openSqlite(':memory:');
    db = createSqliteDatabase(handle, createSecretBox(APP_SECRET));
  });
  afterEach(() => handle.sqlite.close());

  const column = (sql: string) => (handle.sqlite.prepare(sql).get() as { value: string }).value;

  it('creates every table from section 5 through the migrations', () => {
    const tables = handle.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name != 'sqlite_sequence'",
      )
      .all()
      .map((row) => (row as { name: string }).name)
      .sort();
    expect(tables).toEqual([
      'adapters',
      'channels',
      'deliveries',
      'discarded',
      'health_events',
      'messages',
      'routes',
      'samples',
      'settings',
      'sources',
      'updates',
    ]);
  });

  it('encrypts source tokens at rest and decrypts them on read', () => {
    db.saveSource({ id: 's1', name: 'S', type: 'standard', token: 'plain-token', enabled: true, config: {} });
    expect(column("SELECT token AS value FROM sources WHERE id = 's1'")).not.toContain('plain-token');
    expect(db.getSource('s1')?.token).toBe('plain-token');
  });

  it('encrypts only the settings marked as secret', () => {
    db.setSetting('discord.token', 'bot-secret', { encrypted: true });
    db.setSetting('discord.guildId', '123');
    expect(column("SELECT value FROM settings WHERE key = 'discord.token'")).not.toContain('bot-secret');
    expect(column("SELECT value FROM settings WHERE key = 'discord.guildId'")).toBe('123');
    expect(db.getSetting('discord.token')).toBe('bot-secret');
    expect(db.getSetting('missing')).toBeUndefined();
  });

  it('returns routes by priority and replaces them as a set', () => {
    db.saveSource({ id: 's1', name: 'S', type: 'standard', token: 't', enabled: true, config: {} });
    db.replaceRoutes('s1', [
      { priority: 2, channelId: 'b', enabled: true },
      { priority: 1, channelId: 'a', enabled: false },
    ]);
    expect(db.listRoutes('s1').map((r) => r.channelId)).toEqual(['a', 'b']);
    db.replaceRoutes('s1', [{ priority: 1, channelId: 'c', enabled: true }]);
    expect(db.listRoutes('s1').map((r) => r.channelId)).toEqual(['c']);
  });

  it('replaces the channels of one guild on sync', () => {
    db.saveChannels('g1', [{ id: '1', name: 'alerts', type: 'GuildText' }]);
    db.saveChannels('g2', [{ id: '2', name: 'other', type: 'GuildText' }]);
    db.saveChannels('g1', [{ id: '3', name: 'media', type: 'GuildText' }]);
    expect(db.listChannels().map((c) => c.id)).toEqual(['3', '2']);
  });

  it('returns deliveries interrupted mid-send to the queue', () => {
    const message = db.insertMessage({
      sourceId: 's1',
      receivedAt: new Date().toISOString(),
      headers: {},
      rawPayload: '{}',
      rawContentType: 'application/json',
      status: 'queued',
    });
    const delivery = db.insertDelivery({
      messageId: message.id,
      channelId: 'c',
      embed: { title: 't' },
      attempt: 1,
      status: 'sending',
    });
    expect(db.requeueInterrupted()).toBe(1);
    expect(db.getDelivery(delivery.id)?.status).toBe('queued');
    expect(db.oldestQueuedDelivery()?.id).toBe(delivery.id);
  });

  it('answers a health ping, and fails it once the database is closed', () => {
    expect(db.ping()).toBe(true);
    const closed = openSqlite(':memory:');
    const closedDb = createSqliteDatabase(closed, createSecretBox(APP_SECRET));
    closed.sqlite.close();
    expect(closedDb.ping()).toBe(false);
  });
});
