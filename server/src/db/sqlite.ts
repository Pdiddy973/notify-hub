import BetterSqlite3 from 'better-sqlite3';
import { asc, eq, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import type { SecretBox } from '../security/index.js';
import type {
  Database,
  Delivery,
  DeliveryStatus,
  DiscardReason,
  DiscardRow,
  MessageStatus,
  StoredMessage,
} from './index.js';
import * as schema from './schema.js';

const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface SqliteHandle {
  sqlite: BetterSqlite3.Database;
  orm: BetterSQLite3Database<typeof schema>;
}

// Opens the database file (or ':memory:') and applies pending migrations.
export function openSqlite(file: string): SqliteHandle {
  const sqlite = new BetterSqlite3(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const orm = drizzle(sqlite, { schema });
  migrate(orm, { migrationsFolder });
  return { sqlite, orm };
}

const isoNow = () => new Date().toISOString();

// Converts null columns to absent properties.
function compact<T extends Record<string, unknown>>(row: T): { [K in keyof T]: Exclude<T[K], null> } {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null)) as {
    [K in keyof T]: Exclude<T[K], null>;
  };
}

export function createSqliteDatabase({ orm }: SqliteHandle, secrets: SecretBox): Database {
  const toMessage = (row: typeof schema.messages.$inferSelect): StoredMessage =>
    compact({ ...row, status: row.status as MessageStatus });
  const toDelivery = (row: typeof schema.deliveries.$inferSelect): Delivery =>
    compact({ ...row, status: row.status as DeliveryStatus });

  return {
    ping() {
      try {
        orm
          .insert(schema.settings)
          .values({ key: 'health.ping', value: isoNow() })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value: isoNow() } })
          .run();
        return (
          orm.select().from(schema.settings).where(eq(schema.settings.key, 'health.ping')).get() !== undefined
        );
      } catch {
        return false;
      }
    },

    getSetting(key) {
      const row = orm.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
      if (!row) return undefined;
      return row.encrypted ? secrets.decrypt(row.value) : row.value;
    },

    setSetting(key, value, { encrypted = false } = {}) {
      const stored = encrypted ? secrets.encrypt(value) : value;
      orm
        .insert(schema.settings)
        .values({ key, value: stored, encrypted })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value: stored, encrypted } })
        .run();
    },

    getSource(id) {
      const row = orm.select().from(schema.sources).where(eq(schema.sources.id, id)).get();
      if (!row) return undefined;
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        token: secrets.decrypt(row.token),
        enabled: row.enabled,
        config: row.config,
      };
    },

    saveSource(source) {
      const values = { ...source, token: secrets.encrypt(source.token) };
      orm
        .insert(schema.sources)
        .values(values)
        .onConflictDoUpdate({ target: schema.sources.id, set: values })
        .run();
    },

    listRoutes(sourceId) {
      return orm
        .select({
          id: schema.routes.id,
          sourceId: schema.routes.sourceId,
          priority: schema.routes.priority,
          channelId: schema.routes.channelId,
          enabled: schema.routes.enabled,
        })
        .from(schema.routes)
        .where(eq(schema.routes.sourceId, sourceId))
        .orderBy(asc(schema.routes.priority), asc(schema.routes.id))
        .all();
    },

    replaceRoutes(sourceId, routes) {
      orm.transaction((tx) => {
        tx.delete(schema.routes).where(eq(schema.routes.sourceId, sourceId)).run();
        for (const route of routes)
          tx.insert(schema.routes)
            .values({ ...route, sourceId })
            .run();
      });
    },

    listChannels() {
      return orm
        .select({
          id: schema.channels.id,
          guildId: schema.channels.guildId,
          name: schema.channels.name,
          type: schema.channels.type,
        })
        .from(schema.channels)
        .orderBy(asc(schema.channels.name))
        .all();
    },

    saveChannels(guildId, channels) {
      const lastSyncedAt = isoNow();
      orm.transaction((tx) => {
        tx.delete(schema.channels).where(eq(schema.channels.guildId, guildId)).run();
        for (const channel of channels) {
          tx.insert(schema.channels)
            .values({ ...channel, guildId, lastSyncedAt })
            .run();
        }
      });
    },

    insertMessage(message) {
      return toMessage(orm.insert(schema.messages).values(message).returning().get());
    },

    getMessage(id) {
      const row = orm.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
      return row && toMessage(row);
    },

    updateMessage(id, changes) {
      orm.update(schema.messages).set(changes).where(eq(schema.messages.id, id)).run();
    },

    listMessageIds(status) {
      return orm
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.status, status))
        .orderBy(asc(schema.messages.id))
        .all()
        .map((row) => row.id);
    },

    insertDelivery(delivery) {
      return toDelivery(orm.insert(schema.deliveries).values(delivery).returning().get());
    },

    getDelivery(id) {
      const row = orm.select().from(schema.deliveries).where(eq(schema.deliveries.id, id)).get();
      return row && toDelivery(row);
    },

    listDeliveries(messageId) {
      return orm
        .select()
        .from(schema.deliveries)
        .where(eq(schema.deliveries.messageId, messageId))
        .orderBy(asc(schema.deliveries.id))
        .all()
        .map(toDelivery);
    },

    oldestQueuedDelivery() {
      const row = orm
        .select()
        .from(schema.deliveries)
        .where(eq(schema.deliveries.status, 'queued'))
        .orderBy(asc(schema.deliveries.id))
        .limit(1)
        .get();
      return row && toDelivery(row);
    },

    updateDelivery(id, changes) {
      orm.update(schema.deliveries).set(changes).where(eq(schema.deliveries.id, id)).run();
    },

    requeueInterrupted() {
      return orm
        .update(schema.deliveries)
        .set({ status: 'queued' })
        .where(eq(schema.deliveries.status, 'sending'))
        .run().changes;
    },

    recordDiscard(entry) {
      const seen = isoNow();
      const details = {
        userAgent: entry.userAgent ?? null,
        method: entry.method,
        contentType: entry.contentType ?? null,
        contentLength: entry.contentLength,
        tokenHint: entry.tokenHint ?? null,
      };
      orm
        .insert(schema.discarded)
        .values({ ...entry, ...details, firstSeen: seen, lastSeen: seen, repeatCount: 1 })
        .onConflictDoUpdate({
          target: [schema.discarded.clientAddress, schema.discarded.sourceTried, schema.discarded.reason],
          set: { ...details, lastSeen: seen, repeatCount: sql`${schema.discarded.repeatCount} + 1` },
        })
        .run();
    },

    listDiscarded() {
      return orm
        .select()
        .from(schema.discarded)
        .orderBy(asc(schema.discarded.id))
        .all()
        .map((row): DiscardRow => compact({ ...row, reason: row.reason as DiscardReason }));
    },
  };
}
