import type { Embed, StandardMessage } from '@notify-hub/shared';
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Timestamps are ISO 8601 strings in UTC.
const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // Adapter id.
  type: text('type').notNull(),
  // Encrypted with the secret box.
  token: text('token').notNull(),
  previousToken: text('previous_token'),
  previousTokenExpiresAt: text('previous_token_expires_at'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  style: text('style', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text('created_at').notNull().default(now),
});

export const channels = sqliteTable('channels', {
  id: text('id').primaryKey(),
  guildId: text('guild_id').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  lastSyncedAt: text('last_synced_at').notNull(),
});

export const routes = sqliteTable(
  'routes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    // Lower numbers are checked first.
    priority: integer('priority').notNull(),
    conditions: text('conditions', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    channelId: text('channel_id').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  },
  (table) => [index('routes_source_idx').on(table.sourceId, table.priority)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sourceId: text('source_id').notNull(),
    receivedAt: text('received_at').notNull(),
    headers: text('headers', { mode: 'json' }).$type<Record<string, string>>().notNull(),
    // Stored after redaction.
    rawPayload: text('raw_payload').notNull(),
    rawContentType: text('raw_content_type').notNull(),
    status: text('status').notNull(),
    normalized: text('normalized', { mode: 'json' }).$type<StandardMessage[]>(),
    error: text('error'),
  },
  (table) => [
    index('messages_received_idx').on(table.receivedAt),
    index('messages_source_idx').on(table.sourceId, table.receivedAt),
    index('messages_status_idx').on(table.status),
  ],
);

export const deliveries = sqliteTable(
  'deliveries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    messageId: integer('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    channelId: text('channel_id').notNull(),
    embed: text('embed', { mode: 'json' }).$type<Embed>().notNull(),
    attempt: integer('attempt').notNull().default(0),
    status: text('status').notNull(),
    error: text('error'),
    discordMessageId: text('discord_message_id'),
    sentAt: text('sent_at'),
  },
  (table) => [
    index('deliveries_status_idx').on(table.status, table.id),
    index('deliveries_message_idx').on(table.messageId),
  ],
);

export const samples = sqliteTable('samples', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: text('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  payload: text('payload').notNull(),
  label: text('label').notNull(),
  createdAt: text('created_at').notNull().default(now),
});

export const adapters = sqliteTable('adapters', {
  id: text('id').primaryKey(),
  filePath: text('file_path').notNull(),
  version: integer('version'),
  loadStatus: text('load_status').notNull(),
  lastError: text('last_error'),
  approvedPermissions: text('approved_permissions', { mode: 'json' }).$type<string[]>().notNull().default([]),
  updatedAt: text('updated_at').notNull().default(now),
});

export const updates = sqliteTable('updates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  checkedAt: text('checked_at').notNull(),
  runningVersion: text('running_version').notNull(),
  latestVersion: text('latest_version'),
  status: text('status').notNull(),
  appliedAt: text('applied_at'),
  result: text('result'),
});

export const healthEvents = sqliteTable(
  'health_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    checkName: text('check_name').notNull(),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    resolvedAt: text('resolved_at'),
    detail: text('detail'),
  },
  (table) => [index('health_events_check_idx').on(table.checkName, table.startedAt)],
);

export const discarded = sqliteTable(
  'discarded',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    firstSeen: text('first_seen').notNull(),
    lastSeen: text('last_seen').notNull(),
    repeatCount: integer('repeat_count').notNull().default(1),
    clientAddress: text('client_address').notNull(),
    sourceTried: text('source_tried').notNull(),
    reason: text('reason').notNull(),
    userAgent: text('user_agent'),
    method: text('method').notNull(),
    contentType: text('content_type'),
    contentLength: integer('content_length').notNull(),
    tokenHint: text('token_hint'),
  },
  (table) => [
    // One row per sender, source tried, and reason.
    uniqueIndex('discarded_sender_idx').on(table.clientAddress, table.sourceTried, table.reason),
    index('discarded_last_seen_idx').on(table.lastSeen),
  ],
);
