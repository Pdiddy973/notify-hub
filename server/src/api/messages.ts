import {
  HUB_SOURCE_ID,
  type DeliveryInfo,
  type MessageDetail,
  type MessageSummary,
} from '@notify-hub/shared';
import type { Database, Delivery, StoredMessage } from '../db/index.js';

// Builds the log rows for a set of stored messages.
export function summarizeMessages(db: Database, messages: StoredMessage[]): MessageSummary[] {
  const sourceNames = new Map<string, string>([
    [HUB_SOURCE_ID, 'Notify Hub'],
    ...db.listSources().map((source) => [source.id, source.name] as const),
  ]);
  const channelNames = new Map(db.listChannels().map((channel) => [channel.id, channel.name]));
  const deliveries = new Map<number, Delivery[]>();
  for (const delivery of db.listDeliveriesFor(messages.map((message) => message.id))) {
    deliveries.set(delivery.messageId, [...(deliveries.get(delivery.messageId) ?? []), delivery]);
  }

  return messages.map((message) => {
    const first = message.normalized?.[0];
    const own = deliveries.get(message.id) ?? [];
    return {
      id: message.id,
      sourceId: message.sourceId,
      sourceName: sourceNames.get(message.sourceId) ?? message.sourceId,
      receivedAt: message.receivedAt,
      status: message.status,
      ...(first ? { event: first.event, severity: first.severity, title: first.title } : {}),
      destinations: [...new Set(own.map((d) => channelNames.get(d.channelId) ?? d.channelId))],
      fallback: own.some((d) => d.fallback),
      hasError: Boolean(message.error) || own.some((d) => d.status === 'failed'),
    };
  });
}

export function messageDetail(db: Database, message: StoredMessage): MessageDetail {
  const [summary] = summarizeMessages(db, [message]);
  const channelNames = new Map(db.listChannels().map((channel) => [channel.id, channel.name]));
  const deliveries: DeliveryInfo[] = db.listDeliveries(message.id).map((delivery) => {
    const name = channelNames.get(delivery.channelId);
    return {
      id: delivery.id,
      channelId: delivery.channelId,
      ...(name ? { channelName: name } : {}),
      ...(delivery.routeId === undefined ? {} : { routeId: delivery.routeId }),
      fallback: delivery.fallback,
      ...(delivery.content ? { content: delivery.content } : {}),
      embed: delivery.embed,
      attempt: delivery.attempt,
      status: delivery.status,
      ...(delivery.error ? { error: delivery.error } : {}),
      ...(delivery.discordMessageId ? { discordMessageId: delivery.discordMessageId } : {}),
      ...(delivery.sentAt ? { sentAt: delivery.sentAt } : {}),
    };
  });
  return {
    ...summary!,
    headers: message.headers,
    rawPayload: message.rawPayload,
    rawContentType: message.rawContentType,
    ...(message.normalized ? { normalized: message.normalized } : {}),
    ...(message.error ? { error: message.error } : {}),
    deliveries,
  };
}
