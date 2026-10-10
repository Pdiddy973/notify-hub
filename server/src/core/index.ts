import type { Embed, Severity, StandardMessage } from '@notify-hub/shared';
import { parseBody, type AdapterRegistry } from '../adapters/index.js';
import type { Database, Route } from '../db/index.js';
import type { Queue } from '../queue/index.js';

const severityColors: Record<Severity, number> = {
  info: 0x3498db,
  success: 0x2ecc71,
  warning: 0xf1c40f,
  error: 0xe74c3c,
  debug: 0x95a5a6,
};

// Returns the channel of the first enabled route by priority, or null when unrouted.
// Match conditions are not evaluated yet.
export function route(_message: StandardMessage, routes: Route[]): string | null {
  const match = routes.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority)[0];
  return match?.channelId ?? null;
}

export function renderEmbed(message: StandardMessage): Embed {
  return {
    author: { name: message.source },
    title: message.title,
    description: message.body,
    url: message.url,
    color: severityColors[message.severity],
    fields: message.fields,
    image: message.imageUrl ? { url: message.imageUrl } : undefined,
    footer: { text: message.event },
    timestamp: message.timestamp,
  };
}

export interface Pipeline {
  // Normalizes a stored message, routes it, and queues one delivery per routed result.
  process(messageId: number): void;
}

export interface PipelineDeps {
  db: Database;
  adapters: AdapterRegistry;
  queue: Queue;
}

export function createPipeline({ db, adapters, queue }: PipelineDeps): Pipeline {
  return {
    process(messageId) {
      const stored = db.getMessage(messageId);
      if (!stored) return;
      const source = db.getSource(stored.sourceId);
      const adapter = source ? adapters.get(source.type) : undefined;
      if (!source || !adapter) {
        db.setMessageStatus(messageId, 'failed');
        return;
      }

      const body = parseBody(stored.rawPayload, adapter.parse);
      const messages: StandardMessage[] = adapter
        .normalize({ body, headers: stored.headers, config: source.config })
        .map((message) => ({ ...message, source: source.id, timestamp: stored.receivedAt }));
      if (messages.length === 0) {
        db.setMessageStatus(messageId, 'dropped');
        return;
      }
      db.setMessageStatus(messageId, 'normalized');

      const routes = db.listRoutes(source.id);
      let queued = 0;
      for (const message of messages) {
        const channelId = route(message, routes);
        if (channelId) {
          queue.enqueue(messageId, channelId, renderEmbed(message));
          queued++;
        }
      }
      db.setMessageStatus(messageId, queued > 0 ? 'queued' : 'unrouted');
    },
  };
}
