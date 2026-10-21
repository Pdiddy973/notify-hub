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
      'address_blocks',
      'channels',
      'deliveries',
      'discard_counts',
      'discarded',
      'health_events',
      'messages',
      'mutes',
      'routes',
      'samples',
      'sessions',
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

  it('adds rules at the end, reorders them, and replaces the rules of one source as a set', () => {
    db.saveSource({ id: 's1', name: 'S', type: 'standard', token: 't', enabled: true, config: {} });
    const any = db.insertRoute({ channelId: 'any', sourceId: null });
    db.replaceRoutes('s1', [{ channelId: 'a' }, { channelId: 'b', enabled: false }]);
    expect(db.listRoutes().map((r) => r.channelId)).toEqual(['any', 'a', 'b']);
    expect(db.listRoutes('s1').map((r) => r.channelId)).toEqual(['a', 'b']);
    expect(db.getRoute(any.id)).toMatchObject({
      name: '',
      conditions: {},
      enabled: true,
      continueMatching: false,
    });

    const [, a, b] = db.listRoutes();
    db.reorderRoutes([b!.id, any.id, a!.id]);
    expect(db.listRoutes().map((r) => [r.channelId, r.priority])).toEqual([
      ['b', 1],
      ['any', 2],
      ['a', 3],
    ]);

    db.replaceRoutes('s1', [{ channelId: 'c' }]);
    expect(db.listRoutes().map((r) => r.channelId)).toEqual(['any', 'c']);
    expect(db.deleteSource('s1')).toBe(true);
    expect(db.listRoutes().map((r) => r.channelId)).toEqual(['any']);
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
      fallback: false,
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

  it('keeps at most 10,000 saved address blocks, dropping those that end first', () => {
    const insert = handle.sqlite.prepare('INSERT INTO address_blocks (address, until) VALUES (?, ?)');
    handle.sqlite.transaction(() => {
      for (let i = 0; i < 10_000; i++)
        insert.run(`10.0.${i >> 8}.${i & 255}`, `2099-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`);
    })();
    db.saveAddressBlock('192.168.1.1', '2099-12-31T00:00:00.000Z');
    expect(db.listAddressBlocks('2026-01-01T00:00:00.000Z')).toHaveLength(10_000);
    expect(db.listAddressBlocks('2026-01-01T00:00:00.000Z').map((b) => b.address)).toContain('192.168.1.1');
  });
});
