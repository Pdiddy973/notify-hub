import BetterSqlite3 from 'better-sqlite3';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  or,
  sql,
  sum,
  type SQL,
} from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { fileURLToPath } from 'node:url';
import type { SecretBox } from '../security/index.js';
import type {
  Database,
  Delivery,
  DeliveryStatus,
  DiscardFilter,
  DiscardReason,
  DiscardRow,
  MessageStatus,
  Mute,
  SourceListing,
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

// Most address blocks kept across restarts; the blocker tracks the same number in memory.
const MAX_SAVED_BLOCKS = 10_000;

// Start of the UTC hour containing the given time.
const hourOf = (iso: string) => `${new Date(iso).toISOString().slice(0, 13)}:00:00.000Z`;

// Matches text anywhere in the column, with %, _, and \ taken literally.
function contains(column: SQLiteColumn, text: string): SQL {
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`${column} like ${pattern} escape '\\'`;
}

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
  const toMute = (row: typeof schema.mutes.$inferSelect): Mute => row;

  const getRoute = (id: number) => orm.select().from(schema.routes).where(eq(schema.routes.id, id)).get();

  const nextPriority = () =>
    (orm
      .select({ top: max(schema.routes.priority) })
      .from(schema.routes)
      .get()?.top ?? 0) + 1;

  const discardConditions = ({ source, reason, address, since }: DiscardFilter): SQL | undefined => {
    const { discarded } = schema;
    const conditions: SQL[] = [];
    if (source) conditions.push(contains(discarded.sourceTried, source));
    if (reason) conditions.push(eq(discarded.reason, reason));
    if (address) conditions.push(contains(discarded.clientAddress, address));
    if (since) conditions.push(gte(discarded.lastSeen, since));
    return conditions.length ? and(...conditions) : undefined;
  };

  // Deletes the oldest rows beyond maxRows.
  const capDiscarded = (maxRows: number): number => {
    const { discarded } = schema;
    const total = orm.select({ n: count() }).from(discarded).get()?.n ?? 0;
    if (total <= maxRows) return 0;
    const oldest = orm
      .select({ id: discarded.id })
      .from(discarded)
      .orderBy(asc(discarded.lastSeen), asc(discarded.id))
      .limit(total - maxRows);
    return orm.delete(discarded).where(inArray(discarded.id, oldest)).run().changes;
  };

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

    deleteSetting(key) {
      orm.delete(schema.settings).where(eq(schema.settings.key, key)).run();
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
        ...(row.previousToken && row.previousTokenExpiresAt
          ? {
              previousToken: secrets.decrypt(row.previousToken),
              previousTokenExpiresAt: row.previousTokenExpiresAt,
            }
          : {}),
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

    createSource(source) {
      const result = orm
        .insert(schema.sources)
        .values({ ...source, token: secrets.encrypt(source.token) })
        .onConflictDoNothing()
        .run();
      return result.changes === 1;
    },

    updateSource(id, changes) {
      const exists = () =>
        orm.select({ id: schema.sources.id }).from(schema.sources).where(eq(schema.sources.id, id)).get();
      if (Object.keys(changes).length === 0) return exists() !== undefined;
      return orm.update(schema.sources).set(changes).where(eq(schema.sources.id, id)).run().changes === 1;
    },

    deleteSource(id) {
      return orm.delete(schema.sources).where(eq(schema.sources.id, id)).run().changes === 1;
    },

    rotateSourceToken(id, token, previousExpiresAt) {
      const row = orm
        .select({ token: schema.sources.token })
        .from(schema.sources)
        .where(eq(schema.sources.id, id))
        .get();
      if (!row) return;
      orm
        .update(schema.sources)
        .set({
          token: secrets.encrypt(token),
          previousToken: row.token,
          previousTokenExpiresAt: previousExpiresAt,
        })
        .where(eq(schema.sources.id, id))
        .run();
    },

    listSources() {
      return orm
        .select({
          id: schema.sources.id,
          name: schema.sources.name,
          type: schema.sources.type,
          enabled: schema.sources.enabled,
          createdAt: schema.sources.createdAt,
          previousTokenExpiresAt: schema.sources.previousTokenExpiresAt,
        })
        .from(schema.sources)
        .orderBy(asc(schema.sources.name), asc(schema.sources.id))
        .all()
        .map((row): SourceListing => compact(row));
    },

    lastMessageTimes() {
      const rows = orm
        .select({ sourceId: schema.messages.sourceId, last: max(schema.messages.receivedAt) })
        .from(schema.messages)
        .groupBy(schema.messages.sourceId)
        .all();
      return new Map(rows.flatMap((row) => (row.last ? [[row.sourceId, row.last] as const] : [])));
    },

    listRoutes(sourceId) {
      return orm
        .select()
        .from(schema.routes)
        .where(sourceId === undefined ? undefined : eq(schema.routes.sourceId, sourceId))
        .orderBy(asc(schema.routes.priority), asc(schema.routes.id))
        .all();
    },

    getRoute,

    insertRoute(route) {
      return orm
        .insert(schema.routes)
        .values({ ...route, priority: nextPriority() })
        .returning()
        .get();
    },

    updateRoute(id, changes) {
      if (Object.keys(changes).length > 0) {
        orm.update(schema.routes).set(changes).where(eq(schema.routes.id, id)).run();
      }
      return getRoute(id);
    },

    deleteRoute(id) {
      return orm.delete(schema.routes).where(eq(schema.routes.id, id)).run().changes === 1;
    },

    reorderRoutes(ids) {
      orm.transaction((tx) => {
        const listed = new Set(ids);
        const rest = tx
          .select({ id: schema.routes.id })
          .from(schema.routes)
          .orderBy(asc(schema.routes.priority), asc(schema.routes.id))
          .all()
          .map((row) => row.id)
          .filter((id) => !listed.has(id));
        [...listed, ...rest].forEach((id, index) => {
          tx.update(schema.routes)
            .set({ priority: index + 1 })
            .where(eq(schema.routes.id, id))
            .run();
        });
      });
    },

    replaceRoutes(sourceId, routes) {
      orm.transaction((tx) => {
        tx.delete(schema.routes).where(eq(schema.routes.sourceId, sourceId)).run();
        const first = nextPriority();
        routes.forEach((route, index) => {
          tx.insert(schema.routes)
            .values({ ...route, sourceId, priority: first + index })
            .run();
        });
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

    listMessages({ source, status, severity, q, before, limit }) {
      const { messages } = schema;
      const conditions: SQL[] = [];
      if (source) conditions.push(eq(messages.sourceId, source));
      if (status) conditions.push(eq(messages.status, status));
      if (severity) {
        conditions.push(
          sql`exists (select 1 from json_each(${messages.normalized}) where json_extract(value, '$.severity') = ${severity})`,
        );
      }
      if (q) {
        conditions.push(
          or(
            contains(messages.rawPayload, q),
            contains(messages.normalized, q),
            contains(messages.error, q),
          )!,
        );
      }
      if (before) conditions.push(lt(messages.id, before));
      return orm
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(desc(messages.id))
        .limit(limit)
        .all()
        .map(toMessage);
    },

    listDeliveriesFor(messageIds) {
      if (messageIds.length === 0) return [];
      return orm
        .select()
        .from(schema.deliveries)
        .where(inArray(schema.deliveries.messageId, messageIds))
        .orderBy(asc(schema.deliveries.id))
        .all()
        .map(toDelivery);
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

    requeueFailedDeliveries(messageId) {
      return orm
        .update(schema.deliveries)
        .set({ status: 'queued', error: null })
        .where(and(eq(schema.deliveries.messageId, messageId), eq(schema.deliveries.status, 'failed')))
        .run().changes;
    },

    deleteDeliveries(messageId) {
      orm.delete(schema.deliveries).where(eq(schema.deliveries.messageId, messageId)).run();
    },

    queueDepth() {
      const row = orm
        .select({ n: count() })
        .from(schema.deliveries)
        .where(inArray(schema.deliveries.status, ['queued', 'sending']))
        .get();
      return row?.n ?? 0;
    },

    messageStats(since) {
      const { messages } = schema;
      const rows = orm
        .select({
          sourceId: messages.sourceId,
          count: count(),
          failed: sum(sql`${messages.status} = 'failed'`).mapWith(Number),
          unrouted: sum(sql`${messages.status} = 'unrouted'`).mapWith(Number),
        })
        .from(messages)
        .where(gte(messages.receivedAt, since))
        .groupBy(messages.sourceId)
        .all();
      const total = (key: 'count' | 'failed' | 'unrouted') => rows.reduce((n, row) => n + row[key], 0);
      return {
        total: total('count'),
        failed: total('failed'),
        unrouted: total('unrouted'),
        bySource: rows.map(({ sourceId, count }) => ({ sourceId, count })),
      };
    },

    recordDiscard(entry, { maxRows } = {}) {
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
      orm
        .insert(schema.discardCounts)
        .values({ hour: hourOf(seen), count: 1 })
        .onConflictDoUpdate({
          target: schema.discardCounts.hour,
          set: { count: sql`${schema.discardCounts.count} + 1` },
        })
        .run();
      if (maxRows !== undefined) capDiscarded(maxRows);
    },

    listDiscarded(filter = {}) {
      return orm
        .select()
        .from(schema.discarded)
        .where(discardConditions(filter))
        .orderBy(desc(schema.discarded.lastSeen), desc(schema.discarded.id))
        .limit(filter.limit ?? -1)
        .offset(filter.offset ?? 0)
        .all()
        .map((row): DiscardRow => compact({ ...row, reason: row.reason as DiscardReason }));
    },

    countDiscarded(filter = {}) {
      const row = orm.select({ n: count() }).from(schema.discarded).where(discardConditions(filter)).get();
      return row?.n ?? 0;
    },

    clearDiscarded() {
      return orm.delete(schema.discarded).run().changes;
    },

    pruneDiscarded(before, maxRows) {
      orm
        .delete(schema.discardCounts)
        .where(lt(schema.discardCounts.hour, hourOf(before)))
        .run();
      const old = orm.delete(schema.discarded).where(lt(schema.discarded.lastSeen, before)).run().changes;
      return old + capDiscarded(maxRows);
    },

    discardedSince(since) {
      const row = orm
        .select({ n: sum(schema.discardCounts.count).mapWith(Number) })
        .from(schema.discardCounts)
        .where(gte(schema.discardCounts.hour, hourOf(since)))
        .get();
      return row?.n ?? 0;
    },

    createSession(idHash, { createdAt, expiresAt, userAgent }) {
      orm
        .insert(schema.sessions)
        .values({ idHash, createdAt, expiresAt, userAgent: userAgent ?? null })
        .run();
    },

    getSession(idHash) {
      return orm
        .select({ createdAt: schema.sessions.createdAt, expiresAt: schema.sessions.expiresAt })
        .from(schema.sessions)
        .where(eq(schema.sessions.idHash, idHash))
        .get();
    },

    deleteSession(idHash) {
      orm.delete(schema.sessions).where(eq(schema.sessions.idHash, idHash)).run();
    },

    deleteSessionsExcept(idHash) {
      return orm.delete(schema.sessions).where(ne(schema.sessions.idHash, idHash)).run().changes;
    },

    listActiveMutes(now) {
      return orm
        .select()
        .from(schema.mutes)
        .where(or(isNull(schema.mutes.until), gt(schema.mutes.until, now)))
        .orderBy(asc(schema.mutes.id))
        .all()
        .map(toMute);
    },

    insertMute(mute) {
      return toMute(orm.insert(schema.mutes).values(mute).returning().get());
    },

    deleteMute(id) {
      return orm.delete(schema.mutes).where(eq(schema.mutes.id, id)).run().changes === 1;
    },

    pruneMutes(now) {
      return orm
        .delete(schema.mutes)
        .where(and(isNotNull(schema.mutes.until), lte(schema.mutes.until, now)))
        .run().changes;
    },

    deleteMutesFor(scope, target) {
      orm
        .delete(schema.mutes)
        .where(and(eq(schema.mutes.scope, scope), eq(schema.mutes.target, target)))
        .run();
    },

    listAddressBlocks(now) {
      return orm.select().from(schema.addressBlocks).where(gt(schema.addressBlocks.until, now)).all();
    },

    saveAddressBlock(address, until) {
      const { addressBlocks } = schema;
      orm
        .insert(addressBlocks)
        .values({ address, until })
        .onConflictDoUpdate({ target: addressBlocks.address, set: { until } })
        .run();
      // Keeps the blocks that end last, like the in-memory list.
      const total = orm.select({ n: count() }).from(addressBlocks).get()?.n ?? 0;
      if (total > MAX_SAVED_BLOCKS) {
        const first = orm
          .select({ address: addressBlocks.address })
          .from(addressBlocks)
          .orderBy(asc(addressBlocks.until))
          .limit(total - MAX_SAVED_BLOCKS);
        orm.delete(addressBlocks).where(inArray(addressBlocks.address, first)).run();
      }
    },

    deleteAddressBlock(address) {
      orm.delete(schema.addressBlocks).where(eq(schema.addressBlocks.address, address)).run();
    },

    pruneAddressBlocks(now) {
      return orm.delete(schema.addressBlocks).where(lte(schema.addressBlocks.until, now)).run().changes;
    },

    pruneSessions(now) {
      return orm.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now)).run().changes;
    },
  };
}
