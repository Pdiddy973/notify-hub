import type {
  AdapterStatus,
  DeliveryStatus,
  DiscardReason,
  Embed,
  MessageStatus,
  MuteInfo,
  RouteInfo,
  Severity,
  StandardMessage,
} from '@notify-hub/shared';

export type { DeliveryStatus, DiscardReason, MessageStatus };

export interface Source {
  id: string;
  name: string;
  // Adapter id.
  type: string;
  // Decrypted by the database layer.
  token: string;
  enabled: boolean;
  config: Record<string, unknown>;
  // The token from before the last rotation and when it stops working.
  previousToken?: string;
  previousTokenExpiresAt?: string;
}

export type NewSource = Omit<Source, 'previousToken' | 'previousTokenExpiresAt'>;

// A source without its token or config.
export interface SourceListing {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  createdAt: string;
  previousTokenExpiresAt?: string;
}

export type Route = RouteInfo;

// A new rule; it is added after the existing ones.
export type NewRoute = Partial<
  Pick<
    Route,
    'name' | 'sourceId' | 'conditions' | 'action' | 'channelId' | 'mentions' | 'enabled' | 'continueMatching'
  >
>;

export type RouteChanges = Partial<Omit<Route, 'id' | 'priority'>>;

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
  // The rule that chose the channel, when one did.
  routeId?: number;
  // Sent to the fallback channel because no rule matched.
  fallback: boolean;
  // Message text sent with the embed, such as mentions.
  content?: string;
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

export interface DiscardFilter {
  source?: string;
  reason?: DiscardReason;
  address?: string;
  // Only rows last seen at or after this time.
  since?: string;
  offset?: number;
  limit?: number;
}

export interface MessageStats {
  total: number;
  failed: number;
  unrouted: number;
  bySource: { sourceId: string; count: number }[];
}

export type Mute = Omit<MuteInfo, 'targetName'>;

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

export interface AdapterState {
  id: string;
  filePath: string;
  version?: number;
  loadStatus: AdapterStatus;
  lastError?: string;
}

export type MessageChanges = Partial<Pick<StoredMessage, 'status' | 'normalized' | 'error'>>;

// Storage used by the backend modules; the bot never receives it.
export interface Database {
  // Writes and reads a row; false when the database is unusable.
  ping(): boolean;

  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string, options?: { encrypted?: boolean }): void;
  deleteSetting(key: string): void;

  getSource(id: string): Source | undefined;
  // Inserts or replaces a source; a rotated previous token is kept.
  saveSource(source: NewSource): void;
  // False when the id is taken.
  createSource(source: NewSource): boolean;
  updateSource(id: string, changes: Partial<Pick<Source, 'name' | 'enabled' | 'config'>>): boolean;
  // Also removes the source's routes; its messages stay in the log.
  deleteSource(id: string): boolean;
  // Makes token current and keeps the old one valid until previousExpiresAt.
  rotateSourceToken(id: string, token: string, previousExpiresAt: string): void;
  listSources(): SourceListing[];
  // Time of the newest message per source.
  lastMessageTimes(): Map<string, string>;

  // In priority order; with a source id, only the rules that apply to that source alone.
  listRoutes(sourceId?: string): Route[];
  getRoute(id: number): Route | undefined;
  insertRoute(route: NewRoute): Route;
  updateRoute(id: number, changes: RouteChanges): Route | undefined;
  deleteRoute(id: number): boolean;
  // Sets priorities from the order of ids; ids not listed keep their place after them.
  reorderRoutes(ids: number[]): void;
  // Replaces the rules of one source with new ones at the end of the list.
  replaceRoutes(sourceId: string, routes: Omit<NewRoute, 'sourceId'>[]): void;

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
  // Returns a message's failed deliveries to the queue; returns how many.
  requeueFailedDeliveries(messageId: number): number;
  // Removes a message's deliveries, before it is routed again.
  deleteDeliveries(messageId: number): void;
  // Deliveries queued or being sent.
  queueDepth(): number;
  messageStats(since: string): MessageStats;

  // Adds to the sender's row, then removes the oldest rows beyond maxRows.
  recordDiscard(entry: DiscardEntry, options?: { maxRows?: number }): void;
  // Newest first.
  listDiscarded(filter?: DiscardFilter): DiscardRow[];
  countDiscarded(filter?: DiscardFilter): number;
  clearDiscarded(): number;
  // Removes rows and hourly counts older than the given time, then rows beyond maxRows.
  pruneDiscarded(before: string, maxRows: number): number;
  // Discarded requests since the start of the hour that contains the given time.
  discardedSince(since: string): number;

  // Sessions are stored by the SHA-256 of their id.
  createSession(idHash: string, session: Session & { userAgent?: string }): void;
  getSession(idHash: string): Session | undefined;
  deleteSession(idHash: string): void;
  deleteSessionsExcept(idHash: string): number;

  // Mutes in effect at the given time.
  listActiveMutes(now: string): Mute[];
  insertMute(mute: Omit<Mute, 'id' | 'createdAt'>): Mute;
  deleteMute(id: number): boolean;
  // Removes mutes that ended before the given time.
  pruneMutes(now: string): number;
  // Removes the mutes of a source or rule that is deleted.
  deleteMutesFor(scope: Mute['scope'], target: string): void;

  // Blocks still in effect at the given time.
  listAddressBlocks(now: string): { address: string; until: string }[];
  saveAddressBlock(address: string, until: string): void;
  deleteAddressBlock(address: string): void;
  pruneAddressBlocks(now: string): number;
  // Removes sessions that expired before the given time.
  pruneSessions(now: string): number;

  // Approved permissions per adapter id.
  adapterApprovals(): Map<string, string[]>;
  // Records the load result of the adapter in use for an id; approvals are kept.
  saveAdapterState(state: AdapterState): void;
  setAdapterApprovals(id: string, approved: string[]): void;
}

export { createSqliteDatabase, openSqlite, type SqliteHandle } from './sqlite.js';
