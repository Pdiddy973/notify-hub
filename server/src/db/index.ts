import type { Embed } from '@notify-hub/shared';

export type MessageStatus =
  | 'received'
  | 'normalized'
  | 'queued'
  | 'delivered'
  | 'failed'
  | 'unrouted'
  | 'dropped';

export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed';

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

export interface StoredMessage {
  id: number;
  sourceId: string;
  receivedAt: string;
  headers: Record<string, string>;
  rawPayload: string;
  rawContentType: string;
  status: MessageStatus;
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

// Storage used by the backend modules; the bot never receives it.
export interface Database {
  getSource(id: string): Source | undefined;
  listRoutes(sourceId: string): Route[];
  insertMessage(message: Omit<StoredMessage, 'id'>): StoredMessage;
  getMessage(id: number): StoredMessage | undefined;
  setMessageStatus(id: number, status: MessageStatus): void;
  insertDelivery(delivery: Omit<Delivery, 'id'>): Delivery;
  getDelivery(id: number): Delivery | undefined;
  listDeliveries(messageId: number): Delivery[];
  oldestQueuedDelivery(): Delivery | undefined;
  updateDelivery(id: number, changes: Partial<Omit<Delivery, 'id'>>): void;
  recordDiscard(entry: DiscardEntry): void;
}
