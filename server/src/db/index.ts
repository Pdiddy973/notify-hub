import type { DeliveryStatus, Embed, MessageStatus, Severity, StandardMessage } from '@notify-hub/shared';

export type { DeliveryStatus, MessageStatus };

export type DiscardReason = 'wrong token' | 'missing token' | 'unknown source' | 'disabled source';

export interface Source {
  id: string;
  name: string;
  // Adapter id.
  type: string;
  // Decrypted by the database layer.
  token: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface Route {
  id: number;
  sourceId: string;
  // Lower numbers are checked first.
  priority: number;
  channelId: string;
  enabled: boolean;
}

export interface Channel {
  id: string;
  guildId: string;
  name: string;
  type: string;
}

export interface StoredMessage {
  id: number;
  sourceId: string;
  receivedAt: string;
  headers: Record<string, string>;
  rawPayload: string;
  rawContentType: string;
  status: MessageStatus;
  normalized?: StandardMessage[];
  error?: string;
}

export interface Delivery {
  id: number;
  messageId: number;
  channelId: string;
  embed: Embed;
  attempt: number;
  status: DeliveryStatus;
  error?: string;
  discordMessageId?: string;
  sentAt?: string;
}

export interface DiscardEntry {
  sourceTried: string;
  reason: DiscardReason;
  clientAddress: string;
  userAgent?: string;
  method: string;
  contentType?: string;
  contentLength: number;
  tokenHint?: string;
}

export interface DiscardRow extends DiscardEntry {
  id: number;
  firstSeen: string;
  lastSeen: string;
  repeatCount: number;
}

export interface Session {
  createdAt: string;
  expiresAt: string;
}

// Filters for listing messages, newest first.
export interface MessageFilter {
  source?: string;
  status?: MessageStatus;
  severity?: Severity;
  // Matched against the raw payload, the normalized messages, and the error.
  q?: string;
  before?: number;
  limit: number;
}

export const settingKeys = {
  // Encrypted.
  discordToken: 'discord.token',
  discordGuildId: 'discord.guildId',
  adminUsername: 'admin.username',
  adminPasswordHash: 'admin.passwordHash',
  // ISO time the first-run setup finished.
  setupCompletedAt: 'setup.completedAt',
} as const;

export type MessageChanges = Partial<Pick<StoredMessage, 'status' | 'normalized' | 'error'>>;

// Storage used by the backend modules; the bot never receives it.
export interface Database {
  // Writes and reads a row; false when the database is unusable.
  ping(): boolean;

  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string, options?: { encrypted?: boolean }): void;

  getSource(id: string): Source | undefined;
  saveSource(source: Source): void;
  listSources(): Omit<Source, 'token' | 'config'>[];

  listRoutes(sourceId: string): Route[];
  replaceRoutes(sourceId: string, routes: Omit<Route, 'id' | 'sourceId'>[]): void;

  listChannels(): Channel[];
  // Replaces the stored channels of one guild.
  saveChannels(guildId: string, channels: Omit<Channel, 'guildId'>[]): void;

  insertMessage(message: Omit<StoredMessage, 'id'>): StoredMessage;
  getMessage(id: number): StoredMessage | undefined;
  updateMessage(id: number, changes: MessageChanges): void;
  // Ids in the order received.
  listMessageIds(status: MessageStatus): number[];
  listMessages(filter: MessageFilter): StoredMessage[];
  // Deliveries of several messages, in id order.
  listDeliveriesFor(messageIds: number[]): Delivery[];

  insertDelivery(delivery: Omit<Delivery, 'id'>): Delivery;
  getDelivery(id: number): Delivery | undefined;
  listDeliveries(messageId: number): Delivery[];
  oldestQueuedDelivery(): Delivery | undefined;
  updateDelivery(id: number, changes: Partial<Omit<Delivery, 'id'>>): void;
  // Returns deliveries left in sending by a stopped process to the queue.
  requeueInterrupted(): number;

  recordDiscard(entry: DiscardEntry): void;
  listDiscarded(): DiscardRow[];

  // Sessions are stored by the SHA-256 of their id.
  createSession(idHash: string, session: Session & { userAgent?: string }): void;
  getSession(idHash: string): Session | undefined;
  deleteSession(idHash: string): void;
  // Removes sessions that expired before the given time.
  pruneSessions(now: string): number;
}

export { createSqliteDatabase, openSqlite, type SqliteHandle } from './sqlite.js';
